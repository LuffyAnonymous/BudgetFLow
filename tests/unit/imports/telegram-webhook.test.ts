import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The AI merchant-recovery fallback (import.service.ts) calls the Anthropic
// SDK whenever a regex parser succeeds without a merchant. This test file
// mocks global.fetch for the Telegram outgoing-message assertions below —
// without this mock, the Anthropic SDK's own HTTP call would also hit that
// mock and shift fetchSpy.mock.calls[0] away from the Telegram request.
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return {
      messages: {
        parse: vi.fn().mockResolvedValue({
          parsed_output: { amountFound: false, amount: 0, currency: "AED", merchant: null, referenceCode: null, availableBalance: null },
        }),
      },
    };
  }),
}));

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

    // Mock fetch
    fetchSpy = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve("Success"),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

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

    // Enable import settings for the user, with chat 12345 already linked
    // (self-serve linking itself is exercised separately below).
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD", "MASHREQ", "TABBY"],
        telegramChatId: "12345",
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const makeWebhookRequest = (payload: unknown, secret = "test-webhook-secret") => {
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

  it("replies that the chat isn't connected for an unlinked chat ID", async () => {
    const req = makeWebhookRequest({
      update_id: 110,
      message: {
        message_id: 210,
        chat: { id: 99999 }, // Never linked to any account
        date: Math.floor(Date.now() / 1000),
        text: "ENBD:\nYour salary of AED 5750.00 has been credited to account ending 1234."
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("unlinked chat ID");

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toContain("isn't connected to a BudgetFlow account");
  });

  it("links a chat when sent a valid /link <code> command, then accepts SMS from it", async () => {
    const { importSettingService } = await import("@/server/services/import-setting.service");
    const { code } = await importSettingService.generateTelegramLinkCode(userId);

    const linkReq = makeWebhookRequest({
      update_id: 120,
      message: {
        message_id: 220,
        chat: { id: 424242 },
        date: Math.floor(Date.now() / 1000),
        text: `/link ${code}`,
      }
    });

    const linkRes = await POST(linkReq);
    expect(linkRes.status).toBe(200);
    const linkJson = await linkRes.json();
    expect(linkJson.linked).toBe(true);

    const updated = await db.importSetting.findUnique({ where: { userId } });
    expect(updated?.telegramChatId).toBe("424242");
    expect(updated?.telegramLinkCode).toBeNull();

    // The same code can't be reused
    fetchSpy.mockClear();
    const replayReq = makeWebhookRequest({
      update_id: 121,
      message: {
        message_id: 221,
        chat: { id: 999888 },
        date: Math.floor(Date.now() / 1000),
        text: `/link ${code}`,
      }
    });
    const replayRes = await POST(replayReq);
    const replayJson = await replayRes.json();
    expect(replayJson.reason).toBe("invalid_link_code");
  });

  it("rejects an expired or unknown /link code", async () => {
    const req = makeWebhookRequest({
      update_id: 122,
      message: {
        message_id: 222,
        chat: { id: 555000 },
        date: Math.floor(Date.now() / 1000),
        text: "/link 000000",
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reason).toBe("invalid_link_code");
  });

  it("successfully parses ENBD salary SMS and sends success reply for a linked chat", async () => {
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

  it("auto-posts a low-confidence prefix-overridden ENBD debit message, flagged for a second look", async () => {
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
    expect(body.text).toContain("✅ Imported");
    expect(body.text).toContain("⚠️ Needs a second look: low confidence");
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
