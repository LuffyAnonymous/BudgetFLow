import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../src/imports/engine/import.service";
import { accountService } from "../../src/server/services/account.service";
import { AccountType, ImportStatus } from "@prisma/client";

describe("Milestone 7.2 — Personal Finance Automation Workflow (Refactored)", () => {
  let userId: string;

  beforeEach(async () => {
    // Clean all related DB tables
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // Create test user
    const user = await db.user.create({
      data: {
        email: "automation_workflow@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Automation Tester",
      },
    });
    userId = user.id;

    // Enable import engine for admin
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD"],
      },
    });

    // Create default categories for rules mapping tests
    await db.category.createMany({
      data: [
        { userId, name: "Salary", type: "INCOME" },
        { userId, name: "Transport", type: "VARIABLE_EXPENSE" },
        { userId, name: "Groceries", type: "VARIABLE_EXPENSE", budgetGroupKey: "FOOD" },
        { userId, name: "Dining", type: "VARIABLE_EXPENSE", budgetGroupKey: "FOOD" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  it("10. Missing default accounts are provisioned safely without duplicates", async () => {
    let accounts = await db.account.findMany({ where: { userId } });
    expect(accounts.length).toBe(0);

    // Call getAccounts
    await accountService.getAccounts(userId);

    // Accounts should be provisioned now
    accounts = await db.account.findMany({ where: { userId } });
    expect(accounts.length).toBe(2); // ENBD, CASH

    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD);
    expect(enbd).toBeDefined();

    // Calling ensure again should not duplicate
    await accountService.ensureDefaultAccounts(userId);
    const accountsAfter = await db.account.findMany({ where: { userId } });
    expect(accountsAfter.length).toBe(2);
  });

  it("1. High-confidence salary imports auto-post immediately", async () => {
    const msg = "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY TR REF EPHCOP18. The available balance is AED 5,752.56.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx).toBeDefined();
      expect(tx!.amount.toFixed(2)).toBe("5750.00");
    }
  });

  it("2. High-confidence purchases auto-post immediately", async () => {
    const msg = "AED 50.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: TXN11";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId }, include: { category: true } });
      expect(tx).toBeDefined();
      expect(tx!.amount.toFixed(2)).toBe("50.00");
      expect(tx!.category.name).toBe("Transport");
    }
  });

  it("3 & 4. Low-confidence imports still auto-post, flagged for a second look", async () => {
    const msg = "AED 120.00 debited from card ending 1234 at UNKNOWN STORE on 11-07-2026.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      expect(res.confidence).toBe("LOW");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
      expect(importedTx!.confidence).toBe("LOW");

      const ledgerTx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(ledgerTx!.amount.toFixed(2)).toBe("120.00");
      expect(ledgerTx!.description).toBe("UNKNOWN STORE");
    }
  });

  it("5. Pending transfer acknowledgements do not create ledger transactions", async () => {
    const msg = "Dear customer, your pending transfer of AED 3,750.00 to account is being processed. Ref: PEND11.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("pending_event");
    if (res.outcome === "pending_event") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.status).toBe(ImportStatus.REJECTED);
      expect(importedTx!.failureCode).toBe("PENDING_TRANSACTION");
      expect(importedTx!.transactionId).toBeNull();
    }
  });

  it("7. Salary status tracking returns accurately", async () => {
    const msg = "AED 12,000.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance: AED 12,000.00";
    await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date("2026-07-01T00:00:00Z"),
    });

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD);
    expect(enbd!.currentBalance.toFixed(2)).toBe("12000.00");
  });

  it("8. Declined transactions do not affect the ledger or balances", async () => {
    await accountService.ensureDefaultAccounts(userId);
    const accounts = await db.account.findMany({ where: { userId } });
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    await db.account.update({ where: { id: enbd.id }, data: { currentBalance: 500 } });

    const msg = "Declined: AED 1,000.00 at RTA NOL due to insufficient funds. Ref: FAIL123";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("ignored");

    // Assert balance is untouched
    const enbdAfter = await db.account.findUnique({ where: { id: enbd.id } });
    expect(enbdAfter!.currentBalance.toFixed(2)).toBe("500.00");

    // Assert no ledger transaction
    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(0);
  });

  it("9. Duplicate messages are idempotent", async () => {
    const msg = "AED 50.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: IDEMP11";
    
    // First
    const res1 = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });
    expect(res1.outcome).toBe("auto_posted");

    // Second (same message)
    const res2 = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });
    expect(res2.outcome).toBe("duplicate");

    const validMsg = "AED 150.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: IDEMP22";
    const res4 = await importService.processSms(userId, {
      sender: "ENBD",
      message: validMsg,
      receivedAt: new Date(),
      idempotencyKey: "test-key-456",
    });
    expect(res4.outcome).toBe("auto_posted");

    const res5 = await importService.processSms(userId, {
      sender: "ENBD",
      message: validMsg,
      receivedAt: new Date(),
      idempotencyKey: "test-key-456",
    });
    expect(res5.outcome).toBe("idempotent");
  });
});
