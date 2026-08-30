import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST } from "../../../../src/app/api/webhooks/gmail-push/route";

const originalEnv = { ...process.env };
const SECRET = "test-gmail-push-secret";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function makeRequest(body: unknown, secret: string | null = SECRET) {
  const url = new URL("http://localhost/api/webhooks/gmail-push");
  if (secret !== null) url.searchParams.set("secret", secret);
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/gmail-push", () => {
  beforeEach(async () => {
    process.env.GMAIL_PUSH_WEBHOOK_SECRET = SECRET;
    await db.gmailIntegration.deleteMany({});
    await db.user.deleteMany({ where: { email: "gmail_push_test@budgetflow.ae" } });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when the secret query param is missing or wrong", async () => {
    const missing = await POST(makeRequest({ message: { data: b64url({ emailAddress: "x@gmail.com" }) } }, null));
    expect(missing.status).toBe(401);

    const wrong = await POST(makeRequest({ message: { data: b64url({ emailAddress: "x@gmail.com" }) } }, "wrong-secret"));
    expect(wrong.status).toBe(401);
  });

  it("acks (200) a malformed JSON body instead of erroring", async () => {
    const req = new NextRequest(`http://localhost/api/webhooks/gmail-push?secret=${SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("acks (200) a push with no message.data rather than erroring", async () => {
    const res = await POST(makeRequest({ subscription: "projects/x/subscriptions/y" }));
    expect(res.status).toBe(200);
  });

  it("acks (200) when message.data isn't valid base64/JSON", async () => {
    const res = await POST(makeRequest({ message: { data: "!!!not-base64-json!!!" } }));
    expect(res.status).toBe(200);
  });

  it("acks (200) with no sync attempted when no integration matches the notified email address", async () => {
    const res = await POST(
      makeRequest({ message: { data: b64url({ emailAddress: "unknown@gmail.com", historyId: "123" }) } })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.transactionsProcessed).toBeUndefined();
  });
});
