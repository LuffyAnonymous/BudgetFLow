import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ReportService } from "../../../src/server/services/report.service";

const reportService = new ReportService();

function monthsAgo(n: number): string {
  const now = new Date();
  const val = now.getUTCFullYear() * 12 + now.getUTCMonth() - n;
  const year = Math.floor(val / 12);
  const month = (val % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dateInMonth(monthStr: string): Date {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15));
}

describe("ReportService.getSpendingRecommendation", () => {
  let userId: string;
  let salaryCategoryId: string;
  let fixedCategoryId: string;
  let variableCategoryId: string;
  let debtCategoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.category.deleteMany({});
    await db.setting.deleteMany({});
    await db.user.deleteMany({ where: { email: "insights_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "insights_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Insights Tester" },
    });
    userId = user.id;

    await db.setting.create({
      data: { userId, monthlySalary: 5000, payday: 26 },
    });

    const salaryCat = await db.category.create({ data: { userId, name: "Salary", type: "INCOME" } });
    const fixedCat = await db.category.create({ data: { userId, name: "Rent Cash", type: "FIXED_EXPENSE" } });
    const variableCat = await db.category.create({ data: { userId, name: "Dining", type: "VARIABLE_EXPENSE" } });
    const debtCat = await db.category.create({ data: { userId, name: "Debt Payment", type: "DEBT" } });
    salaryCategoryId = salaryCat.id;
    fixedCategoryId = fixedCat.id;
    variableCategoryId = variableCat.id;
    debtCategoryId = debtCat.id;
  });

  async function createTx(opts: {
    month: string;
    categoryId: string;
    amount: number;
    type: "INCOME" | "EXPENSE" | "SAVINGS" | "DEBT_PAYMENT" | "REMITTANCE";
    direction?: "INFLOW" | "OUTFLOW";
    description?: string;
  }) {
    await db.transaction.create({
      data: {
        userId,
        categoryId: opts.categoryId,
        date: dateInMonth(opts.month),
        budgetMonth: opts.month,
        amount: opts.amount,
        type: opts.type,
        cashFlowDirection: opts.direction ?? (opts.type === "INCOME" ? "INFLOW" : "OUTFLOW"),
        description: opts.description ?? opts.type,
        paymentMethod: "Test",
      },
    });
  }

  it("returns dataSufficient=false with fewer than 2 months of transaction history", async () => {
    await createTx({ month: monthsAgo(0), categoryId: salaryCategoryId, amount: 5000, type: "INCOME" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.dataSufficient).toBe(false);
    expect(result.recommendation).toBeNull();
    expect(result.monthsOfHistory).toBe(1);
  });

  it("calculates salary from salary-tagged income when >=2 months are present (SALARY_TAGGED tier)", async () => {
    await createTx({ month: monthsAgo(0), categoryId: salaryCategoryId, amount: 5000, type: "INCOME", description: "Salary" });
    await createTx({ month: monthsAgo(1), categoryId: salaryCategoryId, amount: 5200, type: "INCOME", description: "Salary" });
    await createTx({ month: monthsAgo(2), categoryId: salaryCategoryId, amount: 4800, type: "INCOME", description: "Salary" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.dataSufficient).toBe(true);
    expect(result.salary.source).toBe("SALARY_TAGGED");
    expect(result.salary.calculated).toBe("5000.00"); // median of 4800, 5000, 5200
  });

  it("falls back to ALL_INCOME tier when income exists but isn't salary-tagged", async () => {
    const freelanceCat = await db.category.create({ data: { userId, name: "Client Payment", type: "INCOME" } });
    await createTx({ month: monthsAgo(0), categoryId: freelanceCat.id, amount: 3000, type: "INCOME", description: "Client Payment" });
    await createTx({ month: monthsAgo(1), categoryId: freelanceCat.id, amount: 3000, type: "INCOME", description: "Client Payment" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.salary.source).toBe("ALL_INCOME");
    expect(result.salary.calculated).toBe("3000.00");
  });

  it("falls back to the declared Setting.monthlySalary when there's no income history at all", async () => {
    await createTx({ month: monthsAgo(0), categoryId: fixedCategoryId, amount: 100, type: "EXPENSE" });
    await createTx({ month: monthsAgo(1), categoryId: fixedCategoryId, amount: 100, type: "EXPENSE" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.salary.source).toBe("DECLARED_FALLBACK");
    expect(result.salary.calculated).toBe("5000.00"); // matches Setting.monthlySalary
  });

  it("flags an over-committed month with no safe-to-spend figure when fixed commitments exceed salary", async () => {
    await createTx({ month: monthsAgo(0), categoryId: salaryCategoryId, amount: 2000, type: "INCOME", description: "Salary" });
    await createTx({ month: monthsAgo(1), categoryId: salaryCategoryId, amount: 2000, type: "INCOME", description: "Salary" });
    // Fixed expenses alone exceed the 2,000 salary
    await createTx({ month: monthsAgo(0), categoryId: fixedCategoryId, amount: 2500, type: "EXPENSE" });
    await createTx({ month: monthsAgo(1), categoryId: fixedCategoryId, amount: 2500, type: "EXPENSE" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.recommendation?.isOverCommitted).toBe(true);
    expect(result.recommendation?.recommendedSafeToSpend).toBe("0.00");
  });

  it("splits the safe-to-spend recommendation across variable categories proportionally to historical spend", async () => {
    await createTx({ month: monthsAgo(0), categoryId: salaryCategoryId, amount: 6000, type: "INCOME", description: "Salary" });
    await createTx({ month: monthsAgo(1), categoryId: salaryCategoryId, amount: 6000, type: "INCOME", description: "Salary" });

    const shoppingCat = await db.category.create({ data: { userId, name: "Shopping", type: "VARIABLE_EXPENSE" } });
    // Dining: 300 total, Shopping: 100 total -> 75% / 25% split
    await createTx({ month: monthsAgo(0), categoryId: variableCategoryId, amount: 200, type: "EXPENSE" });
    await createTx({ month: monthsAgo(1), categoryId: variableCategoryId, amount: 100, type: "EXPENSE" });
    await createTx({ month: monthsAgo(0), categoryId: shoppingCat.id, amount: 100, type: "EXPENSE" });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.recommendation?.isOverCommitted).toBe(false);
    const dining = result.categoryBreakdown.find((c) => c.categoryName === "Dining");
    const shopping = result.categoryBreakdown.find((c) => c.categoryName === "Shopping");
    expect(dining?.historicalSharePct).toBe("75.0");
    expect(shopping?.historicalSharePct).toBe("25.0");
  });

  it("includes active debt payments as a fixed commitment", async () => {
    await createTx({ month: monthsAgo(0), categoryId: salaryCategoryId, amount: 5000, type: "INCOME", description: "Salary" });
    await createTx({ month: monthsAgo(1), categoryId: salaryCategoryId, amount: 5000, type: "INCOME", description: "Salary" });
    await db.debt.create({
      data: {
        userId,
        name: "Tabby",
        originalBalance: 1000,
        currentBalance: 800,
        monthlyPayment: 250,
        dueDay: 25,
        rolloverFeeRate: 0,
        status: "ACTIVE",
        categoryId: debtCategoryId,
      },
    });

    const result = await reportService.getSpendingRecommendation(userId);
    expect(result.fixedCommitments.debtPayments).toBe("250.00");
  });
});
