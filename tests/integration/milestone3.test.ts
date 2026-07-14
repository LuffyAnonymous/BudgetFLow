import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { DebtService } from "@/server/services/debt.service";
import { SavingService } from "@/server/services/saving.service";
import { DashboardService } from "@/server/services/dashboard.service";
import { CategoryType, TransactionType, CashFlowDirection, DebtStatus, SavingGoalStatus, SavingTxType } from "@prisma/client";

async function clearDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Category", "Transaction", "Budget", "Debt", "DebtPayment", "SavingGoal", "SavingTransaction", "Remittance", "Setting" CASCADE;`
  );
}

describe("Milestone 3 Integration Tests", () => {
  const debtService = new DebtService();
  const savingService = new SavingService();
  const dashboardService = new DashboardService();

  let userAId: string;
  let userBId: string;

  let catADebtId: string;
  let catASavingsId: string;
  


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

    // 2. Create categories for User A
    const catADebt = await db.category.create({
      data: {
        name: "Tabby Category A",
        type: CategoryType.DEBT,
        userId: userAId,
      },
    });
    catADebtId = catADebt.id;

    const catASavings = await db.category.create({
      data: {
        name: "Emergency Goal A",
        type: CategoryType.SAVINGS,
        userId: userAId,
      },
    });
    catASavingsId = catASavings.id;

    // 3. Create category for User B
    await db.category.create({
      data: {
        name: "Tabby Category B",
        type: CategoryType.DEBT,
        userId: userBId,
      },
    });
  });

  describe("Security & Cross-User Protection", () => {
    test("User B cannot access or record payments against User A's debt", async () => {
      // Create a debt for User A
      const debtA = await debtService.createDebt(userAId, {
        name: "A's Private Debt",
        originalBalance: 1000,
        monthlyPayment: 100,
        dueDay: 15,
        rolloverFeeRate: 4.5,
        categoryId: catADebtId,
      });

      // User B tries to view -> should throw DEBT_NOT_FOUND
      await expect(
        debtService.getDebtById(debtA.id, userBId)
      ).rejects.toThrow("DEBT_NOT_FOUND");

      // User B tries to pay -> should throw DEBT_NOT_FOUND (rolled back)
      await expect(
        debtService.recordDebtPayment(userBId, debtA.id, {
          amount: 50,
          paymentDate: new Date(),
          syncLedger: false,
        })
      ).rejects.toThrow("DEBT_NOT_FOUND");
    });

    test("User B cannot access User A's savings goal", async () => {
      const goalA = await savingService.createSavingGoal(userAId, {
        name: "A's Emergency Goal",
        targetAmount: 5000,
        categoryId: catASavingsId,
      });

      await expect(
        savingService.getSavingGoalById(goalA.id, userBId)
      ).rejects.toThrow("SAVING_GOAL_NOT_FOUND");
    });
  });

  describe("Debt Payments & Ledger Linking", () => {
    test("Records debt payment, adjusts balance, and optionally links ledger transaction atomically", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Credit Card Debt",
        originalBalance: 1000,
        monthlyPayment: 200,
        dueDay: 20,
        rolloverFeeRate: 3.5,
        categoryId: catADebtId,
      });

      // Record payment with ledger sync
      const payment = await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 200,
        paymentDate: new Date("2026-07-15T12:00:00Z"),
        notes: "July Payment",
        syncLedger: true,
      });

      expect(payment.id).toBeDefined();
      expect(payment.amount.toString()).toBe("200");
      expect(payment.balanceBefore.toString()).toBe("1000");
      expect(payment.balanceAfter.toString()).toBe("800");
      expect(payment.transactionId).toBeDefined();

      // Check Debt was updated
      const updatedDebt = await debtService.getDebtById(debt.id, userAId);
      expect(updatedDebt.currentBalance.toString()).toBe("800");
      expect(updatedDebt.status).toBe(DebtStatus.ACTIVE);

      // Verify transaction in main ledger
      const tx = await db.transaction.findUnique({
        where: { id: payment.transactionId! },
      });
      expect(tx).toBeDefined();
      expect(tx!.amount.toString()).toBe("200"); // Positive amount
      expect(tx!.type).toBe(TransactionType.DEBT_PAYMENT);
      expect(tx!.categoryId).toBe(catADebtId);
      expect(tx!.userId).toBe(userAId);
    });

    test("Final payment successfully transitions debt status to PAID", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Small Debt",
        originalBalance: 150,
        monthlyPayment: 200,
        dueDay: 5,
        rolloverFeeRate: 0,
        categoryId: catADebtId,
      });

      // Record final payment (exact remaining amount)
      await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 150,
        paymentDate: new Date(),
        syncLedger: false,
      });

      const updatedDebt = await debtService.getDebtById(debt.id, userAId);
      expect(updatedDebt.currentBalance.toString()).toBe("0");
      expect(updatedDebt.status).toBe(DebtStatus.PAID);
    });

    test("Reject payment amount exceeding remaining balance", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Mini Debt",
        originalBalance: 100,
        monthlyPayment: 50,
        dueDay: 5,
        rolloverFeeRate: 0,
      });

      await expect(
        debtService.recordDebtPayment(userAId, debt.id, {
          amount: 120, // 120 > 100
          paymentDate: new Date(),
        })
      ).rejects.toThrow("PAYMENT_EXCEEDS_BALANCE");
    });

    test("Reject payment with syncLedger if debt does not have category configured", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Debt without Category",
        originalBalance: 1000,
        monthlyPayment: 100,
        dueDay: 15,
        rolloverFeeRate: 0,
      });

      await expect(
        debtService.recordDebtPayment(userAId, debt.id, {
          amount: 100,
          paymentDate: new Date(),
          syncLedger: true,
        })
      ).rejects.toThrow("MISSING_LEDGER_CATEGORY");
    });
  });

  describe("Savings Transactions & Ledger Direction", () => {
    test("Savings DEPOSIT is recorded as a positive OUTFLOW ledger transaction", async () => {
      const goal = await savingService.createSavingGoal(userAId, {
        name: "Emergency Fund",
        targetAmount: 5000,
        categoryId: catASavingsId,
      });

      const tx = await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 1000,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
        syncLedger: true,
      });

      expect(tx.id).toBeDefined();
      expect(tx.balanceBefore.toString()).toBe("0");
      expect(tx.balanceAfter.toString()).toBe("1000");

      const updatedGoal = await savingService.getSavingGoalById(goal.id, userAId);
      expect(updatedGoal.currentAmount.toString()).toBe("1000");

      // Verify ledger transaction
      const ledgerTx = await db.transaction.findUnique({
        where: { id: tx.transactionId! },
      });
      expect(ledgerTx).toBeDefined();
      expect(ledgerTx!.amount.toString()).toBe("1000"); // Must be positive
      expect(ledgerTx!.type).toBe(TransactionType.SAVINGS);
      expect(ledgerTx!.cashFlowDirection).toBe(CashFlowDirection.OUTFLOW);
    });

    test("Savings WITHDRAWAL is recorded as a positive INFLOW ledger transaction", async () => {
      const goal = await savingService.createSavingGoal(userAId, {
        name: "Emergency Fund",
        targetAmount: 5000,
        categoryId: catASavingsId,
      });

      // 1. Seed initial savings balance
      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 2000,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
      });

      // 2. Withdraw 500
      const tx = await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 500,
        type: SavingTxType.WITHDRAWAL,
        transactionDate: new Date(),
        syncLedger: true,
      });

      expect(tx.balanceBefore.toString()).toBe("2000");
      expect(tx.balanceAfter.toString()).toBe("1500");

      // Verify ledger transaction
      const ledgerTx = await db.transaction.findUnique({
        where: { id: tx.transactionId! },
      });
      expect(ledgerTx).toBeDefined();
      expect(ledgerTx!.amount.toString()).toBe("500"); // Must be positive
      expect(ledgerTx!.type).toBe(TransactionType.SAVINGS);
      expect(ledgerTx!.cashFlowDirection).toBe(CashFlowDirection.INFLOW);
    });

    test("Savings withdrawal exceeding current savings is rejected", async () => {
      const goal = await savingService.createSavingGoal(userAId, {
        name: "Vacation",
        targetAmount: 3000,
      });

      await expect(
        savingService.recordSavingTransaction(userAId, goal.id, {
          amount: 100, // no funds yet
          type: SavingTxType.WITHDRAWAL,
          transactionDate: new Date(),
        })
      ).rejects.toThrow("INSUFFICIENT_FUNDS");
    });

    test("Savings goal status transitions to COMPLETED when deposit reaches target", async () => {
      const goal = await savingService.createSavingGoal(userAId, {
        name: "Car Fund",
        targetAmount: 5000,
      });

      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 5000,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
      });

      const updated = await savingService.getSavingGoalById(goal.id, userAId);
      expect(updated.status).toBe(SavingGoalStatus.COMPLETED);

      // Verify subsequent withdrawal does NOT automatically revert status from COMPLETED
      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 1000,
        type: SavingTxType.WITHDRAWAL,
        transactionDate: new Date(),
      });

      const afterWithdraw = await savingService.getSavingGoalById(goal.id, userAId);
      expect(afterWithdraw.currentAmount.toString()).toBe("4000");
      expect(afterWithdraw.status).toBe(SavingGoalStatus.COMPLETED); // Stays completed
    });
  });

  describe("Concurrency Control (Version Guard)", () => {
    test("Concurrent debt payment update conflict raises CONCURRENT_CONFLICT and rolls back", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Credit Card",
        originalBalance: 1000,
        monthlyPayment: 100,
        dueDay: 15,
        rolloverFeeRate: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = (debtService as any).debtRepo;
      
      // Update with version 0 succeeds
      await repo.update(debt.id, userAId, { currentBalance: 900 }, 0);
      
      // Attempting to update with version 0 again fails
      await expect(
        repo.update(debt.id, userAId, { currentBalance: 800 }, 0)
      ).rejects.toThrow("CONCURRENT_CONFLICT");
    });

    test("Concurrent savings withdrawal update conflict raises CONCURRENT_CONFLICT and rolls back", async () => {
      const goal = await savingService.createSavingGoal(userAId, {
        name: "Vacation",
        targetAmount: 3000,
      });

      // Record a deposit to get positive balance
      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 2000,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
      });

      const goalLatest = await savingService.getSavingGoalById(goal.id, userAId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repo = (savingService as any).savingGoalRepo;

      // Update with latest version succeeds
      await repo.update(goal.id, userAId, { currentAmount: 1900 }, goalLatest.version);

      // Attempting to update with the same version again fails
      await expect(
        repo.update(goal.id, userAId, { currentAmount: 1800 }, goalLatest.version)
      ).rejects.toThrow("CONCURRENT_CONFLICT");
    });
  });

  describe("Idempotency Safeguards", () => {
    test("Multiple submissions with duplicate idempotency key return the same payment", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Idempotent Debt",
        originalBalance: 500,
        monthlyPayment: 50,
        dueDay: 15,
        rolloverFeeRate: 0,
      });

      const key = "550e8400-e29b-41d4-a716-446655440000";

      const p1 = await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 50,
        paymentDate: new Date(),
        idempotencyKey: key,
      });

      const p2 = await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 50,
        paymentDate: new Date(),
        idempotencyKey: key, // duplicate key
      });

      expect(p1.id).toBe(p2.id);

      // Verify only 1 payment record exists in the DB
      const count = await db.debtPayment.count({
        where: { debtId: debt.id },
      });
      expect(count).toBe(1);
    });
  });

  describe("Cascade Delete Safety Rules", () => {
    test("Restrict referential action prevents deleting a parent debt when payment history exists", async () => {
      const debt = await debtService.createDebt(userAId, {
        name: "Rigid Debt",
        originalBalance: 500,
        monthlyPayment: 50,
        dueDay: 15,
        rolloverFeeRate: 0,
      });

      await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 50,
        paymentDate: new Date(),
      });

      // Try deleting parent debt - should throw a Prisma referential constraint error
      await expect(
        db.debt.delete({
          where: { id: debt.id },
        })
      ).rejects.toThrow();
    });
  });

  describe("Dashboard Aggregations & Ledger Cash Flow Scoping", () => {
    test("Actual cash flow aggregates count only linked ledger transactions (unlinked excluded)", async () => {
      // 1. Create debt & savings goal
      const debt = await debtService.createDebt(userAId, {
        name: "Tabby",
        originalBalance: 1000,
        monthlyPayment: 100,
        dueDay: 15,
        rolloverFeeRate: 0,
        categoryId: catADebtId,
      });

      const goal = await savingService.createSavingGoal(userAId, {
        name: "Emergency Fund",
        targetAmount: 5000,
        categoryId: catASavingsId,
      });

      // 2. Create actual income transaction to have a cash-flow baseline
      const incomeCat = await db.category.create({
        data: { name: "Salary", type: CategoryType.INCOME, userId: userAId },
      });
      await db.transaction.create({
        data: {
          userId: userAId,
          date: new Date(),
          categoryId: incomeCat.id,
          description: "Salary deposit",
          amount: 5000,
          paymentMethod: "Bank Transfer",
          type: TransactionType.INCOME,
        },
      });

      // 3. Record a LINKED debt payment of 100
      await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 100,
        paymentDate: new Date(),
        syncLedger: true,
      });

      // 4. Record an UNLINKED debt payment of 50
      await debtService.recordDebtPayment(userAId, debt.id, {
        amount: 50,
        paymentDate: new Date(),
        syncLedger: false,
      });

      // 5. Record a LINKED savings deposit of 200
      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 200,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
        syncLedger: true,
      });

      // 6. Record an UNLINKED savings deposit of 150
      await savingService.recordSavingTransaction(userAId, goal.id, {
        amount: 150,
        type: SavingTxType.DEPOSIT,
        transactionDate: new Date(),
        syncLedger: false,
      });

      // 7. Fetch dashboard data
      const data = await dashboardService.getDashboardData(userAId);

      // Verify that:
      // - Income is 5000
      // - Linked debt payment counts (100), unlinked (50) is excluded
      // - Linked savings counts (200), unlinked (150) is excluded
      // - Remaining balance: 5000 - 100 - 200 = 4700 (rather than including 50 or 150)
      expect(data.actual.income).toBe("5000.00");
      expect(data.actual.debtPayments).toBe("100.00");
      expect(data.actual.savings).toBe("200.00");
      expect(data.actual.remaining).toBe("4700.00");
    });
  });
});
