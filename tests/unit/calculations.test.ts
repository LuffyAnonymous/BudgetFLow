import { describe, test, expect } from "vitest";
import {
  calculateRemainingMoney,
  calculateCategoryBudgetRemaining,
  calculateDailyFoodAllowance,
  calculateOutstandingDebt,
  calculateDebtPaymentAllocation,
  calculateRolloverFeeEstimate,
  calculateSavingsProgress,
  calculateBudgetProgress,
  calculateTotalOutgoings,
} from "../../src/server/calculations/finance-calculations";

describe("Financial Calculations Utility", () => {
  test("Remaining Money: Income - Expenses - Savings - Transfers", () => {
    // 5750 - 2000 - 400 - 700 = 2650
    const remaining = calculateRemainingMoney(5750, 2000, 400, 700);
    expect(remaining.toNumber()).toBe(2650);
  });

  test("Category Budget Remaining: Budget - Spent", () => {
    // 900 - 420 = 480
    const remaining = calculateCategoryBudgetRemaining(900, 420);
    expect(remaining.toNumber()).toBe(480);
  });

  test("Daily Food Allowance: Food Remaining / Remaining Days", () => {
    // 480 remaining over 10 days = 48 daily
    const daily = calculateDailyFoodAllowance(480, 10);
    expect(daily.toNumber()).toBe(48);

    // handles 0 or negative days gracefully
    const dailyZero = calculateDailyFoodAllowance(480, 0);
    expect(dailyZero.toNumber()).toBe(0);

    const dailyNeg = calculateDailyFoodAllowance(480, -5);
    expect(dailyNeg.toNumber()).toBe(0);
  });

  test("Outstanding Debt: Sum of current balances", () => {
    const debts = [
      { currentBalance: 8284.58 },
      { currentBalance: 700.00 }
    ];
    const total = calculateOutstandingDebt(debts);
    expect(total.toNumber()).toBe(8984.58);
  });

  test("Debt Payment Allocation: cannot exceed current balance", () => {
    // Current balance 700, payment 250 -> allocation is 250
    const allocation1 = calculateDebtPaymentAllocation(700, 250);
    expect(allocation1.toNumber()).toBe(250);

    // Current balance 200, payment 250 -> allocation is capped at 200
    const allocation2 = calculateDebtPaymentAllocation(200, 250);
    expect(allocation2.toNumber()).toBe(200);
  });

  test("Rollover Fee Estimate: Balance * (Fee / 100)", () => {
    // 8284.58 * 4.5% = 372.8061
    const fee = calculateRolloverFeeEstimate(8284.58, 4.5);
    expect(fee.toNumber()).toBeCloseTo(372.8061, 4);
  });

  test("Savings Progress: Current / Target * 100", () => {
    const progress = calculateSavingsProgress(2500, 10000);
    expect(progress.toNumber()).toBe(25);

    const progressZero = calculateSavingsProgress(100, 0);
    expect(progressZero.toNumber()).toBe(0);
  });

  test("Budget Progress: Spent / Budget * 100", () => {
    const progress = calculateBudgetProgress(450, 900);
    expect(progress.toNumber()).toBe(50);

    const progressZero = calculateBudgetProgress(100, 0);
    expect(progressZero.toNumber()).toBe(0);
  });

  test("Total Outgoings: Expenses + Savings + Remittances + Debt Payments", () => {
    // 2000 + 400 + 700 + 250 = 3350
    const outgoings = calculateTotalOutgoings(2000, 400, 700, 250);
    expect(outgoings.toNumber()).toBe(3350);
  });
});
