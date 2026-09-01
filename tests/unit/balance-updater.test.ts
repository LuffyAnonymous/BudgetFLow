import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { updateBalance } from "../../src/imports/engine/balance-updater";
import { TransactionDirection } from "../../src/imports/engine/direction-classifier";
import { Decimal } from "decimal.js";

/**
 * Regression coverage for the production bug this fix exists for: two
 * transactions posted the same calendar day, but processed (backfilled/
 * resynced) in an order that doesn't match when they actually happened —
 * an OLDER real-world balance snapshot silently clobbered a NEWER one
 * because "most recently processed" and "most recently happened" aren't
 * the same thing for anything but a live, real-time import.
 */
describe("updateBalance — event-time-aware authoritative balance anchoring", () => {
  let accountId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.user.deleteMany({ where: { email: "balance_updater_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "balance_updater_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Balance Updater Tester" },
    });

    const account = await db.account.create({
      data: { userId: user.id, name: "Emirates NBD", type: "EMIRATES_NBD", currentBalance: 0 },
    });
    accountId = account.id;
  });

  it("applies the first authoritative balance normally (no anchor yet)", async () => {
    const salaryTime = new Date("2026-08-29T09:00:00.000Z");
    await updateBalance(accountId, null, TransactionDirection.INFLOW, new Decimal("5750.48"), salaryTime);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("5750.48");
    expect(account.latestImportedBalance?.toFixed(2)).toBe("5750.48");
    expect(account.latestImportedBalanceAt?.toISOString()).toBe(salaryTime.toISOString());
  });

  it("a later authoritative balance (by real event time) correctly overwrites an earlier one, processed in the correct order", async () => {
    const salaryTime = new Date("2026-08-29T09:00:00.000Z");
    const withdrawalTime = new Date("2026-08-29T16:57:00.000Z");

    await updateBalance(accountId, null, TransactionDirection.INFLOW, new Decimal("5750.48"), salaryTime);
    await updateBalance(accountId, null, TransactionDirection.OUTFLOW, new Decimal("1500.48"), withdrawalTime);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("1500.48");
    expect(account.latestImportedBalanceAt?.toISOString()).toBe(withdrawalTime.toISOString());
  });

  it("THE BUG: an older authoritative balance, processed out of order (e.g. backfilled after a newer one), must NOT clobber the newer one", async () => {
    const salaryTime = new Date("2026-08-29T09:00:00.000Z");
    const withdrawalTime = new Date("2026-08-29T16:57:00.000Z");

    // Withdrawal (later real event) gets processed FIRST.
    await updateBalance(accountId, null, TransactionDirection.OUTFLOW, new Decimal("1500.48"), withdrawalTime);
    // Salary (earlier real event) gets processed SECOND — e.g. a resync
    // that happened to pick up messages in this order.
    await updateBalance(accountId, null, TransactionDirection.INFLOW, new Decimal("5750.48"), salaryTime);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    // Must still reflect the withdrawal's balance — the more recently
    // *processed* salary message is chronologically OLDER and must not win.
    expect(account.currentBalance.toFixed(2)).toBe("1500.48");
    expect(account.latestImportedBalanceAt?.toISOString()).toBe(withdrawalTime.toISOString());
  });

  it("a plain (non-authoritative) increment for a transaction older than the anchor is also skipped, not double-counted", async () => {
    const anchorTime = new Date("2026-08-29T12:00:00.000Z");
    await updateBalance(accountId, null, TransactionDirection.INFLOW, new Decimal("1000.00"), anchorTime);

    // A backfilled purchase that happened BEFORE the anchor — already
    // reflected in the bank's own reported balance.
    const beforeAnchor = new Date("2026-08-29T08:00:00.000Z");
    await updateBalance(accountId, new Decimal("50.00"), TransactionDirection.OUTFLOW, null, beforeAnchor);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("1000.00"); // unchanged
  });

  it("a plain increment for a transaction newer than the anchor applies normally", async () => {
    const anchorTime = new Date("2026-08-29T12:00:00.000Z");
    await updateBalance(accountId, null, TransactionDirection.INFLOW, new Decimal("1000.00"), anchorTime);

    const afterAnchor = new Date("2026-08-29T18:00:00.000Z");
    await updateBalance(accountId, new Decimal("50.00"), TransactionDirection.OUTFLOW, null, afterAnchor);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("950.00");
  });
});
