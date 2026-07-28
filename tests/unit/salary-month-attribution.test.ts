import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { determineBudgetMonth } from "@/lib/salary-month";
import { importService } from "@/imports/engine/import.service";
import { DashboardService } from "@/server/services/dashboard.service";
import { ReportService } from "@/server/services/report.service";
import { accountService } from "@/server/services/account.service";
import { TransactionService } from "@/server/services/transaction.service";
import { AccountType } from "@prisma/client";

describe("Salary Month Attribution & Boundary Reporting", () => {
  let userId: string;
  const dashboardService = new DashboardService();
  const reportService = new ReportService();
  const transactionService = new TransactionService();

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "salary_month_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Salary Month Tester",
      },
    });
    userId = user.id;

    await accountService.ensureDefaultAccounts(userId);

    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD"],
      },
    });

    await db.category.create({
      data: {
        userId,
        name: "Salary",
        type: "INCOME",
      },
    });
  });

  describe("determineBudgetMonth Utility", () => {
    it("assigns salary received on or after 20th of month to the following month", () => {
      const dateEndJul = new Date("2026-07-28T10:00:00Z");
      expect(determineBudgetMonth(dateEndJul, true)).toBe("2026-08");

      const dateMidJul = new Date("2026-07-15T10:00:00Z");
      expect(determineBudgetMonth(dateMidJul, true)).toBe("2026-07");
    });

    it("assigns non-salary transactions to the current month regardless of date", () => {
      const dateEndJul = new Date("2026-07-28T10:00:00Z");
      expect(determineBudgetMonth(dateEndJul, false)).toBe("2026-07");
    });
  });

  describe("End-of-Month Salary SMS Import & Dashboard Reporting", () => {
    it("imports salary on 28 July 2026 with budgetMonth = 2026-08 without double-counting account balance", async () => {
      const sms = "AED 5,750.00 has been credited to your account no. 014557001234501 DTB SALARY. The available balance is AED 5,752.56.";
      const res = await importService.processSms(userId, {
        sender: "ENBD",
        message: sms,
        receivedAt: new Date("2026-07-28T10:33:00.000Z"),
      });

      expect(res.outcome).toBe("auto_posted");

      // Verify transaction stores budgetMonth = "2026-08" while date = 28 July 2026
      const tx = await db.transaction.findFirst({ where: { userId, amount: 5750 } });
      expect(tx).not.toBeNull();
      expect(tx?.budgetMonth).toBe("2026-08");
      expect(tx?.date.toISOString()).toContain("2026-07-28");

      // Verify ENBD account balance is 5,752.56
      const accounts = await accountService.getAccounts(userId);
      const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
      expect(enbd.currentBalance.toFixed(2)).toBe("5752.56");

      // 1. July Dashboard (2026-07) must NOT include AED 5,750 as income
      const julyDashboard = await dashboardService.getDashboardData(userId, "2026-07");
      expect(julyDashboard.actual.income).toBe("0.00");

      // 2. August Dashboard (2026-08) MUST include AED 5,750 as income
      const augDashboard = await dashboardService.getDashboardData(userId, "2026-08");
      expect(augDashboard.actual.income).toBe("5750.00");

      // 3. Monthly Reports: July report = 0 income, August report = 5,750 income
      const julyReport = await reportService.getMonthlyReport(userId, "2026-07");
      expect(julyReport.income).toBe("0.00");

      const augReport = await reportService.getMonthlyReport(userId, "2026-08");
      expect(augReport.income).toBe("5750.00");

      // Account balance remains unchanged
      const enbdAfter = (await accountService.getAccounts(userId)).find(a => a.type === AccountType.EMIRATES_NBD)!;
      expect(enbdAfter.currentBalance.toFixed(2)).toBe("5752.56");
    });

    it("allows manually changing budgetMonth on a transaction and updates reports dynamically", async () => {
      const category = await db.category.findFirst({ where: { userId, name: "Salary" } });

      const tx = await transactionService.createTransaction(userId, {
        date: new Date("2026-07-28T00:00:00Z"),
        budgetMonth: "2026-08",
        categoryId: category!.id,
        description: "July 28 Salary",
        amount: new (await import("decimal.js")).Decimal(5750),
        paymentMethod: "Bank Transfer",
        type: "INCOME",
      });

      let augDash = await dashboardService.getDashboardData(userId, "2026-08");
      expect(augDash.actual.income).toBe("5750.00");

      // Update budgetMonth to 2026-09
      await transactionService.updateTransaction(tx.id, userId, {
        budgetMonth: "2026-09",
      });

      augDash = await dashboardService.getDashboardData(userId, "2026-08");
      expect(augDash.actual.income).toBe("0.00");

      const sepDash = await dashboardService.getDashboardData(userId, "2026-09");
      expect(sepDash.actual.income).toBe("5750.00");
    });
  });
});
