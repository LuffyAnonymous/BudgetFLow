import { db } from "@/lib/db";
import { MonthlyRollover, CategoryType } from "@prisma/client";
import { SettingsRepository } from "../repositories/settings.repository";
import { UpcomingPaymentService } from "./upcoming-payment.service";
import { Decimal } from "decimal.js";

export interface RolloverPreviewData {
  sourceMonth: string;
  targetMonth: string;
  budgetsToCopy: { categoryName: string; amount: string }[];
  existingTargetBudgets: { categoryName: string; amount: string }[];
  itemsToSkip: string[];
  plannedSalary: string;
  totalPlannedAllocation: string;
  unallocatedAmount: string;
  overdueRemindersCount: number;
  alreadyRolledOver: boolean;
}

export class MonthlyRolloverService {
  private settingsRepo = new SettingsRepository();
  private upcomingService = new UpcomingPaymentService();

  async getRolloverPreview(userId: string, sourceMonth: string, targetMonth: string): Promise<RolloverPreviewData> {
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(sourceMonth) || !monthRegex.test(targetMonth)) {
      throw new Error("INVALID_MONTH_FORMAT: Month must be in YYYY-MM format.");
    }

    // Check if target is already rolled over
    const existingRollover = await db.monthlyRollover.findUnique({
      where: {
        userId_targetMonth: { userId, targetMonth },
      },
    });

    const settings = await this.settingsRepo.findByUserId(userId);
    const plannedSalary = settings ? settings.monthlySalary : new Decimal(0);

    // Fetch source budgets
    const sourceBudgets = await db.budget.findMany({
      where: { userId, month: sourceMonth },
      include: { category: true },
    });

    // Fetch target budgets
    const targetBudgets = await db.budget.findMany({
      where: { userId, month: targetMonth },
      include: { category: true },
    });

    const budgetsToCopy = sourceBudgets.map((b) => ({
      categoryName: b.category.name,
      amount: b.amount.toFixed(2),
    }));

    const existingTargetBudgets = targetBudgets.map((b) => ({
      categoryName: b.category.name,
      amount: b.amount.toFixed(2),
    }));

    // Items that would be skipped if we did a merge (though MVP rejects if target is not empty)
    const itemsToSkip = sourceBudgets
      .filter((sb) => targetBudgets.some((tb) => tb.categoryId === sb.categoryId))
      .map((b) => b.category.name);

    // Calculate source month planned allocations
    const plannedExpenses = sourceBudgets
      .filter((b) => b.category.type === CategoryType.FIXED_EXPENSE || b.category.type === CategoryType.VARIABLE_EXPENSE)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedSavings = sourceBudgets
      .filter((b) => b.category.type === CategoryType.SAVINGS)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedRemittances = sourceBudgets
      .filter((b) => b.category.type === CategoryType.REMITTANCE)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedDebts = sourceBudgets
      .filter((b) => b.category.type === CategoryType.DEBT)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const totalPlannedAllocation = plannedExpenses.plus(plannedSavings).plus(plannedRemittances).plus(plannedDebts);
    const unallocatedAmount = Decimal.max(0, plannedSalary.minus(totalPlannedAllocation));

    // Fetch overdue reminders count from upcoming feed
    const upcomingFeed = await this.upcomingService.getUpcomingFeed(userId);
    const overdueCount = upcomingFeed.filter((item) => item.status === "OVERDUE").length;

    return {
      sourceMonth,
      targetMonth,
      budgetsToCopy,
      existingTargetBudgets,
      itemsToSkip,
      plannedSalary: plannedSalary.toFixed(2),
      totalPlannedAllocation: totalPlannedAllocation.toFixed(2),
      unallocatedAmount: unallocatedAmount.toFixed(2),
      overdueRemindersCount: overdueCount,
      alreadyRolledOver: !!existingRollover,
    };
  }

  async confirmRollover(userId: string, sourceMonth: string, targetMonth: string): Promise<MonthlyRollover> {
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(sourceMonth) || !monthRegex.test(targetMonth)) {
      throw new Error("INVALID_MONTH_FORMAT: Month must be in YYYY-MM format.");
    }

    const idempotencyKey = `rollover:${userId}:${targetMonth}`;

    return db.$transaction(async (tx) => {
      // 1. Check if rollover already exists
      const existing = await tx.monthlyRollover.findUnique({
        where: {
          userId_targetMonth: { userId, targetMonth },
        },
      });
      if (existing) {
        return existing; // Idempotent return
      }

      // 2. Block if target month contains ANY budget records (MVP Block)
      const targetBudgetCount = await tx.budget.count({
        where: { userId, month: targetMonth },
      });
      if (targetBudgetCount > 0) {
        throw new Error("TARGET_MONTH_NOT_EMPTY: The target month already contains budget records. Rollover rejected to prevent data corruption.");
      }

      // 3. Fetch source budgets to copy
      const sourceBudgets = await tx.budget.findMany({
        where: { userId, month: sourceMonth },
      });

      // 4. Copy budgets
      const copyPromises = sourceBudgets.map((b) =>
        tx.budget.create({
          data: {
            userId,
            categoryId: b.categoryId,
            amount: b.amount,
            month: targetMonth,
          },
        })
      );
      await Promise.all(copyPromises);

      // 5. Create rollover audit entry
      return tx.monthlyRollover.create({
        data: {
          userId,
          sourceMonth,
          targetMonth,
          status: "COMPLETED",
          copiedBudgetCount: sourceBudgets.length,
          idempotencyKey,
        },
      });
    });
  }
}
