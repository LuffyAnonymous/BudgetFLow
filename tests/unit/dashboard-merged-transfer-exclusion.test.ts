import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { DashboardService } from "@/server/services/dashboard.service";
import { getActiveFinancialCycle } from "@/lib/salary-month";

describe("DashboardService.getDashboardData — excludes MERGED transfer legs from actual cash flow", () => {
  const dashboardService = new DashboardService();
  let userId: string;
  let enbdId: string;
  let mashreqId: string;
  let incomeCategoryId: string;
  let expenseCategoryId: string;
  let activeMonth: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.setting.deleteMany({});
    await db.user.deleteMany({ where: { email: "dashboard_merged_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "dashboard_merged_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Dashboard Merge Tester" },
    });
    userId = user.id;

    await db.setting.create({ data: { userId, monthlySalary: 5000, payday: 26 } });

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
    const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    enbdId = enbd.id;
    mashreqId = mashreq.id;

    const incomeCat = await db.category.create({ data: { userId, name: "Uncategorized Income", type: "INCOME" } });
    const expenseCat = await db.category.create({ data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" } });
    incomeCategoryId = incomeCat.id;
    expenseCategoryId = expenseCat.id;

    activeMonth = await getActiveFinancialCycle(userId);
  });

  it("does not double-count a reconciled transfer's MERGED inflow leg as real income", async () => {
    const now = new Date();

    // Real external income for the month — the only thing that should
    // count toward actualIncome.
    await db.transaction.create({
      data: {
        userId, accountId: enbdId, categoryId: incomeCategoryId,
        date: now, occurredAt: now, budgetMonth: activeMonth,
        amount: 5000, description: "Salary", paymentMethod: "Email Import",
        type: "INCOME", cashFlowDirection: "INFLOW", origin: "EMAIL_IMPORT",
      },
    });

    // The canonical TRANSFER row (what a reconciled transfer's outflow leg
    // becomes) — must never count as an expense.
    await db.transaction.create({
      data: {
        userId, accountId: enbdId, toAccountId: mashreqId, categoryId: expenseCategoryId,
        date: now, occurredAt: now, budgetMonth: activeMonth,
        amount: 500, description: "MASHREQBANK PSC", paymentMethod: "Email Import",
        type: "TRANSFER", cashFlowDirection: "OUTFLOW", origin: "EMAIL_IMPORT",
        transferMatchStatus: "MATCHED",
      },
    });

    // The MERGED sibling leg — kept for history, but must be excluded from
    // actual cash flow (this is the exact row the bug counted twice).
    await db.transaction.create({
      data: {
        userId, accountId: mashreqId, categoryId: incomeCategoryId,
        date: now, occurredAt: now, budgetMonth: activeMonth,
        amount: 500, description: "Instant Transfer", paymentMethod: "Email Import",
        type: "INCOME", cashFlowDirection: "INFLOW", origin: "EMAIL_IMPORT",
        transferMatchStatus: "MERGED",
      },
    });

    const data = await dashboardService.getDashboardData(userId, activeMonth);

    expect(data.actual.income).toBe("5000.00");
    expect(data.actual.remaining).toBe("5000.00");
  });
});
