import { Decimal } from "decimal.js";

/**
 * Calculates remaining monthly money: Income - Expenses - Savings - Transfers (Remittances/Transfers)
 */
export function calculateRemainingMoney(
  income: Decimal | string | number,
  expenses: Decimal | string | number,
  savings: Decimal | string | number,
  transfers: Decimal | string | number
): Decimal {
  return new Decimal(income)
    .minus(new Decimal(expenses))
    .minus(new Decimal(savings))
    .minus(new Decimal(transfers));
}

/**
 * Calculates remaining budget for a category: Budget - Spent
 */
export function calculateCategoryBudgetRemaining(
  budgetAmount: Decimal | string | number,
  spentAmount: Decimal | string | number
): Decimal {
  return new Decimal(budgetAmount).minus(new Decimal(spentAmount));
}

/**
 * Calculates daily food allowance: Food Remaining / Remaining Days in Month
 */
export function calculateDailyFoodAllowance(
  foodRemaining: Decimal | string | number,
  remainingDays: number
): Decimal {
  if (remainingDays <= 0) {
    return new Decimal(0);
  }
  return new Decimal(foodRemaining).div(remainingDays);
}

/**
 * Calculates total outstanding debt from all debt balances
 */
export function calculateOutstandingDebt(
  debts: { currentBalance: Decimal | string | number }[]
): Decimal {
  return debts.reduce(
    (sum, debt) => sum.plus(new Decimal(debt.currentBalance)),
    new Decimal(0)
  );
}

/**
 * Calculates the amount to subtract from the debt current balance given a payment amount.
 * The payment allocated cannot exceed the outstanding current balance of the debt.
 */
export function calculateDebtPaymentAllocation(
  currentBalance: Decimal | string | number,
  paymentAmount: Decimal | string | number
): Decimal {
  const balance = new Decimal(currentBalance);
  const payment = new Decimal(paymentAmount);
  return Decimal.min(balance, payment);
}

/**
 * Calculates the rollover fee estimate for a debt based on its current balance
 * and its monthly rollover fee percentage (e.g. 4.5% represented as 4.50).
 */
export function calculateRolloverFeeEstimate(
  currentBalance: Decimal | string | number,
  rolloverFeePercent: Decimal | string | number
): Decimal {
  const balance = new Decimal(currentBalance);
  const percent = new Decimal(rolloverFeePercent);
  return balance.mul(percent.div(100));
}

/**
 * Calculates savings progress percentage: (Current Amount / Target Amount) * 100
 */
export function calculateSavingsProgress(
  currentAmount: Decimal | string | number,
  targetAmount: Decimal | string | number
): Decimal {
  const target = new Decimal(targetAmount);
  if (target.isZero()) {
    return new Decimal(0);
  }
  return new Decimal(currentAmount).div(target).mul(100);
}

/**
 * Calculates budget progress percentage: (Amount Spent / Budget) * 100
 */
export function calculateBudgetProgress(
  spent: Decimal | string | number,
  budget: Decimal | string | number
): Decimal {
  const b = new Decimal(budget);
  if (b.isZero()) {
    return new Decimal(0);
  }
  return new Decimal(spent).div(b).mul(100);
}

/**
 * Compares Monthly Income vs Outgoing Money (Sum of Expenses, Savings, Remittances, and Debt Payments)
 */
export function calculateTotalOutgoings(
  expenses: Decimal | string | number,
  savings: Decimal | string | number,
  remittances: Decimal | string | number,
  debtPayments: Decimal | string | number
): Decimal {
  return new Decimal(expenses)
    .plus(new Decimal(savings))
    .plus(new Decimal(remittances))
    .plus(new Decimal(debtPayments));
}
