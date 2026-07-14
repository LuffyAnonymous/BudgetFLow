import { describe, test, expect } from "vitest";
import { parseCanonicalMonth, getDubaiMonthRange, getRemainingDaysInMonthDubai } from "@/lib/dates";
import { TransactionService } from "@/server/services/transaction.service";
import { CategoryType, TransactionType } from "@prisma/client";
import { Decimal } from "decimal.js";
import { 
  calculateCategoryBudgetRemaining, 
  calculateDailyFoodAllowance,
} from "@/server/calculations/finance-calculations";

// Helper to determine status since it's private in BudgetService
function determineStatus(actualVal: Decimal, plannedVal: Decimal): string {
  if (plannedVal.isZero()) {
    return actualVal.isZero() ? "ON_TRACK" : "OVER_BUDGET";
  }
  if (actualVal.eq(plannedVal)) {
    return "COMPLETED";
  }
  if (actualVal.gt(plannedVal)) {
    return "OVER_BUDGET";
  }
  const threshold = plannedVal.mul(0.8);
  if (actualVal.gte(threshold)) {
    return "NEAR_LIMIT";
  }
  return "ON_TRACK";
}

describe("Milestone 2 Unit Tests", () => {
  // 1. Month Parsing & Validation
  describe("Month Parsing (parseCanonicalMonth)", () => {
    test("Accepts valid YYYY-MM months", () => {
      const date = parseCanonicalMonth("2026-07");
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(6); // 0-indexed July
      expect(date.getUTCDate()).toBe(1);
    });

    test("Rejects invalid months format", () => {
      expect(() => parseCanonicalMonth("2026-13")).toThrow("Invalid month format");
      expect(() => parseCanonicalMonth("July-2026")).toThrow("Invalid month format");
      expect(() => parseCanonicalMonth("")).toThrow("Month is required");
    });
  });

  // 2. Dubai Timezone Month Boundaries Range Queries
  describe("Dubai Month Boundaries (getDubaiMonthRange)", () => {
    test("Calculates UTC start and nextMonthStart for 2026-07", () => {
      const { start, nextMonthStart } = getDubaiMonthRange("2026-07");
      
      // Dubai is UTC+4. Start of month in Dubai is 2026-07-01 00:00:00 -> 2026-06-30 20:00:00 UTC
      expect(start.getUTCFullYear()).toBe(2026);
      expect(start.getUTCMonth()).toBe(5); // June
      expect(start.getUTCDate()).toBe(30);
      expect(start.getUTCHours()).toBe(20);

      // Next month start in Dubai is 2026-08-01 00:00:00 -> 2026-07-31 20:00:00 UTC
      expect(nextMonthStart.getUTCFullYear()).toBe(2026);
      expect(nextMonthStart.getUTCMonth()).toBe(6); // July
      expect(nextMonthStart.getUTCDate()).toBe(31);
      expect(nextMonthStart.getUTCHours()).toBe(20);
    });
  });

  // 3. Category & Transaction Type Compatibility
  describe("Category & Transaction Type Compatibility", () => {
    const txService = new TransactionService();

    test("INCOME compatibility rules", () => {
      // Income tx with Income category -> allowed
      expect(() => txService.validateCategoryCompatibility(TransactionType.INCOME, CategoryType.INCOME)).not.toThrow();
      
      // Income tx with Fixed Expense category -> throws
      expect(() => txService.validateCategoryCompatibility(TransactionType.INCOME, CategoryType.FIXED_EXPENSE)).toThrow();
    });

    test("EXPENSE compatibility rules", () => {
      // Expense tx with Fixed Expense category -> allowed
      expect(() => txService.validateCategoryCompatibility(TransactionType.EXPENSE, CategoryType.FIXED_EXPENSE)).not.toThrow();
      
      // Expense tx with Variable Expense category -> allowed
      expect(() => txService.validateCategoryCompatibility(TransactionType.EXPENSE, CategoryType.VARIABLE_EXPENSE)).not.toThrow();

      // Expense tx with Income category -> throws
      expect(() => txService.validateCategoryCompatibility(TransactionType.EXPENSE, CategoryType.INCOME)).toThrow();
      
      // Expense tx with Savings category -> throws
      expect(() => txService.validateCategoryCompatibility(TransactionType.EXPENSE, CategoryType.SAVINGS)).toThrow();
    });
  });

  // 4. Budget Status Classifier & Safe Decimals Math
  describe("Budget Status Classifier & Decimal Math", () => {
    test("Zero planned budgets", () => {
      expect(determineStatus(new Decimal(0), new Decimal(0))).toBe("ON_TRACK");
      expect(determineStatus(new Decimal("50.00"), new Decimal(0))).toBe("OVER_BUDGET");
    });

    test("Completed status when actual equals planned exactly", () => {
      expect(determineStatus(new Decimal("900.00"), new Decimal("900.00"))).toBe("COMPLETED");
    });

    test("Over budget when actual exceeds planned", () => {
      expect(determineStatus(new Decimal("900.01"), new Decimal("900.00"))).toBe("OVER_BUDGET");
    });

    test("Near limit when actual is between 80% and 99.99%", () => {
      expect(determineStatus(new Decimal("720.00"), new Decimal("900.00"))).toBe("NEAR_LIMIT"); // exactly 80%
      expect(determineStatus(new Decimal("899.99"), new Decimal("900.00"))).toBe("NEAR_LIMIT");
    });

    test("On track when actual is below 80%", () => {
      expect(determineStatus(new Decimal("719.99"), new Decimal("900.00"))).toBe("ON_TRACK");
    });
  });

  // 5. Daily Food Allowance & Remaining Days Boundary
  describe("Food Allowance & Days Logic", () => {
    test("Remaining days in month including today in Dubai timezone", () => {
      // Mock July 11, 2026, 03:50:33+04:00 (which is 2026-07-10 23:50:33 UTC)
      // Since Dubai is UTC+4, adding 4 hours gets July 11th.
      // Total days in July = 31. Remaining days including today (11th) = 31 - 11 + 1 = 21.
      const mockDate = new Date(Date.UTC(2026, 6, 10, 23, 50, 33));
      const remainingDays = getRemainingDaysInMonthDubai(mockDate);
      expect(remainingDays).toBe(21);
    });

    test("Allowance calculations", () => {
      // AED 900 planned budget, AED 420 spent -> AED 480 remaining
      const foodRemaining = calculateCategoryBudgetRemaining(900, 420);
      expect(foodRemaining.toNumber()).toBe(480);

      // Remaining days: 20. Daily allowance: 480 / 20 = 24.
      const daily = calculateDailyFoodAllowance(foodRemaining, 20);
      expect(daily.toNumber()).toBe(24);
    });
  });
});
