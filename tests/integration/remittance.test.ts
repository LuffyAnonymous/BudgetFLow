import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { RemittanceService } from "@/server/services/remittance.service";
import { ReportService } from "@/server/services/report.service";
import { CategoryType, TransactionType, CashFlowDirection, RemittanceStatus } from "@prisma/client";

async function clearDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Category", "Transaction", "Budget", "Debt", "DebtPayment", "SavingGoal", "SavingTransaction", "Remittance", "Setting" CASCADE;`
  );
}

describe("Remittance & Reporting Integration Tests", () => {
  const remittanceService = new RemittanceService();
  const reportService = new ReportService();

  let userAId: string;
  let userBId: string;
  let catAId: string;

  beforeEach(async () => {
    await clearDatabase();

    // 1. Create two test users
    const userA = await db.user.create({
      data: {
        email: "user_a@test.com",
        passwordHash: "hashed_pwd_a",
        name: "User A",
      },
    });
    userAId = userA.id;

    const userB = await db.user.create({
      data: {
        email: "user_b@test.com",
        passwordHash: "hashed_pwd_b",
        name: "User B",
      },
    });
    userBId = userB.id;

    // 2. Create REMITTANCE categories
    const catA = await db.category.create({
      data: {
        name: "Remittance A",
        type: CategoryType.REMITTANCE,
        userId: userAId,
      },
    });
    catAId = catA.id;

    await db.category.create({
      data: {
        name: "Remittance B",
        type: CategoryType.REMITTANCE,
        userId: userBId,
      },
    });
  });

  describe("Remittance Creation & Ledger Sync", () => {
    test("Linked remittance and ledger transaction are created atomically", async () => {
      const remittance = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date("2026-07-11"),
        syncLedger: true,
        categoryId: catAId,
      });

      expect(remittance.id).toBeDefined();
      expect(remittance.transactionId).toBeDefined();
      expect(remittance.status).toBe(RemittanceStatus.COMPLETED);

      // Verify transaction in DB
      const ledgerTx = await db.transaction.findUnique({
        where: { id: remittance.transactionId! },
      });

      expect(ledgerTx).toBeDefined();
      expect(ledgerTx!.amount.toFixed(2)).toBe("715.00"); // 700 + 15
      expect(ledgerTx!.type).toBe(TransactionType.REMITTANCE);
      expect(ledgerTx!.cashFlowDirection).toBe(CashFlowDirection.OUTFLOW);
    });

    test("Failed ledger sync rolls back remittance creation", async () => {
      // Cause category fetch to fail or be invalid to trigger rollback
      await expect(
        remittanceService.createRemittance(userAId, {
          recipient: "Maria Clara",
          amountSentAed: 700,
          exchangeRate: 15.2,
          transferFeeAed: 15,
          transferProvider: "GCash",
          transferDate: new Date(),
          syncLedger: true,
          categoryId: "invalid-uuid-format-that-causes-prisma-to-fail",
        })
      ).rejects.toThrow();

      // Verify no remittance was created
      const count = await db.remittance.count();
      expect(count).toBe(0);
    });

    test("Unlinked remittance does not create transaction and is excluded from actual cash flow", async () => {
      const remittance = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date("2026-07-11"),
        syncLedger: false,
      });

      expect(remittance.id).toBeDefined();
      expect(remittance.transactionId).toBeNull();

      // Check monthly report cash flow
      const report = await reportService.getMonthlyReport(userAId, "2026-07");
      expect(report.netCashFlow).toBe("0.00"); // 0 cash flow since unlinked
      expect(report.remittances.netAmountSent).toBe("700.00"); // gross/net sent shows up operationally
    });

    test("Duplicate idempotency key returns existing record instead of recreating", async () => {
      const key = "550e8400-e29b-41d4-a716-446655440000";

      const first = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date(),
        idempotencyKey: key,
      });

      const second = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date(),
        idempotencyKey: key,
      });

      expect(first.id).toBe(second.id);
      const count = await db.remittance.count();
      expect(count).toBe(1);
    });
  });

  describe("Remittance Reversal & Auditing", () => {
    test("Reversal creates correct offsetting ledger entry and blocks double-reversal", async () => {
      const remittance = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date("2026-07-11"),
        syncLedger: true,
        categoryId: catAId,
      });

      // Reverse it
      const reversed = await remittanceService.reverseRemittance(remittance.id, userAId, {
        reversalReason: "Incorrect amount entered",
        reversalIdempotencyKey: "rev-key-123",
      });

      expect(reversed.status).toBe(RemittanceStatus.REVERSED);
      expect(reversed.reversalTransactionId).toBeDefined();
      expect(reversed.reversedAt).toBeDefined();

      // Verify offsetting transaction
      const offsetTx = await db.transaction.findUnique({
        where: { id: reversed.reversalTransactionId! },
      });

      expect(offsetTx).toBeDefined();
      expect(offsetTx!.amount.toFixed(2)).toBe("715.00"); // Original outflow sum
      expect(offsetTx!.cashFlowDirection).toBe(CashFlowDirection.INFLOW); // Offsetting inflow

      // Attempting second reversal fails
      await expect(
        remittanceService.reverseRemittance(remittance.id, userAId, {
          reversalReason: "Another retry",
        })
      ).rejects.toThrow("REMITTANCE_ALREADY_REVERSED");
    });

    test("Cross-user reversal is rejected", async () => {
      const remittance = await remittanceService.createRemittance(userAId, {
        recipient: "Maria Clara",
        amountSentAed: 700,
        exchangeRate: 15.2,
        transferFeeAed: 15,
        transferProvider: "GCash",
        transferDate: new Date(),
        syncLedger: false,
      });

      // User B attempts to reverse User A's remittance
      await expect(
        remittanceService.reverseRemittance(remittance.id, userBId, {
          reversalReason: "Hijack",
        })
      ).rejects.toThrow("REMITTANCE_NOT_FOUND");
    });
  });

  describe("Reporting & Security", () => {
    test("Monthly reports strictly isolate other users' data", async () => {
      // User A records remittance
      await remittanceService.createRemittance(userAId, {
        recipient: "Maria A",
        amountSentAed: 500,
        exchangeRate: 15.0,
        transferFeeAed: 10,
        transferProvider: "GCash",
        transferDate: new Date("2026-07-11"),
        syncLedger: false,
      });

      // User B records remittance
      await remittanceService.createRemittance(userBId, {
        recipient: "Maria B",
        amountSentAed: 900,
        exchangeRate: 15.0,
        transferFeeAed: 10,
        transferProvider: "GCash",
        transferDate: new Date("2026-07-11"),
        syncLedger: false,
      });

      const reportA = await reportService.getMonthlyReport(userAId, "2026-07");
      const reportB = await reportService.getMonthlyReport(userBId, "2026-07");

      expect(reportA.remittances.netAmountSent).toBe("500.00");
      expect(reportB.remittances.netAmountSent).toBe("900.00");
    });
  });
});
