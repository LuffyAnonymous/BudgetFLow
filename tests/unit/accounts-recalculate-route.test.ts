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

    const category = await db.category.create({ data: { userId, name: "Groceries", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;

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
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("recomputes and persists the corrected balance for the current user", async () => {
    const res = await POST();
    expect(res.status).toBe(200);

    const json = await res.json();
    const account = json.data.find((a: { id: string }) => a.id === accountId);
    expect(account.currentBalance).toBe("2250.00");

    const persisted = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Number(persisted.currentBalance)).toBe(2250);
  });
});
