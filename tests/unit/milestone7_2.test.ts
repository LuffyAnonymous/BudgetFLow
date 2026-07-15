import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { accountService } from "../../src/server/services/account.service";
import { importService } from "../../src/imports/engine/import.service";
import { AccountType, ImportStatus } from "@prisma/client";

describe("Milestone 7.2 — Personal Finance Automation Workflow (Refactored)", () => {
  let userId: string;

  beforeEach(async () => {
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.remittance.deleteMany({});
    await db.transaction.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.notification.deleteMany({});
    await db.category.deleteMany({});
    await db.account.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.setting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "m72_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "M72 Tester",
      },
    });
    userId = user.id;

    await db.setting.create({
      data: {
        userId,
        monthlySalary: 5750.00,
        payday: 25,
      },
    });

    const categoriesData = [
      { name: "Salary", type: "INCOME" },
      { name: "Transfers", type: "VARIABLE_EXPENSE" },
      { name: "Transport", type: "VARIABLE_EXPENSE" },
      { name: "Groceries", type: "VARIABLE_EXPENSE" },
      { name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      { name: "Tabby Payment", type: "DEBT" },
    ];

    for (const cat of categoriesData) {
      await db.category.create({
        data: { userId, name: cat.name, type: cat.type as any },
      });
    }

    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        autoImportSalary: true,
        senderAllowlist: ["ENBD", "MASHREQ"],
      },
    });
  });

  it("10. Missing default accounts are provisioned safely without duplicates", async () => {
    // Assert no accounts exist initially
    let accounts = await db.account.findMany({ where: { userId } });
    expect(accounts.length).toBe(0);

    const msg = "AED 50.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: TXN11";
    await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg,
      receivedAt: new Date(),
    });

    // Accounts should be provisioned now
    accounts = await db.account.findMany({ where: { userId } });
    expect(accounts.length).toBe(3); // ENBD, MASHREQ, CASH

    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ);
    expect(mashreq).toBeDefined();

    // Calling ensure again should not duplicate
    await accountService.ensureDefaultAccounts(userId);
    const accountsAfter = await db.account.findMany({ where: { userId } });
    expect(accountsAfter.length).toBe(3);
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
      sender: "MASHREQ",
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

  it("3 & 4. Low-confidence imports remain pending review, and confirmImport handles them", async () => {
    // UNKNOWN STORE evaluates to low confidence
    const msg = "AED 120.00 debited from card ending 1234 at UNKNOWN STORE on 11-07-2026.";
    const res = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("review_required");
    if (res.outcome === "review_required") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.status).toBe(ImportStatus.REVIEW_REQUIRED);

      // Confirm import
      const confirmRes = await importService.confirmImport(userId, res.importedTransactionId);
      expect(confirmRes.transactionId).toBeDefined();

      const ledgerTx = await db.transaction.findUnique({ where: { id: confirmRes.transactionId } });
      expect(ledgerTx!.amount.toFixed(2)).toBe("120.00");
      expect(ledgerTx!.description).toBe("UNKNOWN STORE");

      const updatedImported = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(updatedImported!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("5. Pending transfer acknowledgements do not create ledger transactions", async () => {
    const msg = "Dear customer, your pending transfer of AED 3,750.00 to Mashreq account is being processed. Ref: PEND11.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("pending_event");
    if (res.outcome === "pending_event") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.status).toBe(ImportStatus.IGNORED);
      expect(importedTx!.transactionId).toBeNull();
    }
  });

  it("6. Completed Mashreq and Emirates NBD transfer messages match into one internal transfer", async () => {
    // First: Outflow from ENBD
    const msg1 = "Dear Customer, your transfer of AED 3,750.00 to Mashreq account ending 1234 was successful. Ref: TRF123456.";
    const res1 = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg1,
      receivedAt: new Date("2026-07-25T10:00:00Z"),
    });

    expect(res1.outcome).toBe("auto_posted");
    let tx1Id = "";
    if (res1.outcome === "auto_posted") {
      tx1Id = res1.transactionId;
    }

    // Second: Inflow to Mashreq
    const msg2 = "AED 3,750.00 has been credited to your Mashreq account ending 1234. Ref: TRF123456.";
    const res2 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg2,
      receivedAt: new Date("2026-07-25T10:05:00Z"),
    });

    expect(res2.outcome).toBe("auto_posted");
    if (res2.outcome === "auto_posted") {
      // It should match to the same transaction
      expect(res2.transactionId).toBe(tx1Id);
    }

    // Assert only one transaction exists
    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(1);
  });

  it("7. Available balance values update the correct bank account", async () => {
    const msg = "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. The available balance is AED 12,000.00.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: msg,
      receivedAt: new Date(),
    });
    console.log("TEST 7 RESULT:", res);

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD);
    expect(enbd!.currentBalance.toFixed(2)).toBe("12000.00");
  });

  it("8. Declined transactions do not affect the ledger or balances", async () => {
    // Give Mashreq a base balance of 500
    await accountService.ensureDefaultAccounts(userId);
    const accounts = await db.account.findMany({ where: { userId } });
    const mashreq = accounts.find(a => a.type === AccountType.MASHREQ)!;
    await db.account.update({ where: { id: mashreq.id }, data: { currentBalance: 500 } });

    const msg = "Declined: AED 1,000.00 at RTA NOL due to insufficient funds. Ref: FAIL123";
    const res = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("ignored");

    // Assert balance is untouched
    const mashreqAfter = await db.account.findUnique({ where: { id: mashreq.id } });
    expect(mashreqAfter!.currentBalance.toFixed(2)).toBe("500.00");

    // Assert no ledger transaction
    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(0);
  });

  it("9. Duplicate messages are idempotent", async () => {
    const msg = "AED 50.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: IDEMP11";
    
    // First
    const res1 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg,
      receivedAt: new Date(),
    });
    expect(res1.outcome).toBe("auto_posted");

    // Second (same message)
    const res2 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: msg,
      receivedAt: new Date(),
    });
    expect(res2.outcome).toBe("duplicate");

    const validMsg = "AED 150.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: IDEMP22";
    const res4 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: validMsg,
      receivedAt: new Date(),
      idempotencyKey: "test-key-456",
    });
    expect(res4.outcome).toBe("auto_posted");

    const res5 = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: validMsg,
      receivedAt: new Date(),
      idempotencyKey: "test-key-456",
    });
    expect(res5.outcome).toBe("idempotent");
  });
});
