import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { DebtService } from "@/server/services/debt.service";
import { CategoryType, DebtStatus, TransactionType, CashFlowDirection } from "@prisma/client";

describe("Manual Debt / Loan Payment Functionality", () => {
  const debtService = new DebtService();
  let userId: string;
  let debtId: string;

  beforeEach(async () => {
    // Clean DB
    await db.auditLog.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({});

    // Create test user
    const user = await db.user.create({
      data: {
        email: "debt_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Debt Tester",
      },
    });
    userId = user.id;

    // Create active debt with balance 1000 and no categoryId
    const debt = await db.debt.create({
      data: {
        userId,
        name: "Personal Loan",
        originalBalance: 1000,
        currentBalance: 1000,
        monthlyPayment: 200,
        dueDay: 15,
        rolloverFeeRate: 0,
      },
    });
    debtId = debt.id;
  });

  it("records payment with syncLedger = false and reduces current balance", async () => {
    const payment = await debtService.recordDebtPayment(userId, debtId, {
      amount: 250,
      paymentDate: new Date(),
      notes: "Cash payment",
      syncLedger: false,
    });

    expect(payment.id).toBeDefined();
    expect(payment.transactionId).toBeNull();
    expect(payment.balanceBefore.toNumber()).toBe(1000);
    expect(payment.balanceAfter.toNumber()).toBe(750);

    // Verify debt balance in DB
    const updatedDebt = await db.debt.findUnique({ where: { id: debtId } });
    expect(updatedDebt?.currentBalance.toNumber()).toBe(750);
    expect(updatedDebt?.status).toBe(DebtStatus.ACTIVE);

    // Verify zero ledger transactions created
    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(0);
  });

  it("records payment with syncLedger = true, auto-creating system 'Debt Payment' category", async () => {
    const payment = await debtService.recordDebtPayment(userId, debtId, {
      amount: 300,
      paymentDate: new Date(),
      notes: "Ledger payment",
      syncLedger: true,
    });

    expect(payment.transactionId).not.toBeNull();
    expect(payment.balanceAfter.toNumber()).toBe(700);

    // Verify auto-created system category
    const category = await db.category.findFirst({
      where: { userId, name: "Debt Payment", type: CategoryType.DEBT },
    });
    expect(category).not.toBeNull();

    // Verify created ledger transaction
    const ledgerTx = await db.transaction.findUnique({
      where: { id: payment.transactionId! },
    });
    expect(ledgerTx).not.toBeNull();
    expect(ledgerTx?.categoryId).toBe(category!.id);
    expect(ledgerTx?.amount.toNumber()).toBe(300);
    expect(ledgerTx?.type).toBe(TransactionType.DEBT_PAYMENT);
    expect(ledgerTx?.cashFlowDirection).toBe(CashFlowDirection.OUTFLOW);
  });

  it("reuses existing category of type DEBT if configured on debt", async () => {
    const customCategory = await db.category.create({
      data: {
        userId,
        name: "Custom Loan Payoff",
        type: CategoryType.DEBT,
      },
    });

    await db.debt.update({
      where: { id: debtId },
      data: { categoryId: customCategory.id },
    });

    const payment = await debtService.recordDebtPayment(userId, debtId, {
      amount: 100,
      paymentDate: new Date(),
      syncLedger: true,
    });

    const ledgerTx = await db.transaction.findUnique({
      where: { id: payment.transactionId! },
    });
    expect(ledgerTx?.categoryId).toBe(customCategory.id);
  });

  it("rejects payment of 0 or negative amount", async () => {
    await expect(
      debtService.recordDebtPayment(userId, debtId, {
        amount: 0,
        paymentDate: new Date(),
      })
    ).rejects.toThrow("Payment must be greater than zero.");
  });

  it("rejects payment exceeding remaining debt balance", async () => {
    await expect(
      debtService.recordDebtPayment(userId, debtId, {
        amount: 1500,
        paymentDate: new Date(),
      })
    ).rejects.toThrow("Payment amount cannot exceed the remaining balance.");
  });

  it("marks debt as PAID when balance reaches zero", async () => {
    const payment = await debtService.recordDebtPayment(userId, debtId, {
      amount: 1000,
      paymentDate: new Date(),
    });

    expect(payment.balanceAfter.toNumber()).toBe(0);

    const updatedDebt = await db.debt.findUnique({ where: { id: debtId } });
    expect(updatedDebt?.status).toBe(DebtStatus.PAID);
    expect(updatedDebt?.currentBalance.toNumber()).toBe(0);
  });
});
