import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
import { accountService } from "@/server/services/account.service";
import { AccountType } from "@prisma/client";

describe("Import Engine Refactor Validation", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "refactor_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Refactor Tester",
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

    // Seed Groceries category
    await db.category.create({
      data: {
        userId,
        name: "Groceries",
        type: "VARIABLE_EXPENSE",
      },
    });
  });

  it("1. Valid ENBD salary SMS credits Emirates NBD account", async () => {
    const sms = "AED 5,750.00 has been credited to your account no. 014557001234501 DTB SALARY. The available balance is AED 5,752.56.";
    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("auto_posted");
    if (result.outcome === "auto_posted") {
      expect(result.transactionId).toBeDefined();
    }

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("5752.56");
  });

  it("2. Available balance overrides calculated balance for ENBD", async () => {
    const sms = "AED 5,000.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. The available balance is AED 6,000.00.";
    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("auto_posted");

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("6000.00");
  });

  it("3. Duplicate SMS creates no duplicate transaction", async () => {
    const sms = "AED 5,000.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. The available balance is AED 6,000.00.";
    
    // First delivery
    const res1 = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(res1.outcome).toBe("auto_posted");

    // Second delivery
    const res2 = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    expect(res2.outcome).toBe("duplicate");

    const txs = await db.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(1);

    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("6000.00");
  });
});
