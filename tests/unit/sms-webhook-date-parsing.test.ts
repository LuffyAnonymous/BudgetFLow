import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/imports/sms/route";
import { db } from "@/lib/db";
import { importSettingService } from "../../src/server/services/import-setting.service";
import { accountService } from "../../src/server/services/account.service";

describe("POST /api/imports/sms Date Parsing", () => {
  let userId: string;
  let token: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "date_parse_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Date Parse Tester",
      },
    });
    userId = user.id;

    await accountService.ensureDefaultAccounts(userId);

    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD"],
      },
    });

    const res = await importSettingService.generateToken(userId);
    token = res.plaintext;
  });

  const makeRequest = (payload: any) => {
    return new NextRequest("http://localhost/api/imports/sms", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  };

  it("accepts a valid ISO timestamp", async () => {
    const req = makeRequest({
      sender: "ENBD",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: new Date(Date.now() - 10000).toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("accepts a valid unix timestamp (in milliseconds)", async () => {
    const req = makeRequest({
      sender: "ENBD",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: Date.now() - 10000,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("accepts a valid unix timestamp (in seconds)", async () => {
    const req = makeRequest({
      sender: "ENBD",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: Math.floor((Date.now() - 10000) / 1000),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("falls back gracefully to current date when timestamp is invalid format", async () => {
    const req = makeRequest({
      sender: "ENBD",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: "not-a-valid-date",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("falls back gracefully when receivedAt field is omitted", async () => {
    const req = makeRequest({
      sender: "ENBD",
      message: "Test transaction AED 50.00 at Carrefour",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
