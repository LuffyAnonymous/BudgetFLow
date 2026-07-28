import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
import { DashboardService } from "@/server/services/dashboard.service";
import { accountService } from "@/server/services/account.service";
import { DebtService } from "@/server/services/debt.service";
import { TransactionService } from "@/server/services/transaction.service";
import { AccountType } from "@prisma/client";
import { Decimal } from "decimal.js";

describe("Active Financial Cycle Attribution", () => {
  let userId: string;
  const dashboardService = new DashboardService();
  const debtService = new DebtService();
  const transactionService = new TransactionService();

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "financial_cycle_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Cycle Tester",
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

    await db.category.create({
      data: {
        userId,
        name: "Food",
        type: "VARIABLE_EXPENSE",
      },
    });
  });

  it("proves July contains 0 transactions, August contains salary & outgoings, debt balances remain intact, and new transactions default to budgetMonth 2026-08", async () => {
    // 1. Process August Salary on 28 July 2026
    const sms = "AED 5,750.00 has been credited to your account no. 014557001234501 DTB SALARY. The available balance is AED 5,752.56.";
    const smsRes = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-28T10:33:00.000Z"),
    });
    expect(smsRes.outcome).toBe("auto_posted");

    // 2. Create Debt & Record Payment on 28 July
    const debtCat = await db.category.create({
      data: { userId, name: "Loans", type: "DEBT" },
    });
    const debt = await debtService.createDebt(userId, {
      name: "Haroon Loan",
      originalBalance: 1000,
      monthlyPayment: 300,
      dueDay: 15,
      rolloverFeeRate: 0,
      categoryId: debtCat.id,
    });

    await debtService.recordDebtPayment(userId, debt.id, {
      amount: 300,
      paymentDate: new Date("2026-07-28T18:21:00Z"),
      syncLedger: true,
    });

    // 3. Create regular Expense on 29 July (without passing budgetMonth)
    const foodCat = await db.category.findFirst({ where: { userId, name: "Food" } });
    const expenseTx = await transactionService.createTransaction(userId, {
      date: new Date("2026-07-29T12:00:00Z"),
      categoryId: foodCat!.id,
      description: "Groceries",
      amount: new Decimal(197.90),
      paymentMethod: "Card",
      type: "EXPENSE",
    });

    // ASSERTION 1: New transactions created after the August salary default to budgetMonth = "2026-08"
    expect(expenseTx.budgetMonth).toBe("2026-08");

    const debtLedgerTx = await db.transaction.findFirst({ where: { userId, type: "DEBT_PAYMENT" } });
    expect(debtLedgerTx?.budgetMonth).toBe("2026-08");

    // ASSERTION 2: July Dashboard contains ZERO transactions (0.00 income, 0.00 expenses, 0.00 remaining)
    const julyDash = await dashboardService.getDashboardData(userId, "2026-07");
    expect(julyDash.actual.income).toBe("0.00");
    expect(julyDash.actual.expenses).toBe("0.00");
    expect(julyDash.actual.debtPayments).toBe("0.00");
    expect(julyDash.actual.remaining).toBe("0.00");

    // ASSERTION 3: August Dashboard contains salary (5,750), outgoings (497.90 = 300 + 197.90), and remaining cash flow (5252.10)
    const augDash = await dashboardService.getDashboardData(userId, "2026-08");
    expect(augDash.actual.income).toBe("5750.00");
    expect(augDash.actual.expenses).toBe("197.90");
    expect(augDash.actual.debtPayments).toBe("300.00");
    expect(augDash.actual.remaining).toBe("5252.10");

    // ASSERTION 4: Default dashboard opens on August 2026 automatically
    const defaultDash = await dashboardService.getDashboardData(userId);
    expect(defaultDash.month).toBe("2026-08");

    // ASSERTION 5: Debt balance and ENBD balance remain accurate
    const updatedDebt = await debtService.getDebtById(debt.id, userId);
    expect(updatedDebt.currentBalance.toFixed(2)).toBe("700.00");

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("5752.56");
  });
});
