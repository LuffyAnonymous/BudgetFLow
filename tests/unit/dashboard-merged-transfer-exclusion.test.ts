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
  });
});

describe("DashboardService.getDashboardData — 'Remaining Cash Flow' mirrors the Accounts page total", () => {
  const dashboardService = new DashboardService();
  let userId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.setting.deleteMany({});
    await db.user.deleteMany({ where: { email: "dashboard_remaining_sync_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "dashboard_remaining_sync_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Remaining Sync Tester" },
    });
    userId = user.id;
    await db.setting.create({ data: { userId, monthlySalary: 5000, payday: 26 } });
  });

  it("equals the sum of real account balances, not a month-scoped income-minus-expenses figure", async () => {
    // Deliberately does NOT set up any transactions for the active month —
    // a prior month's activity already reduced these balances, exactly the
    // real scenario this fix addresses. A month-scoped income-minus-
    // expenses calculation would show 0 here; the real answer is whatever
    // money actually exists right now.
    await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", currentBalance: 4.81 } });
    await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ", currentBalance: 3.26 } });
    await db.account.create({ data: { userId, name: "Cash", type: "CASH", currentBalance: 510 } });

    const data = await dashboardService.getDashboardData(userId);
    expect(data.actual.remaining).toBe("518.07");
  });

  it("excludes BNPL and credit-card balances, matching the Accounts page's own exclusion", async () => {
    await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", currentBalance: 1000 } });
    await db.account.create({ data: { userId, name: "Tabby", type: "TABBY", currentBalance: -300 } });
    await db.account.create({ data: { userId, name: "Emirates NBD Credit Card", type: "EMIRATES_NBD", isCreditCard: true, currentBalance: -150 } });

    const data = await dashboardService.getDashboardData(userId);
    expect(data.actual.remaining).toBe("1000.00");
  });
});
