import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "../../../src/app/api/integrations/sms/shortcut/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AccountType } from "@prisma/client";

describe("iOS Shortcut SMS Ingestion Endpoint", () => {
  let userId: string;
  const originalEnv = { ...process.env };
  let fetchSpy = vi.fn();

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.IOS_SHORTCUT_IMPORT_TOKEN = "test-shortcut-token";
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_CHAT_USER_MAP = `12345:some-user-id`; // mapped dynamically

    // Mock fetch for Telegram notifications
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
        email: "shortcut_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Shortcut Tester",
      },
    });
    userId = user.id;

    // Update Telegram chat mapping
    process.env.TELEGRAM_CHAT_USER_MAP = `987654:${userId}`;

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

    // Create Groceries category
    await db.category.upsert({
      where: { userId_name: { userId, name: "Groceries" } },
      update: {},
      create: { userId, name: "Groceries", type: "VARIABLE_EXPENSE" }
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
        senderAllowlist: ["ENBD"],
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const makeShortcutRequest = (payload: unknown, token = "test-shortcut-token") => {
    const headers: Record<string, string> = {};
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
    headers["content-type"] = "application/json";

    return new NextRequest("http://localhost:3000/api/integrations/sms/shortcut", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  };

  it("2. Valid Emirates NBD credit SMS", async () => {
    const payload = {
      sender: "ENBD",
      message: "AED 5,000.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. The available balance is AED 6,000.00.",
    };

    const req = makeShortcutRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.outcome).toBe("processed");
    expect(json.bank).toBe("Emirates NBD");
    expect(json.type).toBe("INCOME");
    expect(json.amount).toBe("5000.00");
    expect(json.balance).toBe("6000.00");
  });

  it("3. Invalid token returns 401 and diagnostics", async () => {
    const payload = { sender: "ENBD", message: "Any SMS" };
    const req = makeShortcutRequest(payload, "wrong-token");
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(json.diagnostics).toBeDefined();
    expect(json.diagnostics.envVariableExists).toBe(true);
    expect(json.diagnostics.authorizationHeaderPresent).toBe(true);
    expect(json.diagnostics.bearerPrefixPresent).toBe(true);
    expect(json.diagnostics.receivedTokenLength).toBe(11);
    expect(json.diagnostics.expectedTokenLength).toBe(19);
    expect(json.diagnostics.tokenMatched).toBe(false);
  });

  it("4. Empty message returns 400", async () => {
    const payload = { sender: "ENBD", message: "" };
    const req = makeShortcutRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("7. Missing environment variable returns 500 configuration error", async () => {
    delete process.env.IOS_SHORTCUT_IMPORT_TOKEN;
    const payload = { sender: "ENBD", message: "Any SMS" };
    const req = makeShortcutRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("IOS_SHORTCUT_IMPORT_TOKEN is not configured");
  });

  it("5. Duplicate submission check", async () => {
    const payload = {
      sender: "ENBD",
      message: "AED 5,000.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. The available balance is AED 6,000.00.",
    };

    // First request
    const req1 = makeShortcutRequest(payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.outcome).toBe("processed");
    expect(json1.balance).toBe("6000.00");

    // Second request (duplicate)
    const req2 = makeShortcutRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.outcome).toBe("duplicate");

    // Verify balance was only modified once
    const acc = await db.account.findFirst({
      where: { userId, type: AccountType.EMIRATES_NBD }
    });
    expect(acc?.currentBalance.toFixed(2)).toBe("6000.00");
  });

  it("6. Account balance update verification", async () => {
    // ENBD base balance is 1000
    // Credit ENBD with 500 without available balance (should compute currentBalance = 1000 + 500 = 1500)
    const payload = {
      sender: "ENBD",
      message: "AED 500.00 has been credited to your account.",
    };

    const req = makeShortcutRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.outcome).toBe("processed");
    expect(json.balance).toBe("1500.00");

    const accounts = await db.account.findMany({ where: { userId } });
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("1500.00");
  });
});
