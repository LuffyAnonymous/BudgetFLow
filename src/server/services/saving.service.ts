import { SavingGoalRepository } from "../repositories/saving-goal.repository";
import { SavingTransactionRepository } from "../repositories/saving-transaction.repository";
import { CategoryRepository } from "../repositories/category.repository";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import {
  SavingGoalStatus, SavingTxType, CategoryType,
  TransactionType, CashFlowDirection, SavingTransaction, Prisma,
} from "@prisma/client";
import { AuditLogService } from "./audit-log.service";
import { AuditAction, AuditEntityType } from "@prisma/client";

export class SavingService {
  private savingGoalRepo = new SavingGoalRepository();
  private savingTxRepo = new SavingTransactionRepository();
  private categoryRepo = new CategoryRepository();

  async getSavingGoals(userId: string, status?: SavingGoalStatus) {
    return this.savingGoalRepo.findMany(userId, { status });
  }

  async getSavingGoalById(id: string, userId: string) {
    const goal = await this.savingGoalRepo.findById(id, userId);
    if (!goal) {
      throw new Error("SAVING_GOAL_NOT_FOUND");
    }
    return goal;
  }

  async createSavingGoal(userId: string, data: {
    name: string;
    targetAmount: number | string | Decimal;
    targetDate?: Date | string | null;
    categoryId?: string | null;
    notes?: string | null;
  }) {
    const targetAmount = new Decimal(data.targetAmount);
    if (targetAmount.lessThanOrEqualTo(0)) {
      throw new Error("INVALID_TARGET_AMOUNT: Target amount must be greater than zero.");
    }

    if (data.categoryId) {
      const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
      if (!category || category.type !== CategoryType.SAVINGS) {
        throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type SAVINGS.");
      }
    }

    const targetDateObj = data.targetDate ? (typeof data.targetDate === "string" ? new Date(data.targetDate) : data.targetDate) : null;

    return this.savingGoalRepo.create(userId, {
      name: data.name,
      targetAmount,
      currentAmount: new Decimal(0),
      targetDate: targetDateObj,
      categoryId: data.categoryId ?? null,
      notes: data.notes ?? null,
      status: SavingGoalStatus.ACTIVE,
    });
  }

  async updateSavingGoal(id: string, userId: string, data: {
    name?: string;
    targetAmount?: number | string | Decimal;
    targetDate?: Date | string | null;
    categoryId?: string | null;
    status?: SavingGoalStatus;
    notes?: string | null;
  }) {
    await this.getSavingGoalById(id, userId);

    if (data.targetAmount !== undefined) {
      const targetAmount = new Decimal(data.targetAmount);
      if (targetAmount.lessThanOrEqualTo(0)) {
        throw new Error("INVALID_TARGET_AMOUNT: Target amount must be greater than zero.");
      }
    }

    if (data.categoryId) {
      const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
      if (!category || category.type !== CategoryType.SAVINGS) {
        throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type SAVINGS.");
      }
    }

    const updateData: Prisma.SavingGoalUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.targetAmount !== undefined) updateData.targetAmount = new Decimal(data.targetAmount);
    if (data.targetDate !== undefined) {
      updateData.targetDate = data.targetDate ? (typeof data.targetDate === "string" ? new Date(data.targetDate) : data.targetDate) : null;
    }
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return this.savingGoalRepo.update(id, userId, updateData, undefined);
  }

  async getTransactions(userId: string, filters: { savingGoalId?: string; page?: number; pageSize?: number }) {
    const totalItems = await this.savingTxRepo.count(userId, filters);
    const items = await this.savingTxRepo.findMany(userId, filters);

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

  async recordSavingTransaction(
    userId: string,
    goalId: string,
    data: {
      amount: number | string | Decimal;
      type: SavingTxType;
      transactionDate: Date | string;
      notes?: string | null;
      idempotencyKey?: string | null;
      syncLedger?: boolean;
    }
  ): Promise<SavingTransaction> {
    // 1. Idempotency Check
    if (data.idempotencyKey) {
      const existing = await this.savingTxRepo.findByIdempotencyKey(userId, data.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const amount = new Decimal(data.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error("INVALID_TRANSACTION_AMOUNT: Amount must be greater than zero.");
    }

    const txDateObj = typeof data.transactionDate === "string" ? new Date(data.transactionDate) : data.transactionDate;

    return db.$transaction(async (tx) => {
      const goal = await this.savingGoalRepo.findById(goalId, userId, tx);
      if (!goal) {
        throw new Error("SAVING_GOAL_NOT_FOUND: Savings goal not found or unauthorized.");
      }

      if (goal.status === SavingGoalStatus.ARCHIVED || goal.status === SavingGoalStatus.PAUSED) {
        throw new Error("ARCHIVED_OR_PAUSED: Paused or archived goals cannot receive transactions.");
      }

      const balanceBefore = new Decimal(goal.currentAmount);
      let balanceAfter = new Decimal(0);
      let newStatus = goal.status;

      if (data.type === SavingTxType.DEPOSIT) {
        balanceAfter = balanceBefore.plus(amount);
        if (balanceAfter.greaterThanOrEqualTo(goal.targetAmount)) {
          newStatus = SavingGoalStatus.COMPLETED;
        }
      } else if (data.type === SavingTxType.WITHDRAWAL) {
        if (amount.greaterThan(balanceBefore)) {
          throw new Error("INSUFFICIENT_FUNDS: Withdrawal amount cannot exceed current amount.");
        }
        balanceAfter = balanceBefore.minus(amount);
        // Note: Revert status is NOT automatic for withdrawals. Completed means achieved historically.
      }

      let transactionId: string | null = null;

      if (data.syncLedger) {
        if (!goal.categoryId) {
          throw new Error("MISSING_LEDGER_CATEGORY: No category is configured. Configure a Category of type SAVINGS to link this transaction to the ledger.");
        }

        const category = await this.categoryRepo.findByIdAndUserId(goal.categoryId, userId, tx);
        if (!category || category.type !== CategoryType.SAVINGS) {
          throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type SAVINGS.");
        }

        const direction = data.type === SavingTxType.DEPOSIT ? CashFlowDirection.OUTFLOW : CashFlowDirection.INFLOW;
        const description = data.type === SavingTxType.DEPOSIT ? `Deposit to goal: ${goal.name}` : `Withdrawal from goal: ${goal.name}`;

        const { getActiveFinancialCycle } = await import("@/lib/salary-month");
        const activeBudgetMonth = await getActiveFinancialCycle(userId, txDateObj, tx);

        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: txDateObj,
            budgetMonth: activeBudgetMonth,
            categoryId: goal.categoryId,
            description,
            amount: amount,
            paymentMethod: "Bank Transfer",
            notes: data.notes ?? `Automated link from savings transaction`,
            type: TransactionType.SAVINGS,
            cashFlowDirection: direction,
          },
        });
        transactionId = ledgerTx.id;
      }

      // Record Savings Transaction
      const savingTx = await this.savingTxRepo.create(
        userId,
        {
          savingGoalId: goalId,
          amount,
          balanceBefore,
          balanceAfter,
          type: data.type,
          transactionDate: txDateObj,
          notes: data.notes ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          transactionId,
        },
        tx
      );

      // Update Saving Goal (with Version concurrency verification)
      await this.savingGoalRepo.update(
        goalId,
        userId,
        { currentAmount: balanceAfter, status: newStatus },
        goal.version,
        tx
      );

      // Audit deposit/withdrawal atomically (action=CREATE on SAVING_TRANSACTION entity)
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.CREATE,
          entityType: AuditEntityType.SAVING_TRANSACTION,
          entityId: savingTx.id,
          before: { currentAmount: balanceBefore.toString(), status: goal.status },
          after: {
            currentAmount: balanceAfter.toString(),
            status: newStatus,
            txType: data.type,
            transactionAmount: amount.toString(),
          },
        },
        tx
      );

      return savingTx;
    });
  }
}
