import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let currentUserId: string | null = "user-1";
const resetMock = vi.fn(async () => ({
  transactionsDeleted: 5,
  debtPaymentsDeleted: 1,
  savingTransactionsDeleted: 2,
  remittancesDeleted: 0,
  importedTransactionsDeleted: 3,
  attachmentsDeleted: 0,
  accountsReset: 2,
  debtsReset: 1,
  savingGoalsReset: 1,
}));

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

vi.mock("@/server/services/data-reset.service", () => ({
  dataResetService: {
    resetAllFinancialData: resetMock,
  },
}));

const { POST, CONFIRMATION_PHRASE } = await import("../../src/app/api/settings/reset-all-data/route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/settings/reset-all-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings/reset-all-data", () => {
  beforeEach(() => {
    currentUserId = "user-1";
    resetMock.mockClear();
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST(makeRequest({ confirm: CONFIRMATION_PHRASE }));
    expect(res.status).toBe(401);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls the service when the confirmation phrase is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("returns 400 and never calls the service when the confirmation phrase doesn't match exactly", async () => {
    const res = await POST(makeRequest({ confirm: "delete everything" })); // wrong case
    expect(res.status).toBe(400);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("calls the reset service and returns its summary when the phrase matches exactly", async () => {
    const res = await POST(makeRequest({ confirm: CONFIRMATION_PHRASE }));
    expect(res.status).toBe(200);
    expect(resetMock).toHaveBeenCalledWith("user-1");
    const json = await res.json();
    expect(json.data.transactionsDeleted).toBe(5);
  });
});
