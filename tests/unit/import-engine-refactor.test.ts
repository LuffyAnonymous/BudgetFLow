import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { accountService } from "../../src/server/services/account.service";
import { importService } from "../../src/imports/engine/import.service";
import { DashboardService } from "../../src/server/services/dashboard.service";
import { AccountType, TransactionType, ImportConfidence } from "@prisma/client";
import { Decimal } from "decimal.js";

const dashboardService = new DashboardService();

describe("SMS Import Engine Refactor Tests", () => {
  let userId: string;

  beforeEach(async () => {
    // 1. Clean up database
    await db.importedTransaction.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.remittance.deleteMany({});
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.account.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // 2. Create test user
    const user = await db.user.create({
      data: {
        email: "refactor_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Refactor Tester",
      },
    });
    userId = user.id;

    // 3. Create categories
    const categories = ["Salary", "Groceries", "Food Delivery", "Transport", "Shopping", "Subscriptions", "Entertainment", "Transfers", "Uncategorized"];
    for (const name of categories) {
      await db.category.create({
        data: {
          userId,
          name,
          type: name === "Salary" ? "INCOME" : "VARIABLE_EXPENSE",
        },
      });
    }

    // 4. Create import setting with enabled
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        autoImportSalary: true,
        senderAllowlist: ["ENBD", "MASHREQ"],
      },
    });

    // 5. Ensure default accounts exist
    await accountService.ensureDefaultAccounts(userId);
  });

  it("1. Emirates NBD salary credit with available balance", async () => {
    const sms = "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY TR REF EPHCOP1810A4BEZH 2229XXX62XXX-19. The available balance is AED 5,752.56.";
    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("processed");

    // Verify transaction
    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);
    expect(txs[0].amount.toFixed(2)).toBe("5750.00");
    expect(txs[0].type).toBe(TransactionType.INCOME);
    expect(txs[0].description).toBe("Salary");

    // Verify balance
    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("5752.56");
  });

  it("2. Mashreq card purchase with available balance", async () => {
    const sms = "Mashreq Debit Card ending 3411 was used for a transaction of AED 192.00 at CARREFOUR on Tuesday, 14 July 2026. Available balance: AED 153.17";
    const result = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("processed");

    // Verify transaction
    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);
    expect(txs[0].amount.toFixed(2)).toBe("192.00");
    expect(txs[0].type).toBe(TransactionType.EXPENSE);
    expect(txs[0].description).toBe("Purchase at CARREFOUR");

    // Verify category resolved to Groceries (known merchant mapping)
    const category = await db.category.findUnique({ where: { id: txs[0].categoryId } });
    expect(category?.name).toBe("Groceries");

    // Verify balance
    const accounts = await accountService.getAccounts(userId);
    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ)!;
    expect(mashreq.currentBalance.toFixed(2)).toBe("153.17");
  });

  it("3 & 4 & 5. Emirates NBD outgoing transfer to Mashreq, Mashreq incoming, and combined total check", async () => {
    // Phase 1: Salary credit to ENBD sets balance to 5,752.56
    await importService.processSms(userId, {
      sender: "ENBD",
      message: "AED 5,750.00 has been credited... available balance is AED 5,752.56.",
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    // Phase 2: ENBD transfer of 3,750 to Mashreq
    const smsOut = "Dear Customer, your transfer of AED 3,750.00 to Mashreq account ending 1234 was successful. Ref: TRF123. The available balance is AED 2,002.56.";
    const resOut = await importService.processSms(userId, {
      sender: "ENBD",
      message: smsOut,
      receivedAt: new Date("2026-07-15T00:05:00.000Z"),
    });
    expect(resOut.outcome).toBe("processed");

    // Check transaction created is of type TRANSFER
    const txsAfterOut = await db.transaction.findMany({
      where: { userId, type: TransactionType.TRANSFER },
    });
    expect(txsAfterOut).toHaveLength(1);
    expect(txsAfterOut[0].amount.toFixed(2)).toBe("3750.00");

    // Check ENBD balance is 2002.56
    const accountsAfterOut = await accountService.getAccounts(userId);
    const enbdAfterOut = accountsAfterOut.find(a => a.type === AccountType.EMIRATES_NBD)!;
    const mashreqAfterOut = accountsAfterOut.find(a => a.type === AccountType.MASHREQ)!;
    expect(enbdAfterOut.currentBalance.toFixed(2)).toBe("2002.56");
    expect(mashreqAfterOut.currentBalance.toFixed(2)).toBe("3750.00"); // 0 + 3750 fallback since Mashreq hasn't reported available balance yet

    // Phase 3: Mashreq incoming transfer SMS arrives
    const smsIn = "Dear Customer, you have received a transfer of AED 3,750.00 from Emirates NBD. Available balance: AED 3,750.00";
    const resIn = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: smsIn,
      receivedAt: new Date("2026-07-15T00:06:00.000Z"),
    });
    expect(resIn.outcome).toBe("processed");

    // Ensure no duplicate ledger transfer transaction is created
    const txsFinal = await db.transaction.findMany({
      where: { userId, type: TransactionType.TRANSFER },
    });
    expect(txsFinal).toHaveLength(1);

    // Verify balances
    const accountsFinal = await accountService.getAccounts(userId);
    const enbdFinal = accountsFinal.find(a => a.type === AccountType.EMIRATES_NBD)!;
    const mashreqFinal = accountsFinal.find(a => a.type === AccountType.MASHREQ)!;
    expect(enbdFinal.currentBalance.toFixed(2)).toBe("2002.56");
    expect(mashreqFinal.currentBalance.toFixed(2)).toBe("3750.00");

    // Verify combined total
    const total = enbdFinal.currentBalance.add(mashreqFinal.currentBalance);
    expect(total.toFixed(2)).toBe("5752.56");
  });

  it("6. Available balance overrides calculated balance", async () => {
    // Initial state: ENBD balance is 5,752.56
    await importService.processSms(userId, {
      sender: "ENBD",
      message: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY TR REF REF123. The available balance is AED 5,752.56.",
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    // Send a transaction of 100 but available balance reported is 850 (e.g. some manual spending outside app)
    const sms = "Your ENBD card ending 1234 was charged AED 100.00 at CARREFOUR. Available balance is AED 850.00";
    await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:10:00.000Z"),
    });

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("850.00"); // overridden exactly
  });

  it("7. No available balance uses plus/minus fallback", async () => {
    // Set authoritative initial balance of 153.17 for Mashreq
    await importService.processSms(userId, {
      sender: "MASHREQ",
      message: "Mashreq Debit Card ending 3411 was used for a transaction of AED 100.00 at CARREFOUR. Available balance: AED 153.17",
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    // Receive purchase with NO available balance reported
    const sms = "Your Mashreq card ending 3411 was used for a transaction of AED 50.00 at CARREFOUR.";
    await importService.processSms(userId, {
      sender: "MASHREQ",
      message: sms,
      receivedAt: new Date("2026-07-15T00:05:00.000Z"),
    });

    const accounts = await accountService.getAccounts(userId);
    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ)!;
    expect(mashreq.currentBalance.toFixed(2)).toBe("103.17"); // 153.17 - 50.00
  });

  it("8. Declined transaction creates no expense", async () => {
    // Initial balance: 153.17
    await importService.processSms(userId, {
      sender: "MASHREQ",
      message: "Mashreq Debit Card ending 3411 was used for a transaction of AED 100.00 at CARREFOUR. Available balance: AED 153.17",
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    // Declined SMS
    const sms = "Dear Customer, your transaction of AED 100.00 at CARREFOUR was declined due to insufficient funds.";
    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:05:00.000Z"),
    });

    expect(result.outcome).toBe("declined");

    // Verify no new transaction was created
    const carrefourTxs = await db.transaction.findMany({ where: { userId, description: { contains: "CARREFOUR" } } });
    // Should only have the first Mashreq transaction, not any ENBD transaction
    expect(carrefourTxs).toHaveLength(1);
    expect(carrefourTxs[0].accountId).not.toBe(
      (await db.account.findFirst({ where: { userId, type: AccountType.EMIRATES_NBD } }))!.id
    );

    // Verify balance unchanged
    const accounts = await accountService.getAccounts(userId);
    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ)!;
    expect(mashreq.currentBalance.toFixed(2)).toBe("153.17");
  });

  it("9. Duplicate SMS creates no duplicate transaction", async () => {
    const sms = "Your Mashreq card ending 3411 was used for a transaction of AED 50.00 at CARREFOUR. Available balance: AED 103.17";
    
    // First delivery
    const res1 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(res1.outcome).toBe("processed");

    // Second delivery
    const res2 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(res2.outcome).toBe("duplicate");

    // Verify only one ledger transaction exists
    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);

    // Verify balance was only updated once
    const accounts = await accountService.getAccounts(userId);
    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ)!;
    expect(mashreq.currentBalance.toFixed(2)).toBe("103.17");
  });

  it("10. Dashboard total equals Emirates NBD balance plus Mashreq balance", async () => {
    // Setup balances
    await importService.processSms(userId, {
      sender: "ENBD",
      message: "AED 2,002.56 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    await importService.processSms(userId, {
      sender: "MASHREQ",
      message: "Dear Customer, you have received a salary credit of AED 3,750.00. Available balance: AED 3,750.00",
      receivedAt: new Date("2026-07-15T00:05:00.000Z"),
    });

    const data = await dashboardService.getDashboardData(userId);
    expect(data.totalAvailableMoney).toBe("8750.00"); // 5000.00 + 3750.00
  });
});
