import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { RecurringService } from "@/server/services/recurring.service";
import { SettingsService } from "@/server/services/settings.service";
import { MonthlyRolloverService } from "@/server/services/monthly-rollover.service";
import { CategoryType, TransactionType, RecurringFrequency } from "@prisma/client";
import bcryptjs from "bcryptjs";

async function clearDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Category", "Transaction", "Budget", "Debt", "DebtPayment", "SavingGoal", "SavingTransaction", "Remittance", "Setting", "RecurringTemplate", "RecurringOccurrence", "Notification", "MonthlyRollover" CASCADE;`
  );
}

describe("Milestone 5 Integration Tests", () => {
  const recurringService = new RecurringService();
  const settingsService = new SettingsService();
  const rolloverService = new MonthlyRolloverService();

  let userAId: string;
  let userBId: string;
  let catAId: string;
  let catBId: string;

  beforeEach(async () => {
    await clearDatabase();

    // Create users
    const userA = await db.user.create({
      data: {
        email: "user_a@milestone5.com",
        passwordHash: "old_hashed_pwd",
        name: "User A",
      },
    });
    userAId = userA.id;

    const userB = await db.user.create({
      data: {
        email: "user_b@milestone5.com",
        passwordHash: "user_b_pwd",
        name: "User B",
      },
    });
    userBId = userB.id;

    // Create settings
    await db.setting.create({
      data: {
        userId: userAId,
        monthlySalary: 10000.0,
        payday: 25,
        timezone: "Asia/Dubai",
      },
    });

    // Create Category
    const catA = await db.category.create({
      data: {
        name: "Rent A",
        type: CategoryType.FIXED_EXPENSE,
        userId: userAId,
      },
    });
    catAId = catA.id;

    const catB = await db.category.create({
      data: {
        name: "Rent B",
        type: CategoryType.FIXED_EXPENSE,
        userId: userBId,
      },
    });
    catBId = catB.id;
  });

  describe("Password Invalidation & Session version", () => {
    test("changing password should increment sessionVersion to invalidate tokens", async () => {
      const initialUser = await db.user.findUnique({ where: { id: userAId } });
      expect(initialUser?.sessionVersion).toBe(0);

      const hashed = await bcryptjs.hash("my_current_pwd", 12);
      await db.user.update({
        where: { id: userAId },
        data: { passwordHash: hashed },
      });

      // Perform password change
      const result = await settingsService.changePassword(userAId, {
        currentPassword: "my_current_pwd",
        newPassword: "new_super_secure_pwd_123",
        confirmPassword: "new_super_secure_pwd_123",
      });
      expect(result.success).toBe(true);

      const updatedUser = await db.user.findUnique({ where: { id: userAId } });
      expect(updatedUser?.sessionVersion).toBe(1);
    });
  });

  describe("Recurring Service Integrations", () => {
    test("should reject non-monthly frequency template creation", async () => {
      await expect(
        recurringService.createTemplate(userAId, {
          name: "Weekly Nol",
          transactionType: TransactionType.EXPENSE,
          amount: 50.0,
          frequency: RecurringFrequency.WEEKLY,
          startDate: new Date("2026-07-01"),
        })
      ).rejects.toThrow("UNSUPPORTED_FREQUENCY");
    });

    test("should support reminder-only templates without a category", async () => {
      const template = await recurringService.createTemplate(userAId, {
        name: "General Reminder",
        transactionType: TransactionType.EXPENSE,
        amount: 250.0,
        frequency: RecurringFrequency.MONTHLY,
        startDate: new Date("2026-07-01"),
        autoCreate: false,
        categoryId: null, // allowed!
      });
      expect(template.categoryId).toBeNull();
    });

    test("should reject auto-create templates without a category", async () => {
      await expect(
        recurringService.createTemplate(userAId, {
          name: "Auto Bill",
          transactionType: TransactionType.EXPENSE,
          amount: 250.0,
          frequency: RecurringFrequency.MONTHLY,
          startDate: new Date("2026-07-01"),
          autoCreate: true,
          categoryId: null, // rejected!
        })
      ).rejects.toThrow("CATEGORY_REQUIRED");
    });

    test("should enforce correct category compatibility on creation", async () => {
      // INCOME template with EXPENSE category
      await expect(
        recurringService.createTemplate(userAId, {
          name: "Auto Salary",
          transactionType: TransactionType.INCOME,
          amount: 15000.0,
          frequency: RecurringFrequency.MONTHLY,
          startDate: new Date("2026-07-01"),
          autoCreate: true,
          categoryId: catAId, // EXPENSE category
        })
      ).rejects.toThrow("INCOMPATIBLE_CATEGORY");
    });

    test("should reject cross-user category assignments", async () => {
      await expect(
        recurringService.createTemplate(userAId, {
          name: "Rob Category",
          transactionType: TransactionType.EXPENSE,
          amount: 100.0,
          frequency: RecurringFrequency.MONTHLY,
          startDate: new Date("2026-07-01"),
          autoCreate: false,
          categoryId: catBId, // user B's category
        })
      ).rejects.toThrow("CATEGORY_NOT_FOUND");
    });

    test("should reject auto-create for special domain types (DEBT_PAYMENT, SAVINGS, REMITTANCE)", async () => {
      await expect(
        recurringService.createTemplate(userAId, {
          name: "Auto Debt",
          transactionType: TransactionType.DEBT_PAYMENT,
          amount: 1000.0,
          frequency: RecurringFrequency.MONTHLY,
          startDate: new Date("2026-07-01"),
          autoCreate: true,
        })
      ).rejects.toThrow("AUTO_CREATE_UNSUPPORTED");
    });

    test("evaluation twice should not create duplicate occurrences (idempotency index)", async () => {
      await recurringService.createTemplate(userAId, {
        name: "Rent Bill",
        transactionType: TransactionType.EXPENSE,
        amount: 3000.0,
        frequency: RecurringFrequency.MONTHLY,
        startDate: new Date("2026-07-01"),
        autoCreate: true,
        categoryId: catAId,
      });

      // Run evaluation twice
      const res1 = await recurringService.evaluateOccurrences(userAId, new Date("2026-07-01"), new Date("2026-07-31"));
      const res2 = await recurringService.evaluateOccurrences(userAId, new Date("2026-07-01"), new Date("2026-07-31"));

      expect(res1.created).toBe(1);
      expect(res1.completed).toBe(1);

      expect(res2.created).toBe(0);
      expect(res2.completed).toBe(0);

      const occs = await db.recurringOccurrence.findMany({ where: { userId: userAId } });
      expect(occs.length).toBe(1);

      const txs = await db.transaction.findMany({ where: { userId: userAId } });
      expect(txs.length).toBe(1);
    });

    test("archiving template preserves its occurrences (onDelete: Restrict)", async () => {
      const template = await recurringService.createTemplate(userAId, {
        name: "Temp Bill",
        transactionType: TransactionType.EXPENSE,
        amount: 100.0,
        frequency: RecurringFrequency.MONTHLY,
        startDate: new Date("2026-07-01"),
        autoCreate: false,
      });

      await recurringService.evaluateOccurrences(userAId, new Date("2026-07-01"), new Date("2026-07-31"));

      // Archive template
      await recurringService.archiveTemplate(template.id, userAId);

      const occs = await db.recurringOccurrence.findMany({ where: { userId: userAId } });
      expect(occs.length).toBe(1);
    });
  });

  describe("Monthly Rollover Service Integrations", () => {
    test("should reject rollover if target month is not empty", async () => {
      // Create a budget in target month
      await db.budget.create({
        data: {
          userId: userAId,
          categoryId: catAId,
          amount: 3000.0,
          month: "2026-08",
        },
      });

      await expect(
        rolloverService.confirmRollover(userAId, "2026-07", "2026-08")
      ).rejects.toThrow("TARGET_MONTH_NOT_EMPTY");
    });

    test("should allow rollover if target month is empty, and enforce idempotency", async () => {
      // Create a source budget in 2026-07
      await db.budget.create({
        data: {
          userId: userAId,
          categoryId: catAId,
          amount: 2500.0,
          month: "2026-07",
        },
      });

      const res = await rolloverService.confirmRollover(userAId, "2026-07", "2026-08");
      expect(res.copiedBudgetCount).toBe(1);

      // Verify budget got copied
      const budgets = await db.budget.findMany({ where: { userId: userAId, month: "2026-08" } });
      expect(budgets.length).toBe(1);
      expect(budgets[0]?.amount.toString()).toBe("2500");

      // Repeated confirm should yield the same result (idempotency)
      const repeated = await rolloverService.confirmRollover(userAId, "2026-07", "2026-08");
      expect(repeated.copiedBudgetCount).toBe(1);
    });
  });
});
