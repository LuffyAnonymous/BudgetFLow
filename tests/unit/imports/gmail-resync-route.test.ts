import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let currentUserId: string | null = "user-1";
let mockIntegration: unknown = { userId: "user-1" };
let resyncOutcome: { transactionsProcessed: number } | Error = { transactionsProcessed: 3 };
let capturedWindowDays: number | null = null;
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
  resyncGmailIntegration: async (_integration: unknown, windowDays: number) => {
    capturedWindowDays = windowDays;
    if (resyncOutcome instanceof Error) throw resyncOutcome;
    return resyncOutcome;
  },
}));

// Imported after the mocks above so the route picks up the mocked modules.
const { POST } = await import("../../../src/app/api/settings/gmail-link/resync/route");

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/settings/gmail-link/resync${query}`, { method: "POST" });
}

describe("POST /api/settings/gmail-link/resync", () => {
  beforeEach(() => {
    currentUserId = "user-1";
    mockIntegration = { userId: "user-1" };
    resyncOutcome = { transactionsProcessed: 3 };
    capturedWindowDays = null;
    markErrorSpy.mockClear();
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 409 when Gmail isn't connected", async () => {
    mockIntegration = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
  });

  it("defaults to a 7-day window", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(capturedWindowDays).toBe(7);
    const json = await res.json();
    expect(json.data.transactionsProcessed).toBe(3);
  });

  it("respects a custom days query param", async () => {
    await POST(makeRequest("?days=3"));
    expect(capturedWindowDays).toBe(3);
  });

  it("clamps an excessive days value to the max window", async () => {
    await POST(makeRequest("?days=999"));
    expect(capturedWindowDays).toBe(14);
  });

  it("falls back to the default window for an invalid days value", async () => {
    await POST(makeRequest("?days=notanumber"));
    expect(capturedWindowDays).toBe(7);
  });

  it("marks the integration as errored and returns 500 when the resync throws", async () => {
    resyncOutcome = new Error("Gmail API unavailable");
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(markErrorSpy).toHaveBeenCalledWith("user-1", "Gmail API unavailable");
  });
});
