import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

const originalEnv = { ...process.env };
const CRON_SECRET = "test-cron-secret";

const reconcileMock = vi.fn(async (_userId: string) => ({ matched: 1, scanned: 2 }));

vi.mock("@/imports/reconciliation/reconcile-transfers.service", () => ({
  reconcileTransfers: (userId: string) => reconcileMock(userId),
}));

const { GET } = await import("../../src/app/api/cron/reconcile-transfers/route");

function makeRequest(query = "", secret: string | null = CRON_SECRET): NextRequest {
  const url = new URL(`http://localhost/api/cron/reconcile-transfers${query}`);
  return new NextRequest(url, {
    method: "GET",
    headers: secret !== null ? { Authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/reconcile-transfers", () => {
  beforeEach(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    reconcileMock.mockClear();
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: { contains: "reconcile_cron_test" } } });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when the bearer token is missing or wrong", async () => {
    const missing = await GET(makeRequest("", null));
    expect(missing.status).toBe(401);

    const wrong = await GET(makeRequest("", "wrong-secret"));
    expect(wrong.status).toBe(401);

    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("reconciles only the given user when ?userId= is provided, without querying all users", async () => {
    const res = await GET(makeRequest("?userId=explicit-user-1"));
    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledWith("explicit-user-1");

    const json = await res.json();
    expect(json.usersProcessed).toBe(1);
    expect(json.totalMatched).toBe(1);
    expect(json.totalScanned).toBe(2);
  });

  it("reconciles every user with import enabled when no userId is given", async () => {
    const userA = await db.user.create({
      data: { email: "reconcile_cron_test_a@budgetflow.ae", passwordHash: "x", name: "A" },
    });
    const userB = await db.user.create({
      data: { email: "reconcile_cron_test_b@budgetflow.ae", passwordHash: "x", name: "B" },
    });
    const userC = await db.user.create({
      data: { email: "reconcile_cron_test_c@budgetflow.ae", passwordHash: "x", name: "C (import disabled)" },
    });
    await db.importSetting.create({ data: { userId: userA.id, enabled: true } });
    await db.importSetting.create({ data: { userId: userB.id, enabled: true } });
    await db.importSetting.create({ data: { userId: userC.id, enabled: false } });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const calledUserIds = reconcileMock.mock.calls.map((c) => c[0]);
    expect(calledUserIds).toContain(userA.id);
    expect(calledUserIds).toContain(userB.id);
    expect(calledUserIds).not.toContain(userC.id);
  });

  it("keeps processing remaining users when one user's reconciliation throws", async () => {
    reconcileMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const userA = await db.user.create({
      data: { email: "reconcile_cron_test_fail@budgetflow.ae", passwordHash: "x", name: "Fail" },
    });
    await db.importSetting.create({ data: { userId: userA.id, enabled: true } });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.some((r: { error?: string }) => r.error === "boom")).toBe(true);
  });
});
