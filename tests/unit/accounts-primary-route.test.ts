import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

let currentUserId: string | null = null;

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

const { PATCH } = await import("../../src/app/api/accounts/[id]/route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/accounts/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/accounts/[id] — set primary", () => {
  let ownerId: string;
  let attackerId: string;
  let ownerAccountId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.user.deleteMany({ where: { email: { in: ["accounts_route_owner@budgetflow.ae", "accounts_route_attacker@budgetflow.ae"] } } });

    const owner = await db.user.create({
      data: { email: "accounts_route_owner@budgetflow.ae", passwordHash: "dummy-hash", name: "Owner" },
    });
    ownerId = owner.id;

    const attacker = await db.user.create({
      data: { email: "accounts_route_attacker@budgetflow.ae", passwordHash: "dummy-hash", name: "Attacker" },
    });
    attackerId = attacker.id;

    const acc = await db.account.create({ data: { userId: ownerId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
    ownerAccountId = acc.id;
  });

  it("lets the owner set their own account as primary", async () => {
    currentUserId = ownerId;
    const res = await PATCH(makeRequest({ isPrimary: true }), { params: Promise.resolve({ id: ownerAccountId }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    const updated = json.data.find((a: { id: string }) => a.id === ownerAccountId);
    expect(updated.isPrimary).toBe(true);
  });

  it("rejects a signed-in user trying to set another user's account as primary", async () => {
    currentUserId = attackerId;
    const res = await PATCH(makeRequest({ isPrimary: true }), { params: Promise.resolve({ id: ownerAccountId }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ACCOUNT_NOT_FOUND");

    const account = await db.account.findUniqueOrThrow({ where: { id: ownerAccountId } });
    expect(account.isPrimary).toBe(false);
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await PATCH(makeRequest({ isPrimary: true }), { params: Promise.resolve({ id: ownerAccountId }) });
    expect(res.status).toBe(401);
  });
});
