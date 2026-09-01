import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

let currentUserId: string | null = null;

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

const { POST } = await import("../../src/app/api/accounts/recalculate/route");

describe("POST /api/accounts/recalculate", () => {
  let userId: string;
  let accountId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "recalc_route@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "recalc_route@budgetflow.ae", passwordHash: "dummy-hash", name: "Recalc Tester" },
    });
    userId = user.id;
    currentUserId = user.id;

    const category = await db.category.create({ data: { userId, name: "Groceries", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("recomputes and persists the corrected balance for the current user, even when it's stuck on a same-day checkpoint", async () => {
    // Simulate a stale cached balance the way the same-day-exclusion bug
    // would have left it: currentBalance stuck at the checkpoint despite a
    // real transaction existing in the ledger since.
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "5750.00",
        latestImportedBalance: "5750.00",
        lastSMSImportedAt: new Date(),
      },
    });
    accountId = account.id;

    // Every real BudgetFlow account is auto-created at currentBalance: 0
    // (see ensureAccountForInstitution) — the true full history is always
    // reconstructable from the ledger, which is exactly why forcing a
    // from-zero recompute here (rather than anchoring on a balance that
    // may itself be the corrupted value) is safe.
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date(),
        categoryId,
        description: "Salary",
        amount: "5750.00",
        paymentMethod: "Email Import",
        type: "INCOME",
        cashFlowDirection: "INFLOW",
      },
    });
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date(),
        categoryId,
        description: "ATM Withdrawal",
        amount: "3500.00",
        paymentMethod: "SMS Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });

    const res = await POST();
    expect(res.status).toBe(200);

    const json = await res.json();
    const account2 = json.data.find((a: { id: string }) => a.id === accountId);
    expect(account2.currentBalance).toBe("2250.00"); // 5750 - 3500, from a genuine full-ledger sum

    const persisted = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Number(persisted.currentBalance)).toBe(2250);
  });

  it("fixes THE BUG's exact scenario: an out-of-order backfill that left currentBalance on the earlier (salary) snapshot instead of the later (withdrawal) one", async () => {
    // Reproduces exactly what the production bug left behind: the account
    // row's currentBalance/latestImportedBalance stuck on the salary's
    // reading, even though a later withdrawal genuinely happened and its
    // own Transaction row already exists in the ledger.
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "5750.48", // stuck on the salary's reading
        latestImportedBalance: "5750.48",
        latestImportedBalanceAt: new Date(), // a "too-late" anchor, per the bug
        lastSMSImportedAt: new Date(),
      },
    });
    accountId = account.id;

    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date("2026-08-29T00:00:00.000Z"),
        occurredAt: new Date("2026-08-29T09:00:00.000Z"),
        categoryId,
        description: "Salary",
        amount: "5750.00",
        paymentMethod: "Email Import",
        type: "INCOME",
        cashFlowDirection: "INFLOW",
      },
    });
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date("2026-08-29T00:00:00.000Z"),
        occurredAt: new Date("2026-08-29T12:57:00.000Z"),
        categoryId,
        description: "ATM Withdrawal",
        amount: "3500.00",
        paymentMethod: "Email Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });

    const res = await POST();
    const json = await res.json();
    const account2 = json.data.find((a: { id: string }) => a.id === accountId);
    expect(account2.currentBalance).toBe("2250.00");
  });
});
