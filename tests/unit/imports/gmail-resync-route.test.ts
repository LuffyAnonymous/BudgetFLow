import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUserId: string | null = "user-1";
let mockIntegration: unknown = { userId: "user-1" };
let resyncOutcome: { transactionsProcessed: number } | Error = { transactionsProcessed: 3 };
let resyncCalledWith: unknown = null;
const markErrorSpy = vi.fn();

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

vi.mock("@/server/services/gmail-integration.service", () => ({
  gmailIntegrationService: {
    getActiveIntegration: async () => mockIntegration,
    markError: (...args: unknown[]) => markErrorSpy(...args),
  },
}));

vi.mock("@/lib/gmail/sync-integration", () => ({
  resyncGmailIntegration: async (integration: unknown) => {
    resyncCalledWith = integration;
    if (resyncOutcome instanceof Error) throw resyncOutcome;
    return resyncOutcome;
  },
}));

// Imported after the mocks above so the route picks up the mocked modules.
const { POST } = await import("../../../src/app/api/settings/gmail-link/resync/route");

describe("POST /api/settings/gmail-link/resync", () => {
  beforeEach(() => {
    currentUserId = "user-1";
    mockIntegration = { userId: "user-1" };
    resyncOutcome = { transactionsProcessed: 3 };
    resyncCalledWith = null;
    markErrorSpy.mockClear();
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 409 when Gmail isn't connected", async () => {
    mockIntegration = null;
    const res = await POST();
    expect(res.status).toBe(409);
  });

  it("resyncs the current user's integration and returns the processed count", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(resyncCalledWith).toEqual({ userId: "user-1" });
    const json = await res.json();
    expect(json.data.transactionsProcessed).toBe(3);
  });

  it("marks the integration as errored and returns 500 when the resync throws", async () => {
    resyncOutcome = new Error("Gmail API unavailable");
    const res = await POST();
    expect(res.status).toBe(500);
    expect(markErrorSpy).toHaveBeenCalledWith("user-1", "Gmail API unavailable");
  });
});
