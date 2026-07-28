import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "../../../src/app/api/integrations/telegram/webhook/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AccountType } from "@prisma/client";

describe("Telegram Webhook Integration Endpoint", () => {
  let userId: string;
  const originalEnv = { ...process.env };
  let fetchSpy = vi.fn();

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = "12345,67890,55555"; // 12345 (mapped & exists), 67890 (mapped & not exists), 55555 (allowed but unmapped)

    // Mock fetch
    fetchSpy = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve("Success"),
    }));
    global.fetch = fetchSpy as any;

    // Clean DB in order
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // Create user
    const user = await db.user.create({
      data: {
        email: "telegram_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Telegram Tester",
      },
    });
    userId = user.id;

    // Set User Map dynamically (mapped 12345 to our real user, 67890 to a non-existent uuid)
    process.env.TELEGRAM_CHAT_USER_MAP = `12345:${userId},67890:84bec043-bff0-470e-9bba-fd81a6800844`;

    // Setup base account balances
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    await db.account.create({
      data: {
        userId,
        name: "Emirates NBD",
        type: AccountType.EMIRATES_NBD,
        currentBalance: 1000,
        latestImportedBalance: 1000,
        lastSMSImportedAt: oneHourAgo,
      }
    });


    // Create Uncategorized category
    await db.category.upsert({
      where: { userId_name: { userId, name: "Uncategorized" } },
      update: {},
      create: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" }
    });

    // Create Salary category
    await db.category.upsert({
      where: { userId_name: { userId, name: "Salary" } },
      update: {},
      create: { userId, name: "Salary", type: "INCOME" }
    });

    // Enable import settings for the user
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD", "MASHREQ", "TABBY"],
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const makeWebhookRequest = (payload: any, secret = "test-webhook-secret") => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (secret) {
      headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
    }
    return new NextRequest("http://localhost/api/integrations/telegram/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  };

  it("returns 401 when the webhook secret token is invalid or missing", async () => {
    const req = makeWebhookRequest({ update_id: 1, message: { text: "hello" } }, "wrong-secret");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("ignores messages without text, returning HTTP 200", async () => {
    const req = makeWebhookRequest({
      update_id: 101,
      message: {
        message_id: 201,
        chat: { id: 12345 },
        date: Math.floor(Date.now() / 1000),
        photo: []
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores messages from unauthorized chat IDs, returning HTTP 200", async () => {
    const req = makeWebhookRequest({
      update_id: 102,
      message: {
        message_id: 202,
        chat: { id: 99999 }, // Unauthorized Chat
        date: Math.floor(Date.now() / 1000),
        text: "Mashreq: AED 10.00 debited from card"
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("unauthorized");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores edited_message updates entirely, returning HTTP 200", async () => {
    const req = makeWebhookRequest({
      update_id: 102,
      edited_message: {
        message_id: 202,
        chat: { id: 12345 },
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("edited_message ignored");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replies that connection is not connected for allowed but unmapped chat ID", async () => {
    const req = makeWebhookRequest({
      update_id: 110,
      message: {
        message_id: 210,
        chat: { id: 55555 }, // Allowed in allowlist, but not in map
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("unmapped chat ID");

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toBe("Telegram account is not connected to BudgetFlow.");
  });

  it("replies that connection is invalid for mapped user that does not exist in DB", async () => {
    const req = makeWebhookRequest({
      update_id: 111,
      message: {
        message_id: 211,
        chat: { id: 67890 }, // Mapped to non-existent userId in map
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("invalid user mapping");

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toBe("Telegram account connection is invalid.");
  });

  it("successfully parses ENBD salary SMS and sends success reply for mapped user", async () => {
    const req = makeWebhookRequest({
      update_id: 103,
      message: {
        message_id: 203,
        chat: { id: 12345 },
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify reply sent
    expect(fetchSpy).toHaveBeenCalled();
    const fetchArgs = fetchSpy.mock.calls[0];
    expect(fetchArgs[0]).toContain("sendMessage");
    const body = JSON.parse(fetchArgs[1].body);
    expect(body.chat_id).toBe(12345);
    expect(body.reply_to_message_id).toBe(203);
    expect(body.text).toContain("✅ Imported");
    expect(body.text).toContain("Bank: Emirates NBD");
    expect(body.text).toContain("Type: Uncategorized");
    expect(body.text).toContain("Amount: AED 5,750.00");
    expect(body.text).toContain("Account: Emirates NBD");
  });

  it("successfully parses prefix-overridden ENBD debit message as review_required and replies", async () => {
    const req = makeWebhookRequest({
      update_id: 104,
      message: {
        message_id: 204,
        chat: { id: 12345 },
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nAED 10.00 has been debited from your account."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toContain("⚠️ Saved for review");
    expect(body.text).toContain("Reason: Could not confidently identify the transaction type.");
  });

  it("prevents duplicate Telegram webhook deliveries using stable chatId/messageId idempotencyKey", async () => {
    const payload = {
      update_id: 107,
      message: {
        message_id: 207,
        chat: { id: 12345 },
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    };

    // First request
    const res1 = await POST(makeWebhookRequest(payload));
    expect(res1.status).toBe(200);

    const body1 = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body1.text).toContain("✅ Imported");

    // Check that transaction is stored in DB with correct idempotencyKey
    const importedTxs = await db.importedTransaction.findMany({
      where: { userId }
    });
    expect(importedTxs.length).toBe(1);
    expect(importedTxs[0].idempotencyKey).toBe("telegram:12345:207");

    // Clear calls
    fetchSpy.mockClear();

    // Second request
    const res2 = await POST(makeWebhookRequest(payload));
    expect(res2.status).toBe(200);

    const body2 = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body2.text).toContain("ℹ️ Already imported");
  });
});
