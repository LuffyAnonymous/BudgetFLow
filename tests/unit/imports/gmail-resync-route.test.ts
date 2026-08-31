import { describe, it, expect, vi, beforeEach } from "vitest";

let currentUserId: string | null = "user-1";
let mockIntegration: unknown = { userId: "user-1" };
let resyncOutcome: { transactionsProcessed: number } | Error = { transactionsProcessed: 3 };
let resyncCalledWith: { integration: unknown; days: unknown } | null = null;
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
  DEFAULT_RESYNC_WINDOW_DAYS: 7,
  MIN_RESYNC_WINDOW_DAYS: 1,
  MAX_RESYNC_WINDOW_DAYS: 30,
  resyncGmailIntegration: async (integration: unknown, days: unknown) => {
    resyncCalledWith = { integration, days };
    if (resyncOutcome instanceof Error) throw resyncOutcome;
    return resyncOutcome;
  },
}));

// Imported after the mocks above so the route picks up the mocked modules.
const { POST } = await import("../../../src/app/api/settings/gmail-link/resync/route");

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/settings/gmail-link/resync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

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
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 409 when Gmail isn't connected", async () => {
    mockIntegration = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
  });

  it("resyncs with the default 7-day window when no body is sent", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(resyncCalledWith).toEqual({ integration: { userId: "user-1" }, days: 7 });
    const json = await res.json();
    expect(json.data.transactionsProcessed).toBe(3);
    expect(json.data.days).toBe(7);
  });

  it("resyncs with a custom day count", async () => {
    const res = await POST(makeRequest({ days: 3 }));
    expect(res.status).toBe(200);
    expect(resyncCalledWith).toEqual({ integration: { userId: "user-1" }, days: 3 });
    const json = await res.json();
    expect(json.data.days).toBe(3);
  });

  it("rejects a day count below the minimum", async () => {
    const res = await POST(makeRequest({ days: 0 }));
    expect(res.status).toBe(400);
    expect(resyncCalledWith).toBeNull();
  });

  it("rejects a day count above the maximum", async () => {
    const res = await POST(makeRequest({ days: 31 }));
    expect(res.status).toBe(400);
    expect(resyncCalledWith).toBeNull();
  });

  it("rejects a non-integer day count", async () => {
    const res = await POST(makeRequest({ days: 3.5 }));
    expect(res.status).toBe(400);
    expect(resyncCalledWith).toBeNull();
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/settings/gmail-link/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json",
      })
    );
    expect(res.status).toBe(400);
    expect(resyncCalledWith).toBeNull();
  });

  it("marks the integration as errored and returns 500 when the resync throws", async () => {
    resyncOutcome = new Error("Gmail API unavailable");
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(markErrorSpy).toHaveBeenCalledWith("user-1", "Gmail API unavailable");
  });
});
