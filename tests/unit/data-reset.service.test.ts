import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { dataResetService } from "@/server/services/data-reset.service";
import {
  AccountType,
  DebtStatus,
  SavingGoalStatus,
  ImportSource,
  ImportStatus,
  AuditAction,
  TransactionType,
  TransactionOrigin,
  CashFlowDirection,
} from "@prisma/client";

describe("DataResetService.resetAllFinancialData", () => {
  let userId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.attachment.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.savingTransaction.deleteMany({});
    await db.remittance.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.debt.deleteMany({});
    await db.savingGoal.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "data_reset_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "data_reset_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Data Reset Tester" },
    });
    userId = user.id;
  });

  it("deletes all transactions and resets account/debt/saving-goal balances to their starting state", async () => {
    const account = await db.account.create({
      data: {
        userId,
        type: AccountType.EMIRATES_NBD,
        name: "Test ENBD",
        currentBalance: 4321.5,
        latestImportedBalance: 4321.5,
        lastSMSImportedAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
      },
    });

    const category = await db.category.create({ data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" } });

    const tx = await db.transaction.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: category.id,
        amount: 100,
        description: "Test transaction",
        date: new Date(),
        type: TransactionType.EXPENSE,
        origin: TransactionOrigin.MANUAL,
        paymentMethod: "Manual",
        cashFlowDirection: CashFlowDirection.OUTFLOW,
      },
    });

    const debt = await db.debt.create({
      data: {
        userId,
        name: "Test Debt",
        originalBalance: 5000,
        currentBalance: 3200, // partially paid down
        monthlyPayment: 500,
        dueDay: 1,
        rolloverFeeRate: 0,
        status: DebtStatus.PAID,
      },
    });

    await db.debtPayment.create({
      data: {
        userId,
        debtId: debt.id,
        amount: 1800,
        balanceBefore: 5000,
        balanceAfter: 3200,
        paymentDate: new Date(),
      },
    });

    const goal = await db.savingGoal.create({
      data: {
        userId,
        name: "Test Goal",
        targetAmount: 10000,
        currentAmount: 2500,
        status: SavingGoalStatus.COMPLETED,
      },
    });

    await db.savingTransaction.create({
      data: {
        userId,
        savingGoalId: goal.id,
        amount: 2500,
        balanceBefore: 0,
        balanceAfter: 2500,
        type: "DEPOSIT",
        transactionDate: new Date(),
      },
    });

    await db.remittance.create({
      data: {
        userId,
        amountSentAed: 1000,
        cashOutflowAed: 1000,
        transferProvider: "Test Provider",
        transferDate: new Date(),
      },
    });

    await db.importedTransaction.create({
      data: {
        userId,
        source: ImportSource.EMAIL,
        institution: "Test Bank",
        status: ImportStatus.PROCESSED,
        transactionId: tx.id,
        rawPayload: "raw",
        redactedPayload: "redacted",
        payloadHash: "hash-reset-test-1",
        fingerprint: "fp-reset-test-1",
        receivedAt: new Date(),
      },
    });

    const summary = await dataResetService.resetAllFinancialData(userId);

    expect(summary.transactionsDeleted).toBe(1);
    expect(summary.debtPaymentsDeleted).toBe(1);
    expect(summary.savingTransactionsDeleted).toBe(1);
    expect(summary.remittancesDeleted).toBe(1);
    expect(summary.importedTransactionsDeleted).toBe(1);
    expect(summary.accountsReset).toBe(1);
    expect(summary.debtsReset).toBe(1);
    expect(summary.savingGoalsReset).toBe(1);

    expect(await db.transaction.count({ where: { userId } })).toBe(0);
    expect(await db.debtPayment.count({ where: { userId } })).toBe(0);
    expect(await db.savingTransaction.count({ where: { userId } })).toBe(0);
    expect(await db.remittance.count({ where: { userId } })).toBe(0);
    expect(await db.importedTransaction.count({ where: { userId } })).toBe(0);

    const resetAccount = await db.account.findUnique({ where: { id: account.id } });
    expect(resetAccount!.currentBalance.toNumber()).toBe(0);
    expect(resetAccount!.latestImportedBalance).toBeNull();
    expect(resetAccount!.lastSMSImportedAt).toBeNull();
    expect(resetAccount!.lastSuccessfulSyncAt).toBeNull();

    const resetDebt = await db.debt.findUnique({ where: { id: debt.id } });
    expect(resetDebt!.currentBalance.toNumber()).toBe(5000); // back to originalBalance
    expect(resetDebt!.status).toBe(DebtStatus.ACTIVE);

    const resetGoal = await db.savingGoal.findUnique({ where: { id: goal.id } });
    expect(resetGoal!.currentAmount.toNumber()).toBe(0);
    expect(resetGoal!.status).toBe(SavingGoalStatus.ACTIVE);

    // The account/category/debt/goal *setup* itself is kept, not deleted.
    expect(await db.account.count({ where: { userId } })).toBe(1);
    expect(await db.debt.count({ where: { userId } })).toBe(1);
    expect(await db.savingGoal.count({ where: { userId } })).toBe(1);

    const logs = await db.auditLog.findMany({ where: { userId, action: AuditAction.ALL_FINANCIAL_DATA_RESET } });
    expect(logs).toHaveLength(1);
  });

  it("is a no-op-safe call when there's nothing to delete", async () => {
    const summary = await dataResetService.resetAllFinancialData(userId);
    expect(summary.transactionsDeleted).toBe(0);
    expect(summary.accountsReset).toBe(0);

    const logs = await db.auditLog.findMany({ where: { userId, action: AuditAction.ALL_FINANCIAL_DATA_RESET } });
    expect(logs).toHaveLength(1); // still logged, even with all-zero counts
  });
});
