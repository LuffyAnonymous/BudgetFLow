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

  it("adds a post-checkpoint transaction on top of the bank's own last reported balance", async () => {
    const checkpoint = new Date();
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "5750.00",
        latestImportedBalance: "5750.00",
        latestImportedBalanceAt: checkpoint,
        lastSMSImportedAt: checkpoint,
      },
    });
    accountId = account.id;

    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date(),
        occurredAt: new Date(checkpoint.getTime() + 60_000),
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
    expect(account2.currentBalance).toBe("2250.00"); // 5750 - 3500

    const persisted = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Number(persisted.currentBalance)).toBe(2250);
  });

  /**
   * Regression pin for a real incident: this button used to force a full
   * recompute (sum every transaction from zero, discarding the bank's own
   * latestImportedBalance reading entirely). On this exact real account
   * shape it produced AED 1,190.88 — an internally-consistent sum of the
   * visible ledger that did not match the user's real bank balance,
   * because the ledger doesn't capture everything the bank's own reading
   * does (pre-tracking history, informational-only messages). The correct,
   * anchored answer — confirmed against the user's actual bank balance —
   * is AED 4.81. If this ever regresses back to forcing a full recompute,
   * this test fails on the exact numbers that went wrong in production.
   */
  it("regression: does not repeat the incident where forcing a full recompute produced AED 1,190.88 instead of the correct AED 4.81", async () => {
    const staleCheckpoint = new Date("2026-08-30T07:34:35.000Z");
    const account = await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: "EMIRATES_NBD",
        currentBalance: "200.93",
        latestImportedBalance: "200.93",
        latestImportedBalanceAt: staleCheckpoint,
        lastSMSImportedAt: staleCheckpoint,
      },
    });
    accountId = account.id;

    // Transactions genuinely older than the checkpoint — already reflected
    // in the bank's own 200.93 reading, must not be summed again.
    for (const [desc, amount, occurredAt] of [
      ["Salary", "5750.00", "2026-08-28T11:59:24.000Z"],
      ["ATM Withdrawal", "3500.00", "2026-08-28T12:57:50.000Z"],
      ["Transfer to Mashreq", "150.00", "2026-08-28T13:54:19.000Z"],
    ] as const) {
      await db.transaction.create({
        data: {
          userId,
          accountId,
          date: new Date(occurredAt),
          occurredAt: new Date(occurredAt),
          categoryId,
          description: desc,
          amount,
          paymentMethod: "Email Import",
          type: desc === "Salary" ? "INCOME" : "EXPENSE",
          cashFlowDirection: desc === "Salary" ? "INFLOW" : "OUTFLOW",
        },
      });
    }

    // Genuinely new activity, after the checkpoint — must be added.
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date("2026-09-01T22:11:23.600Z"),
        occurredAt: new Date("2026-09-01T22:11:23.600Z"),
        categoryId,
        description: "Nol Card recharge",
        amount: "150.00",
        paymentMethod: "Email Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });
    await db.transaction.create({
      data: {
        userId,
        accountId,
        date: new Date("2026-09-01T22:13:05.921Z"),
        occurredAt: new Date("2026-09-01T22:13:05.921Z"),
        categoryId,
        description: "Buy Food and Essentials",
        amount: "46.12",
        paymentMethod: "Email Import",
        type: "EXPENSE",
        cashFlowDirection: "OUTFLOW",
      },
    });

    const res = await POST();
    const json = await res.json();
    const account2 = json.data.find((a: { id: string }) => a.id === accountId);
    expect(account2.currentBalance).toBe("4.81");
    expect(account2.currentBalance).not.toBe("1190.88");
  });
});
