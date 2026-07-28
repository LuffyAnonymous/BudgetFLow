import { NotificationRepository, NotificationFilters } from "../repositories/notification.repository";
import { SettingsRepository } from "../repositories/settings.repository";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { Notification, NotificationType, NotificationSeverity, TransactionType, CashFlowDirection, AccountType } from "@prisma/client";
import { getDubaiMonthRange, getDubaiCurrentDate } from "@/lib/dates";

export class NotificationService {
  private notificationRepo = new NotificationRepository();
  private settingsRepo = new SettingsRepository();

  async getNotifications(userId: string, filters: NotificationFilters = {}) {
    const totalItems = await this.notificationRepo.count(userId, filters);
    const items = await this.notificationRepo.findMany(userId, filters);

    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 20;
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

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const existing = await this.notificationRepo.findById(id, userId);
    if (!existing) {
      throw new Error("NOTIFICATION_NOT_FOUND");
    }
    return this.notificationRepo.update(id, userId, { readAt: new Date() });
  }

  async dismiss(id: string, userId: string): Promise<Notification> {
    const existing = await this.notificationRepo.findById(id, userId);
    if (!existing) {
      throw new Error("NOTIFICATION_NOT_FOUND");
    }
    return this.notificationRepo.update(id, userId, { dismissedAt: new Date() });
  }

  async markAllAsRead(userId: string): Promise<number> {
    return this.notificationRepo.markAllRead(userId);
  }

  /**
   * Helper to create a notification if it does not already exist
   */
  async createNotificationIdempotent(
    userId: string,
    data: {
      type: NotificationType;
      title: string;
      message: string;
      severity: NotificationSeverity;
      eventKey: string;
      relatedEntityType?: string;
      relatedEntityId?: string;
      destinationPath?: string;
    }
  ): Promise<Notification | null> {
    const existing = await this.notificationRepo.findByEventKey(userId, data.eventKey);
    if (existing) {
      return null; // Skip if already alerted
    }
    return this.notificationRepo.create(userId, data);
  }

  /**
   * Evaluates all notification conditions for the user in their configured timezone
   */
  async evaluateNotifications(userId: string): Promise<{ evaluated: number; created: number }> {
    // 1. Get active month parts in Dubai timezone
    const nowDubai = getDubaiCurrentDate();
    const activeMonthStr = `${nowDubai.year}-${String(nowDubai.month).padStart(2, "0")}`;
    const todayStr = `${activeMonthStr}-${String(nowDubai.day).padStart(2, "0")}`;

    // 2. Fetch budgets for active month
    const budgets = await db.budget.findMany({
      where: { userId, month: activeMonthStr },
      include: { category: true },
    });

    // 3. Fetch transactions for active month
    const { start, nextMonthStart } = getDubaiMonthRange(activeMonthStr);
    const transactions = await db.transaction.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lt: nextMonthStart,
        },
      },
      include: { category: true },
    });

    // Fetch user preferences/thresholds
    const userSettings = await db.setting.findUnique({
      where: { userId },
    });

    const pref = (userSettings?.notificationPref as any) || {};
    const safeDailyThreshold = new Decimal(pref.safeDailyThreshold ?? "50.00");
    const largeExpenseThreshold = new Decimal(pref.largeExpenseThreshold ?? "1500.00");

    let createdCount = 0;
    let evaluatedCount = 0;

    // A. Check Budget Category Limits
    const spentMap: Record<string, Decimal> = {};
    transactions.forEach((tx) => {
      const isOutflow = tx.cashFlowDirection === CashFlowDirection.OUTFLOW ||
        (tx.cashFlowDirection === null && tx.type !== TransactionType.INCOME);
      
      if (isOutflow) {
        spentMap[tx.categoryId] = (spentMap[tx.categoryId] || new Decimal(0)).add(tx.amount);
      }
    });

    for (const b of budgets) {
      evaluatedCount++;
      const budgetAmount = b.amount;
      const actualSpent = spentMap[b.categoryId] || new Decimal(0);
      
      if (budgetAmount.greaterThan(0)) {
        const ratio = actualSpent.div(budgetAmount).toNumber();
        
        // 100% Limit warning
        if (ratio >= 1.0) {
          const alert = await this.createNotificationIdempotent(userId, {
            type: NotificationType.BUDGET_EXCEEDED,
            title: "Budget Limit Exceeded",
            message: `You have exceeded your ${b.category.name} budget. Spent: AED ${actualSpent.toFixed(2)} / Budget: AED ${budgetAmount.toFixed(2)} (${(ratio * 100).toFixed(0)}%)`,
            severity: NotificationSeverity.CRITICAL,
            eventKey: `budget-exceeded:${b.id}:${activeMonthStr}`,
            relatedEntityType: "BUDGET",
            relatedEntityId: b.id,
            destinationPath: "/budgets",
          });
          if (alert) createdCount++;
        } 
        // 80% Limit warning
        else if (ratio >= 0.8) {
          const alert = await this.createNotificationIdempotent(userId, {
            type: NotificationType.BUDGET_NEAR_LIMIT,
            title: "Budget Limit Nearing",
            message: `You have spent 80% or more of your ${b.category.name} budget. Spent: AED ${actualSpent.toFixed(2)} / Budget: AED ${budgetAmount.toFixed(2)} (${(ratio * 100).toFixed(0)}%)`,
            severity: NotificationSeverity.WARNING,
            eventKey: `budget-near-limit:${b.id}:${activeMonthStr}`,
            relatedEntityType: "BUDGET",
            relatedEntityId: b.id,
            destinationPath: "/budgets",
          });
          if (alert) createdCount++;
        }
      }
    }

    // B. Check Deficit Alert (outgoings > income)
    let actualIncome = new Decimal(0);
    let actualOutgoings = new Decimal(0);

    transactions.forEach((tx) => {
      // Exclude transfers from health/alert income vs outgoing comparisons
      if (tx.type === TransactionType.TRANSFER) return;

      const isInflow = tx.cashFlowDirection === CashFlowDirection.INFLOW ||
        (tx.cashFlowDirection === null && tx.type === TransactionType.INCOME);
      
      if (isInflow) {
        actualIncome = actualIncome.add(tx.amount);
      } else {
        actualOutgoings = actualOutgoings.add(tx.amount);
      }
    });

    evaluatedCount++;
    if (actualOutgoings.greaterThan(actualIncome)) {
      const alert = await this.createNotificationIdempotent(userId, {
        type: NotificationType.BUDGET_EXCEEDED,
        title: "Negative Cash Flow Deficit",
        message: `Your actual outgoings (AED ${actualOutgoings.toFixed(2)}) exceed your income (AED ${actualIncome.toFixed(2)}) this month. Deficit: AED ${actualOutgoings.sub(actualIncome).toFixed(2)}`,
        severity: NotificationSeverity.CRITICAL,
        eventKey: `negative-cash-flow:${activeMonthStr}`,
        destinationPath: "/dashboard",
      });
      if (alert) createdCount++;
    }

    // C. Monthly expenses exceed planned expenses
    const totalPlannedBudget = budgets.reduce((sum, b) => sum.add(b.amount), new Decimal(0));
    evaluatedCount++;
    if (totalPlannedBudget.greaterThan(0) && actualOutgoings.greaterThan(totalPlannedBudget)) {
      const alert = await this.createNotificationIdempotent(userId, {
        type: NotificationType.BUDGET_EXCEEDED,
        title: "Planned Monthly Budget Exceeded",
        message: `Your total monthly outgoings of AED ${actualOutgoings.toFixed(2)} exceed your total planned monthly budget of AED ${totalPlannedBudget.toFixed(2)}.`,
        severity: NotificationSeverity.CRITICAL,
        eventKey: `budget-exceeded:total:${activeMonthStr}`,
        destinationPath: "/dashboard",
      });
      if (alert) createdCount++;
    }

    // D. Check Food Daily Allowance limit alerts
    const foodCategory = budgets.find((b) => b.category.budgetGroupKey === "FOOD");
    if (foodCategory) {
      const foodSpent = transactions
        .filter((t) => t.categoryId === foodCategory.categoryId && t.type === TransactionType.EXPENSE)
        .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));
      
      const foodRemaining = foodCategory.amount.sub(foodSpent);
      const foodRatio = foodCategory.amount.greaterThan(0) ? foodSpent.div(foodCategory.amount).toNumber() : 0;

      evaluatedCount++;
      if (foodRemaining.lessThanOrEqualTo(0)) {
        const alert = await this.createNotificationIdempotent(userId, {
          type: NotificationType.BUDGET_EXCEEDED,
          title: "Food Budget Overdrawn",
          message: `Your Food budget daily allowance is exhausted. Spent: AED ${foodSpent.toFixed(2)} / Budget: AED ${foodCategory.amount.toFixed(2)}`,
          severity: NotificationSeverity.CRITICAL,
          eventKey: `food-exceeded:${activeMonthStr}`,
          relatedEntityType: "BUDGET",
          relatedEntityId: foodCategory.id,
          destinationPath: "/dashboard",
        });
        if (alert) createdCount++;
      } else if (foodRatio >= 0.8) {
        const alert = await this.createNotificationIdempotent(userId, {
          type: NotificationType.BUDGET_NEAR_LIMIT,
          title: "Food Budget Nearly Exhausted",
          message: `Your Food daily allowance budget is 80% spent. Spent: AED ${foodSpent.toFixed(2)} / Budget: AED ${foodCategory.amount.toFixed(2)}`,
          severity: NotificationSeverity.WARNING,
          eventKey: `food-near-limit:${activeMonthStr}`,
          relatedEntityType: "BUDGET",
          relatedEntityId: foodCategory.id,
          destinationPath: "/dashboard",
        });
        if (alert) createdCount++;
      }
    }

    // E. Safe daily spending falls below threshold
    if (totalPlannedBudget.greaterThan(0)) {
      const daysInMonth = new Date(nowDubai.year, nowDubai.month, 0).getDate();
      const daysRemaining = Math.max(1, daysInMonth - nowDubai.day + 1);
      const remainingCashFlowBudget = totalPlannedBudget.sub(actualOutgoings);
      const safeDailySpending = Decimal.max(0, remainingCashFlowBudget).div(daysRemaining);

      evaluatedCount++;
      if (safeDailySpending.lessThan(safeDailyThreshold)) {
        const alert = await this.createNotificationIdempotent(userId, {
          type: NotificationType.BUDGET_NEAR_LIMIT,
          title: "Safe Daily Spending Alert",
          message: `Your safe daily spending of AED ${safeDailySpending.toFixed(2)} is below the threshold of AED ${safeDailyThreshold.toFixed(2)}. Remaining Month Days: ${daysRemaining}`,
          severity: NotificationSeverity.WARNING,
          eventKey: `daily-spending-low:${todayStr}`,
          destinationPath: "/dashboard",
        });
        if (alert) createdCount++;
      }
    }



    // G. A single expense exceeds configured large-expense threshold
    for (const tx of transactions) {
      if (tx.type === TransactionType.EXPENSE && tx.amount.greaterThan(largeExpenseThreshold)) {
        evaluatedCount++;
        const alert = await this.createNotificationIdempotent(userId, {
          type: NotificationType.BUDGET_NEAR_LIMIT,
          title: "Large Single Expense Recorded",
          message: `A large expense of AED ${tx.amount.toFixed(2)} was recorded at "${tx.description}".`,
          severity: NotificationSeverity.INFO,
          eventKey: `large-expense:${tx.id}`,
          destinationPath: "/transactions",
        });
        if (alert) createdCount++;
      }
    }

    // H. Spending today is materially higher than the recent daily average
    // Fetch past 7 days expenses (excluding today)
    const historyStart = new Date(start);
    historyStart.setDate(historyStart.getDate() - 7);
    const pastExpenses = await db.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        date: { gte: historyStart, lt: start },
      },
    });

    // Check if we have at least 7 days of history data to evaluate
    const uniqueDays = new Set(pastExpenses.map(e => e.date.toISOString().split("T")[0]));
    if (uniqueDays.size >= 5) { // Insufficient history check: require at least 5 distinct days of past data
      const pastTotal = pastExpenses.reduce((sum, e) => sum.add(e.amount), new Decimal(0));
      const dailyAverage = pastTotal.div(7);

      const todayStart = new Date(start);
      todayStart.setDate(todayStart.getDate() + nowDubai.day - 1);
      const todayExpenses = transactions.filter(t => t.type === TransactionType.EXPENSE && t.date >= todayStart);
      const spentToday = todayExpenses.reduce((sum, t) => sum.add(t.amount), new Decimal(0));

      evaluatedCount++;
      if (spentToday.greaterThan(dailyAverage.mul(2)) && spentToday.greaterThan(200)) {
        const alert = await this.createNotificationIdempotent(userId, {
          type: NotificationType.BUDGET_NEAR_LIMIT,
          title: "Unusual Daily Spending Warning",
          message: `Your spending today of AED ${spentToday.toFixed(2)} is materially higher than your 7-day average of AED ${dailyAverage.toFixed(2)}.`,
          severity: NotificationSeverity.WARNING,
          eventKey: `daily-spending-high:${todayStr}`,
          destinationPath: "/dashboard",
        });
        if (alert) createdCount++;
      }
    }

    return {
      evaluated: evaluatedCount,
      created: createdCount,
    };
  }
}
