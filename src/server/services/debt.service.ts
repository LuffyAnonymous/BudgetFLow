import { DebtRepository } from "../repositories/debt.repository";
import { DebtPaymentRepository } from "../repositories/debt-payment.repository";
import { CategoryRepository } from "../repositories/category.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { Debt, DebtPayment, DebtStatus, CategoryType, TransactionType, CashFlowDirection, Prisma, AuditAction, AuditEntityType } from "@prisma/client";
import { getDubaiCurrentDate, calculateNextPaymentDate } from "@/lib/dates";
import { AuditLogService } from "./audit-log.service";

export class DebtService {
  private debtRepo = new DebtRepository();
  private debtPaymentRepo = new DebtPaymentRepository();
  private categoryRepo = new CategoryRepository();
  private transactionRepo = new TransactionRepository();

  async getDebts(userId: string, status?: DebtStatus) {
    return this.debtRepo.findMany(userId, { status });
  }

  async getDebtById(id: string, userId: string) {
    const debt = await this.debtRepo.findById(id, userId);
    if (!debt) {
      throw new Error("DEBT_NOT_FOUND");
    }
    return debt;
  }

  async createDebt(userId: string, data: {
    name: string;
    originalBalance: number | string | Decimal;
    monthlyPayment: number | string | Decimal;
    dueDay: number;
    rolloverFeeRate: number | string | Decimal;
    categoryId?: string | null;
    notes?: string | null;
    payeeAliases?: string[];
  }) {
    if (data.dueDay < 1 || data.dueDay > 31) {
      throw new Error("INVALID_DUE_DAY: Due day must be between 1 and 31.");
    }

    if (data.categoryId) {
      const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
      if (!category || category.type !== CategoryType.DEBT) {
        throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type DEBT.");
      }
    }

    return this.debtRepo.create(userId, {
      name: data.name,
      originalBalance: new Decimal(data.originalBalance),
      currentBalance: new Decimal(data.originalBalance),
      monthlyPayment: new Decimal(data.monthlyPayment),
      dueDay: data.dueDay,
      rolloverFeeRate: new Decimal(data.rolloverFeeRate),
      categoryId: data.categoryId ?? null,
      notes: data.notes ?? null,
      payeeAliases: data.payeeAliases ?? [],
      status: DebtStatus.ACTIVE,
    });
  }

  async updateDebt(id: string, userId: string, data: {
    name?: string;
    monthlyPayment?: number | string | Decimal;
    dueDay?: number;
    rolloverFeeRate?: number | string | Decimal;
    categoryId?: string | null;
    status?: DebtStatus;
    notes?: string | null;
    payeeAliases?: string[];
  }) {
    await this.getDebtById(id, userId);

    if (data.dueDay !== undefined && (data.dueDay < 1 || data.dueDay > 31)) {
      throw new Error("INVALID_DUE_DAY: Due day must be between 1 and 31.");
    }

    if (data.categoryId) {
      const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
      if (!category || category.type !== CategoryType.DEBT) {
        throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type DEBT.");
      }
    }

    const updateData: Prisma.DebtUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.monthlyPayment !== undefined) updateData.monthlyPayment = new Decimal(data.monthlyPayment);
    if (data.dueDay !== undefined) updateData.dueDay = data.dueDay;
    if (data.rolloverFeeRate !== undefined) updateData.rolloverFeeRate = new Decimal(data.rolloverFeeRate);
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.payeeAliases !== undefined) updateData.payeeAliases = data.payeeAliases;

    return this.debtRepo.update(id, userId, updateData, undefined);
  }

  async getPayments(userId: string, filters: { debtId?: string; page?: number; pageSize?: number }) {
    const totalItems = await this.debtPaymentRepo.count(userId, filters);
    const items = await this.debtPaymentRepo.findMany(userId, filters);

    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages,
    };
  }

  async recordDebtPayment(
    userId: string,
    debtId: string,
    data: {
      amount: number | string | Decimal;
      paymentDate: Date | string;
      notes?: string | null;
      idempotencyKey?: string | null;
      syncLedger?: boolean;
      /** Link to a transaction that already exists (e.g. an auto-matched
       *  import) instead of creating a new one. Takes precedence over
       *  syncLedger, since the ledger row is already there. */
      existingTransactionId?: string | null;
    },
    /** Pass the caller's own transaction client to participate in an
     *  already-open transaction (e.g. import processing) instead of
     *  opening a separate one. */
    outerTx?: Prisma.TransactionClient
  ): Promise<DebtPayment> {
    // 1. Idempotency Check
    if (data.idempotencyKey) {
      const existing = await this.debtPaymentRepo.findByIdempotencyKey(userId, data.idempotencyKey, outerTx);
      if (existing) {
        return existing;
      }
    }

    const amount = new Decimal(data.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error("INVALID_PAYMENT_AMOUNT: Payment must be greater than zero.");
    }

    const paymentDateObj = typeof data.paymentDate === "string" ? new Date(data.paymentDate) : data.paymentDate;

    const run = async (tx: Prisma.TransactionClient): Promise<DebtPayment> => {
      const debt = await this.debtRepo.findById(debtId, userId, tx);
      if (!debt) {
        throw new Error("DEBT_NOT_FOUND: Debt not found or unauthorized.");
      }

      if (debt.status === DebtStatus.ARCHIVED || debt.status === DebtStatus.PAID) {
        throw new Error("ARCHIVED_OR_PAID: Cannot record a payment against a PAID or ARCHIVED debt.");
      }

      const balanceBefore = new Decimal(debt.currentBalance);
      if (amount.greaterThan(balanceBefore)) {
        throw new Error("PAYMENT_EXCEEDS_BALANCE: Payment amount cannot exceed the remaining balance.");
      }

      const balanceAfter = balanceBefore.minus(amount);
      const newStatus = balanceAfter.isZero() ? DebtStatus.PAID : debt.status;

      let transactionId: string | null = data.existingTransactionId ?? null;

      // Category / Ledger sync rules
      if (!transactionId && data.syncLedger) {
        let targetCategoryId: string | null = debt.categoryId;
        if (targetCategoryId) {
          const category = await this.categoryRepo.findByIdAndUserId(targetCategoryId, userId, tx);
          if (!category || category.type !== CategoryType.DEBT) {
            targetCategoryId = null;
          }
        }

        if (!targetCategoryId) {
          let systemCat = await tx.category.findFirst({
            where: { userId, name: "Debt Payment", type: CategoryType.DEBT },
          });
          if (!systemCat) {
            systemCat = await tx.category.create({
              data: {
                userId,
                name: "Debt Payment",
                type: CategoryType.DEBT,
              },
            });
          }
          targetCategoryId = systemCat.id;
        }

        const { getActiveFinancialCycle } = await import("@/lib/salary-month");
        const activeBudgetMonth = await getActiveFinancialCycle(userId, paymentDateObj, tx);

        // Create transaction in main ledger
        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: paymentDateObj,
            budgetMonth: activeBudgetMonth,
            categoryId: targetCategoryId,
            description: `Payment to debt: ${debt.name}`,
            amount: amount,
            paymentMethod: "Bank Transfer",
            notes: data.notes ?? `Automated link from debt payment`,
            type: TransactionType.DEBT_PAYMENT,
            cashFlowDirection: CashFlowDirection.OUTFLOW,
          },
        });
        transactionId = ledgerTx.id;
      }

      // Record Debt Payment
      const payment = await this.debtPaymentRepo.create(
        userId,
        {
          debtId,
          amount,
          balanceBefore,
          balanceAfter,
          paymentDate: paymentDateObj,
          notes: data.notes ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          transactionId,
        },
        tx
      );

      // Update Debt (with Version concurrency verification)
      await this.debtRepo.update(
        debtId,
        userId,
        {
          currentBalance: balanceAfter,
          status: newStatus,
        },
        debt.version,
        tx
      );

      // Audit the debt payment atomically
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.CREATE,
          entityType: AuditEntityType.DEBT_PAYMENT,
          entityId: payment.id,
          before: { currentBalance: balanceBefore.toString(), status: debt.status },
          after: {
            currentBalance: balanceAfter.toString(),
            status: newStatus,
            paymentAmount: amount.toString(),
          },
        },
        tx
      );

      return payment;
    };

    return outerTx ? run(outerTx) : db.$transaction(run);
  }

  /**
   * Computes the nearest upcoming/overdue payment due day for active/paused debts.
   */
  async getNearestUpcomingPayment(userId: string, currentDate?: Date) {
    const debts = await this.debtRepo.findMany(userId, { status: undefined });
    const dubaiNow = getDubaiCurrentDate(currentDate);

    let nearestDate: Date | null = null;
    let nearestIsOverdue = false;
    let nearestDebt: Debt | null = null;
    let nearestAmount = new Decimal(0);

    for (const debt of debts) {
      if (debt.status === DebtStatus.ARCHIVED || debt.status === DebtStatus.PAID) {
        continue;
      }

      // Check if a payment has been made in this calendar month
      const startOfMonth = new Date(Date.UTC(dubaiNow.year, dubaiNow.month - 1, 1));
      const endOfMonth = new Date(Date.UTC(dubaiNow.year, dubaiNow.month, 1));

      const paymentsCount = await this.debtPaymentRepo.count(userId, {
        debtId: debt.id,
        startDate: startOfMonth,
        endDate: endOfMonth,
      });

      const { date, isOverdue } = calculateNextPaymentDate(
        debt.dueDay,
        paymentsCount > 0,
        dubaiNow
      );

      // We want to find:
      // 1. First priority: any overdue payments
      // 2. Second priority: the closest upcoming payment date
      if (nearestDate === null) {
        nearestDate = date;
        nearestIsOverdue = isOverdue;
        nearestDebt = debt;
        nearestAmount = Decimal.min(debt.currentBalance, debt.monthlyPayment);
      } else {
        const isNewOverduePriority = isOverdue && !nearestIsOverdue;
        const isDateCloser = date.getTime() < nearestDate.getTime();
        const isSameOverdueState = isOverdue === nearestIsOverdue;

        if (isNewOverduePriority || (isSameOverdueState && isDateCloser)) {
          nearestDate = date;
          nearestIsOverdue = isOverdue;
          nearestDebt = debt;
          nearestAmount = Decimal.min(debt.currentBalance, debt.monthlyPayment);
        }
      }
    }

    if (!nearestDebt || !nearestDate) {
      return null;
    }

    return {
      debtId: nearestDebt.id,
      debtName: nearestDebt.name,
      amount: nearestAmount.toFixed(2),
      dueDate: nearestDate.toISOString(),
      isOverdue: nearestIsOverdue,
    };
  }

  /**
   * Computes the 1-36 month paydown projection.
   */
  async getPayoffProjection(id: string, userId: string, monthsMax: number = 36) {
    const debt = await this.getDebtById(id, userId);
    const rolloverRate = new Decimal(debt.rolloverFeeRate);

    let currentBalance = new Decimal(debt.currentBalance);
    const monthlyPayment = new Decimal(debt.monthlyPayment);

    const projections: {
      monthIndex: number;
      startingBalance: string;
      payment: string;
      remainingAfterPayment: string;
      estimatedRolloverFee: string;
      projectedEndingBalance: string;
    }[] = [];

    let totalPayments = new Decimal(0);
    let totalFees = new Decimal(0);
    let payoffMonthIndex: number | null = null;

    for (let i = 1; i <= monthsMax; i++) {
      if (currentBalance.isZero()) {
        break;
      }

      const startingBalance = currentBalance;
      const payment = Decimal.min(currentBalance, monthlyPayment);
      const remainingAfterPayment = currentBalance.minus(payment);

      // Fee calculated ONLY on remaining balance
      const estimatedRolloverFee = remainingAfterPayment.mul(rolloverRate.div(100));
      const projectedEndingBalance = remainingAfterPayment.plus(estimatedRolloverFee);

      projections.push({
        monthIndex: i,
        startingBalance: startingBalance.toFixed(2),
        payment: payment.toFixed(2),
        remainingAfterPayment: remainingAfterPayment.toFixed(2),
        estimatedRolloverFee: estimatedRolloverFee.toFixed(2),
        projectedEndingBalance: projectedEndingBalance.toFixed(2),
      });

      totalPayments = totalPayments.plus(payment);
      totalFees = totalFees.plus(estimatedRolloverFee);

      currentBalance = projectedEndingBalance;

      if (currentBalance.isZero()) {
        payoffMonthIndex = i;
      }
    }

    return {
      debtId: debt.id,
      debtName: debt.name,
      startingBalance: debt.currentBalance.toFixed(2),
      monthlyPayment: debt.monthlyPayment.toFixed(2),
      rolloverFeeRate: debt.rolloverFeeRate.toFixed(4),
      payoffMonthIndex,
      totalProjectedPayments: totalPayments.toFixed(2),
      totalProjectedFees: totalFees.toFixed(2),
      projections,
      disclaimer: "This projection assumes the rollover fee is charged each month on the balance remaining after payment. Actual charges may differ.",
    };
  }
}
