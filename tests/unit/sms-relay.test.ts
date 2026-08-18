import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/integrations/n8n/sms-relay/route";

const originalSecret = process.env.N8N_SMS_WEBHOOK_SECRET;
const TEST_SECRET = "test-shared-secret";

function makeRequest(opts: { secret?: string; authorization?: string; body?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.secret !== undefined) headers["x-budgetflow-webhook-secret"] = opts.secret;
  if (opts.authorization !== undefined) headers["authorization"] = opts.authorization;
  return new NextRequest("http://localhost/api/integrations/n8n/sms-relay", {
    method: "POST",
    headers,
    body: opts.body ?? JSON.stringify({ body: "AED 100 debited", from: "ENBD" }),
  });
}

describe("POST /api/integrations/n8n/sms-relay", () => {
  beforeEach(() => {
    process.env.N8N_SMS_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.N8N_SMS_WEBHOOK_SECRET = originalSecret;
    vi.unstubAllGlobals();
  });

  it("rejects requests with a missing or wrong shared secret before ever calling n8n", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ secret: "wrong", authorization: "Bearer bf_import_abc" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the caller's Authorization header through to n8n, not just the shared secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeRequest({ secret: TEST_SECRET, authorization: "Bearer bf_import_realtoken123" }));
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const forwardedHeaders = init.headers as Record<string, string>;
    expect(forwardedHeaders["Authorization"]).toBe("Bearer bf_import_realtoken123");
    expect(forwardedHeaders["X-BudgetFlow-Webhook-Secret"]).toBe(TEST_SECRET);
  });

  it("still forwards successfully when the caller sends no Authorization header (n8n will reject it downstream, not the relay)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await POST(makeRequest({ secret: TEST_SECRET }));
    const [, init] = fetchMock.mock.calls[0];
    const forwardedHeaders = init.headers as Record<string, string>;
    expect(forwardedHeaders["Authorization"]).toBe("");
  });
});
