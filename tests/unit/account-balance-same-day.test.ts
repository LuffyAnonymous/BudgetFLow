import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { AccountService } from "../../src/server/services/account.service";
import { Decimal } from "decimal.js";

const accountService = new AccountService();

/**
 * Regression coverage for a real production bug: updateAccountBalance()'s
 * incremental recompute filtered transactions by `date > lastSMSImportedAt`.
 * `Transaction.date` is always midnight-UTC-truncated (financialDate), while
 * `lastSMSImportedAt` is a precise timestamp — so a transaction landing on
 * the SAME Dubai calendar day as the last balance-setting message always had
 * date <= lastSMSImportedAt and was silently dropped from the sum, snapping
 * the account's balance back toward the older checkpoint. Not an edge case:
 * this is the normal outcome for same-day activity, which is most activity.
 */
describe("Account balance recompute — same-day transactions", () => {
  let userId: string;
  let accountId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "same_day_balance@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "same_day_balance@budgetflow.ae", passwordHash: "dummy-hash", name: "Same Day Tester" },
    });
    userId = user.id;

    const category = await db.category.create({ data: { userId, name: "Groceries", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;
  });

  it("includes a transaction created the same calendar day as the balance checkpoint", async () => {
    // Simulate: a salary SMS reported "available balance AED 5750" earlier
    // today, setting the checkpoint.
    const now = new Date();
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "5750.00",
        latestImportedBalance: "5750.00",
        lastSMSImportedAt: now,
      },
    });
    accountId = account.id;

    // A withdrawal happens later the SAME day. financialDate truncates to
    // midnight UTC of today, exactly reproducing the real bug's trigger:
    // date (midnight) is always <= lastSMSImportedAt (a later time same day).
    const midnightToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: midnightToday,
        categoryId,
        description: "ATM Withdrawal",
        amount: "3500.00",
        paymentMethod: "SMS Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });

    const recomputed = await accountService.updateAccountBalance(userId, accountId);
    expect(recomputed.toString()).toBe(new Decimal("2250.00").toString()); // 5750 - 3500

    const updated = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Number(updated.currentBalance)).toBe(2250);
  });

  it("keeps reconcileAccountBalance's cache check consistent with updateAccountBalance's own method", async () => {
    const now = new Date();
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "5750.00",
        latestImportedBalance: "5750.00",
        lastSMSImportedAt: now,
      },
    });
    accountId = account.id;

    const midnightToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: midnightToday,
        categoryId,
        description: "ATM Withdrawal",
        amount: "3500.00",
        paymentMethod: "SMS Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });

    await accountService.updateAccountBalance(userId, accountId);

    // Before the fix, reconcileAccountBalance's ledgerBalance used a totally
    // different (unanchored, full-history-from-zero) formula than
    // updateAccountBalance's cached currentBalance, so cacheDifference was
    // essentially never zero for any account with a bank-reported baseline
    // — "Recalculating" would never clear regardless of correctness.
    const recon = await accountService.reconcileAccountBalance(userId, accountId);
    expect(recon.cacheDifference.isZero()).toBe(true);
    expect(recon.reconciliationStatus).not.toBe("CACHE_MISMATCH");
  });

  it("still reflects a manually-set balance with no ledger history at all (the legitimate use of the checkpoint)", async () => {
    // A wallet/bank balance set once, with no transaction representing the
    // starting amount itself — the checkpoint exists precisely because full
    // pre-app history isn't modeled as transactions. Must not be dropped.
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "1000.00",
        latestImportedBalance: "1000.00",
        lastSMSImportedAt: new Date(Date.now() - 3600 * 1000),
      },
    });

    const recomputed = await accountService.updateAccountBalance(userId, account.id);
    expect(Number(recomputed)).toBe(1000);
  });
});
