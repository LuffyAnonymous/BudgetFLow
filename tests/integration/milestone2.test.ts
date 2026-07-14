import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { TransactionService } from "@/server/services/transaction.service";
import { BudgetService } from "@/server/services/budget.service";
import { CategoryType, TransactionType } from "@prisma/client";
import { Decimal } from "decimal.js";

async function clearDatabase() {
  // Truncate tables cascade
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Category", "Transaction", "Budget", "Debt", "DebtPayment", "SavingGoal", "SavingTransaction", "Remittance", "Setting" CASCADE;`
  );
}

describe("Milestone 2 Integration Tests", () => {
  const transactionService = new TransactionService();
  const budgetService = new BudgetService();

  let userAId: string;
  let userBId: string;
  
  let catAExpenseId: string; // VARIABLE_EXPENSE Category for A
  let catBId: string; // Category for B

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

    // 2. Create category for User A
    await db.category.create({
      data: {
        name: "Salary A",
        type: CategoryType.INCOME,
        userId: userAId,
      },
    });

    const catAExpense = await db.category.create({
      data: {
        name: "Food A",
        type: CategoryType.VARIABLE_EXPENSE,
        userId: userAId,
        budgetGroupKey: "FOOD",
      },
    });
    catAExpenseId = catAExpense.id;

    // 3. Create category for User B
    const catB = await db.category.create({
      data: {
        name: "Salary B",
        type: CategoryType.INCOME,
        userId: userBId,
      },
    });
    catBId = catB.id;
  });

  // 1. CRUD Scoping & Validation
  describe("Transaction CRUD Scoping & Leakage Guards", () => {
    test("Creating transaction validates category ownership", async () => {
      // User A tries to create transaction using User B's category
      await expect(
        transactionService.createTransaction(userAId, {
          date: new Date(),
          categoryId: catBId,
          description: "Trying to hijack B category",
          amount: new Decimal("50.00"),
          paymentMethod: "Cash",
          notes: null,
          type: TransactionType.INCOME,
        })
      ).rejects.toThrow("INVALID_CATEGORY");
    });

    test("Successfully creates, edits, and deletes transaction for User A", async () => {
      // Create
      const tx = await transactionService.createTransaction(userAId, {
        date: new Date("2026-07-11T12:00:00Z"),
        categoryId: catAExpenseId,
        description: "AED 100 groceries",
        amount: new Decimal("100.00"),
        paymentMethod: "Card",
        notes: "Healthy food",
        type: TransactionType.EXPENSE,
      });

      expect(tx.id).toBeDefined();
      expect(tx.userId).toBe(userAId);
      expect(tx.amount.toString()).toBe("100");

      // Edit
      const updated = await transactionService.updateTransaction(tx.id, userAId, {
        description: "AED 120 organic groceries",
        amount: new Decimal("120.00"),
      });
      expect(updated.description).toBe("AED 120 organic groceries");
      expect(updated.amount.toString()).toBe("120");

      // Delete
      await transactionService.deleteTransaction(tx.id, userAId);
      const searchResult = await transactionService.getTransactionById(tx.id, userAId);
      expect(searchResult).toBeNull();
    });

    test("User B cannot access or modify User A's transactions", async () => {
      // Create tx for User A
      const txA = await transactionService.createTransaction(userAId, {
        date: new Date(),
        categoryId: catAExpenseId,
        description: "User A expense",
        amount: new Decimal("10.00"),
        paymentMethod: "Cash",
        notes: null,
        type: TransactionType.EXPENSE,
      });

      // User B tries to view -> should return null
      const fetchByB = await transactionService.getTransactionById(txA.id, userBId);
      expect(fetchByB).toBeNull();

      // User B tries to update -> should throw error
      await expect(
        transactionService.updateTransaction(txA.id, userBId, {
          description: "Hijacked description",
        })
      ).rejects.toThrow("TRANSACTION_NOT_FOUND");

      // User B tries to delete -> should throw error
      await expect(
        transactionService.deleteTransaction(txA.id, userBId)
      ).rejects.toThrow("TRANSACTION_NOT_FOUND");
    });
  });

  // 2. Budget Operations
  describe("Budget Management & Atomic Copy", () => {
    test("Allows creating and updating category budget plan", async () => {
      const budget = await budgetService.upsertBudget(userAId, {
        categoryId: catAExpenseId,
        amount: new Decimal("900.00"),
        month: "2026-07",
      });

      expect(budget.id).toBeDefined();
      expect(budget.amount.toString()).toBe("900");

      // Update
      const updated = await budgetService.upsertBudget(userAId, {
        categoryId: catAExpenseId,
        amount: new Decimal("950.00"),
        month: "2026-07",
      });
      expect(updated.amount.toString()).toBe("950");
    });

    test("Atomic Month Plan Duplication (Copy Budgets)", async () => {
      // 1. Seed budgets for User A in source month (2026-06)
      await budgetService.upsertBudget(userAId, {
        categoryId: catAExpenseId,
        amount: new Decimal("900.00"),
        month: "2026-06",
      });

      // 2. Copy to target month (2026-07)
      const copyResult = await budgetService.copyPreviousMonthBudgets(
        userAId,
        "2026-06",
        "2026-07"
      );
      expect(copyResult.copiedCount).toBe(1);

      // Verify budget exists in 2026-07
      const budgetsTarget = await db.budget.findMany({
        where: { userId: userAId, month: "2026-07" },
      });
      expect(budgetsTarget.length).toBe(1);
      expect(budgetsTarget[0].amount.toString()).toBe("900");

      // 3. Trying to duplicate again to 2026-07 should throw an atomic collision error
      await expect(
        budgetService.copyPreviousMonthBudgets(userAId, "2026-06", "2026-07")
      ).rejects.toThrow("Target month already contains budget configurations.");
    });
  });
});
