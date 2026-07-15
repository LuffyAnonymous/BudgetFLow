import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../src/app/api/imports/sms/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { importSettingService } from "../../src/server/services/import-setting.service";

describe("SMS Webhook tolerant receivedAt parsing", () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    // Clean DB
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // Create user
    const user = await db.user.create({
      data: {
        email: "date_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Date Tester",
      },
    });
    userId = user.id;

    // Enable import setting & generate token
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD", "MASHREQ"],
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
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: new Date(Date.now() - 10000).toISOString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.outcome).not.toBe("rejected");
  });

  it("handles missing timestamp", async () => {
    const req = makeRequest({
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.outcome).not.toBe("rejected");
  });

  it("handles empty timestamp", async () => {
    const req = makeRequest({
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: "",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.outcome).not.toBe("rejected");
  });

  it("handles invalid timestamp", async () => {
    const req = makeRequest({
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: "not-a-date",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.outcome).not.toBe("rejected");
  });

  it("handles malformed timestamp", async () => {
    const req = makeRequest({
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: "2026-99-99T99:99:99Z",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.outcome).not.toBe("rejected");
  });
});
