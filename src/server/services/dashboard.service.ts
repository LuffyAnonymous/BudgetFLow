import { db } from "@/lib/db";
import { getDubaiCurrentDate, getDubaiMonthRange, getRemainingDaysInMonthDubai } from "@/lib/dates";
import { Decimal } from "decimal.js";
import { CategoryType, TransactionType, CashFlowDirection, DebtStatus, SavingGoalStatus } from "@prisma/client";
import {
  calculateRemainingMoney,
  calculateCategoryBudgetRemaining,
  calculateDailyFoodAllowance,
  calculateOutstandingDebt,
} from "../calculations/finance-calculations";
import { DebtService } from "./debt.service";
import { accountService } from "./account.service";

export class DashboardService {
  private debtService = new DebtService();

  /**
   * Compiles all dashboard statistics, returning Decimal values serialized as strings.
   */
  async getDashboardData(userId: string, monthStr?: string) {
    const nowDubai = getDubaiCurrentDate();
    const currentMonthDubai = `${nowDubai.year}-${String(nowDubai.month).padStart(2, "0")}`;
    const activeMonth = monthStr || currentMonthDubai;

    // 1. Fetch user settings for monthly salary plan
    const settings = await db.setting.findUnique({
      where: { userId },
    });
    const salaryPlan = settings ? settings.monthlySalary : new Decimal(0);

    // 2. Fetch outstanding debts (Sum of currentBalance for ACTIVE or PAUSED debts)
    const debts = await db.debt.findMany({
      where: { userId, status: { in: [DebtStatus.ACTIVE, DebtStatus.PAUSED] } },
    });
    const outstandingDebt = calculateOutstandingDebt(debts);

    // 3. Fetch active/paused/completed savings goals (exclude ARCHIVED)
    const savingGoals = await db.savingGoal.findMany({
      where: { userId, status: { in: [SavingGoalStatus.ACTIVE, SavingGoalStatus.COMPLETED, SavingGoalStatus.PAUSED] } },
    });
    const totalSavings = savingGoals.reduce((sum, g) => sum.plus(g.currentAmount), new Decimal(0));

    // 4. Fetch budgets for the active month
    const budgets = await db.budget.findMany({
      where: { userId, month: activeMonth },
      include: { category: true },
    });

    const plannedExpenses = budgets
      .filter((b) => b.category.type === CategoryType.FIXED_EXPENSE || b.category.type === CategoryType.VARIABLE_EXPENSE)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedSavings = budgets
      .filter((b) => b.category.type === CategoryType.SAVINGS)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedRemittance = budgets
      .filter((b) => b.category.type === CategoryType.REMITTANCE)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const plannedDebtPayments = budgets
      .filter((b) => b.category.type === CategoryType.DEBT)
      .reduce((sum, b) => sum.plus(b.amount), new Decimal(0));

    const totalPlannedAllocations = plannedExpenses
      .plus(plannedSavings)
      .plus(plannedRemittance)
      .plus(plannedDebtPayments);
      
    const unallocatedPlan = Decimal.max(0, salaryPlan.minus(totalPlannedAllocations));

    // 5. Fetch transactions within Dubai month range
    const { start, nextMonthStart } = getDubaiMonthRange(activeMonth);
    const transactions = await db.transaction.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lt: nextMonthStart,
        },
      },
      include: {
        category: true,
      },
      orderBy: [
        { date: "desc" },
        { createdAt: "desc" },
      ],
    });

    // Fetch remittances for the active month
    const remittances = await db.remittance.findMany({
      where: {
        userId,
        transferDate: {
          gte: start,
          lt: nextMonthStart,
        },
      },
      orderBy: [
        { transferDate: "desc" },
        { createdAt: "desc" },
      ],
    });

    // Remittance operations aggregations
    let completedSentThisMonth = new Decimal(0);
    let completedFeesThisMonth = new Decimal(0);
    let phpReceivedThisMonth = new Decimal(0);
    let reversedAmountThisMonth = new Decimal(0);

    remittances.forEach((r) => {
      if (r.status === "COMPLETED") {
        completedSentThisMonth = completedSentThisMonth.plus(r.amountSentAed);
        if (r.transferFeeAed) {
          completedFeesThisMonth = completedFeesThisMonth.plus(r.transferFeeAed);
        }
        if (r.amountReceivedPhp) {
          phpReceivedThisMonth = phpReceivedThisMonth.plus(r.amountReceivedPhp);
        }
      } else if (r.status === "REVERSED") {
        reversedAmountThisMonth = reversedAmountThisMonth.plus(r.amountSentAed);
      }
    });

    const latestRemittance = remittances.length > 0 ? {
      id: remittances[0].id,
      recipient: remittances[0].recipient || "Not available",
      amountSentAed: remittances[0].amountSentAed.toFixed(2),
      exchangeRate: remittances[0].exchangeRate ? remittances[0].exchangeRate.toFixed(6) : "Not available",
      amountReceivedPhp: remittances[0].amountReceivedPhp ? remittances[0].amountReceivedPhp.toFixed(2) : "Not available",
      transferProvider: remittances[0].transferProvider,
      transferDate: remittances[0].transferDate.toISOString(),
      status: remittances[0].status,
    } : null;

    // 6. Calculate actual statistics using linked/validated transactions
    const actualIncome = transactions
      .filter((t) => t.type === TransactionType.INCOME)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    const actualExpenses = transactions
      .filter((t) => t.type === TransactionType.EXPENSE)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    // Savings Outflows (deposits) and Inflows (withdrawals)
    const actualSavingsDeposits = transactions
      .filter((t) => t.type === TransactionType.SAVINGS && t.cashFlowDirection === CashFlowDirection.OUTFLOW)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    const actualSavingsWithdrawals = transactions
      .filter((t) => t.type === TransactionType.SAVINGS && t.cashFlowDirection === CashFlowDirection.INFLOW)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    const actualSavings = actualSavingsDeposits.minus(actualSavingsWithdrawals);

    // Transfers must NEVER affect income/expense/remittance totals
    const actualRemittances = transactions
      .filter((t) => t.type === TransactionType.REMITTANCE)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    // Only count linked/explicit DEBT_PAYMENT transactions
    const actualDebtPayments = transactions
      .filter((t) => t.type === TransactionType.DEBT_PAYMENT)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0));

    // Remaining cash flow: Income - Expenses - Net Savings Outflows - Remittances - Debt Payments
    const actualRemaining = calculateRemainingMoney(
      actualIncome,
      actualExpenses,
      actualSavings,
      actualRemittances.plus(actualDebtPayments)
    );

    // 7. Calculate Food group spending
    const foodCategory = budgets.find((b) => b.category.name === "Food" && b.category.budgetGroupKey === "FOOD");
    const foodBudgetPlanned = foodCategory ? foodCategory.amount : new Decimal(900.00);

    const foodTransactions = transactions.filter(
      (t) => t.category.budgetGroupKey === "FOOD" && t.type === TransactionType.EXPENSE
    );
    const combinedFoodSpent = foodTransactions.reduce(
      (sum, t) => sum.plus(t.amount),
      new Decimal(0)
    );

    const foodRemaining = calculateCategoryBudgetRemaining(foodBudgetPlanned, combinedFoodSpent);
    const foodRemainingCapped = Decimal.max(0, foodRemaining);

    // Calculate remaining days
    let remainingDays = 0;
    if (activeMonth === currentMonthDubai) {
      remainingDays = getRemainingDaysInMonthDubai();
    } else {
      const [y, m] = activeMonth.split("-").map(Number);
      const totalDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
      remainingDays = activeMonth > currentMonthDubai ? totalDays : 0;
    }

    const dailyFoodAllowance = calculateDailyFoodAllowance(foodRemainingCapped, remainingDays);

    // Recent transactions (last 5)
    const recentTransactions = transactions.slice(0, 5).map((tx) => ({
      id: tx.id,
      date: tx.date.toISOString(),
      categoryName: tx.category.name,
      description: tx.description,
      amount: tx.amount.toFixed(2),
      type: tx.type,
    }));

    // Next upcoming payment
    const nearestPayment = await this.debtService.getNearestUpcomingPayment(userId);

    // Fetch account details for Dashboard
    const accounts = await accountService.getAccounts(userId);
    const serializedAccounts = accounts.map((acc) => ({
      id: acc.id,
      type: acc.type,
      name: acc.name,
      currentBalance: acc.currentBalance.toFixed(2),
      latestImportedBalance: acc.latestImportedBalance ? acc.latestImportedBalance.toFixed(2) : null,
      lastSMSImported: acc.lastSMSImportedAt ? acc.lastSMSImportedAt.toISOString() : null,
      lastSuccessfulSync: acc.lastSuccessfulSyncAt ? acc.lastSuccessfulSyncAt.toISOString() : null,
    }));

    const totalAvailable = accounts.reduce((sum, acc) => sum.plus(acc.currentBalance), new Decimal(0));

    return {
      month: activeMonth,
      actual: {
        income: actualIncome.toFixed(2),
        expenses: actualExpenses.toFixed(2),
        savings: actualSavings.toFixed(2),
        savingsDeposits: actualSavingsDeposits.toFixed(2),
        savingsWithdrawals: actualSavingsWithdrawals.toFixed(2),
        remittances: actualRemittances.toFixed(2),
        debtPayments: actualDebtPayments.toFixed(2),
        remaining: actualRemaining.toFixed(2),
      },
      planned: {
        salary: salaryPlan.toFixed(2),
        expenses: plannedExpenses.toFixed(2),
        savings: plannedSavings.toFixed(2),
        remittances: plannedRemittance.toFixed(2),
        debtPayments: plannedDebtPayments.toFixed(2),
        unallocated: unallocatedPlan.toFixed(2),
      },
      food: {
        planned: foodBudgetPlanned.toFixed(2),
        spent: combinedFoodSpent.toFixed(2),
        remaining: foodRemaining.toFixed(2),
        dailyAllowance: dailyFoodAllowance.toFixed(2),
        remainingDays,
      },
      remittanceOperations: {
        amountSent: completedSentThisMonth.toFixed(2),
        fees: completedFeesThisMonth.toFixed(2),
        phpReceived: phpReceivedThisMonth.toFixed(2),
        reversedAmount: reversedAmountThisMonth.toFixed(2),
        latestRemittance,
      },
      outstandingDebt: outstandingDebt.toFixed(2),
      totalSavings: totalSavings.toFixed(2),
      recentTransactions,
      nearestPayment,
      accounts: serializedAccounts,
      totalAvailableMoney: totalAvailable.toFixed(2),
    };
  }
}
