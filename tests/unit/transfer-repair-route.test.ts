import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let currentUserId: string | null = "user-1";
const diagnoseMock = vi.fn(async (..._args: unknown[]) => [{ transactionId: "tx-1", status: "FIXABLE" }]);
const repairMock = vi.fn(async (..._args: unknown[]) => ({ repaired: ["tx-1"], skipped: [] }));

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

vi.mock("@/server/services/transfer-repair.service", () => ({
  transferRepairService: {
    diagnose: (...args: unknown[]) => diagnoseMock(...args),
    repair: (...args: unknown[]) => repairMock(...args),
  },
}));

const { GET, POST } = await import("../../src/app/api/accounts/transfer-repair/route");

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/accounts/transfer-repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/accounts/transfer-repair", () => {
  beforeEach(() => {
    currentUserId = "user-1";
    diagnoseMock.mockClear();
    repairMock.mockClear();
  });

  it("GET returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(diagnoseMock).not.toHaveBeenCalled();
  });

  it("GET diagnoses only for the current user", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(diagnoseMock).toHaveBeenCalledWith("user-1");
    const json = await res.json();
    expect(json.data).toEqual([{ transactionId: "tx-1", status: "FIXABLE" }]);
  });

  it("POST returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST(makePostRequest({ transactionIds: ["tx-1"] }));
    expect(res.status).toBe(401);
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("POST rejects an empty transactionIds array", async () => {
    const res = await POST(makePostRequest({ transactionIds: [] }));
    expect(res.status).toBe(400);
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("POST rejects malformed JSON", async () => {
    const req = new NextRequest("http://localhost/api/accounts/transfer-repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(repairMock).not.toHaveBeenCalled();
  });

  it("POST repairs only the requesting user's transactionIds", async () => {
    const res = await POST(makePostRequest({ transactionIds: ["tx-1"] }));
    expect(res.status).toBe(200);
    expect(repairMock).toHaveBeenCalledWith("user-1", ["tx-1"]);
    const json = await res.json();
    expect(json.data.repaired).toEqual(["tx-1"]);
  });
});
