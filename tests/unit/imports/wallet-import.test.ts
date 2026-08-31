import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../../src/app/api/imports/wallet/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { importSettingService } from "../../../src/server/services/import-setting.service";
import { AccountType } from "@prisma/client";

describe("Apple Wallet Import Endpoint", () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    // Clean DB in order
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // Create user
    const user = await db.user.create({
      data: {
        email: "wallet_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Wallet Tester",
      },
    });
    userId = user.id;

    // Create default accounts for testing with base balance imported 1 hour ago
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


    // Create default Category Uncategorized
    await db.category.upsert({
      where: { userId_name: { userId, name: "Uncategorized" } },
      update: {},
      create: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" }
    });

    // Enable import setting & generate token
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
      },
    });

    const tokenRes = await importSettingService.generateToken(userId);
    token = tokenRes.plaintext;
  });

  const makeRequest = (payload: unknown, authToken = token) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    return new NextRequest("http://localhost/api/imports/wallet", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  };



  it("successfully processes a valid Apple Wallet transaction for Emirates NBD card", async () => {
    const req = makeRequest({
      merchant: "Spinneys",
      amount: 100,
      currency: "AED",
      card: "ENBD Credit",
      date: new Date().toISOString()
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.outcome).toBe("processed");

    // Verify balance is updated (1000 - 100 = 900)
    const account = await db.account.findFirst({ where: { userId, type: AccountType.EMIRATES_NBD } });
    expect(Number(account?.currentBalance)).toBe(900);
  });

  it("auto-creates a Wallet Import fallback account and posts to it for an unmapped card", async () => {
    const req = makeRequest({
      merchant: "Zoom",
      amount: 20,
      card: "Unknown Visa",
      date: new Date().toISOString()
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.outcome).toBe("processed");
    expect(json.transactionId).toBeDefined();

    const account = await db.account.findFirst({ where: { userId, name: "Wallet Import" } });
    expect(account).not.toBeNull();
    expect(Number(account?.currentBalance)).toBe(-20);

    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(1);
  });

  it("reuses an existing Wallet Import account for a second unmapped card instead of creating another", async () => {
    // Create "Wallet Import" account
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    await db.account.create({
      data: {
        userId,
        name: "Wallet Import",
        type: AccountType.CASH,
        currentBalance: 500,
        latestImportedBalance: 500,
        lastSMSImportedAt: oneHourAgo,
      }
    });

    const req = makeRequest({
      merchant: "Zoom",
      amount: 20,
      card: "Unknown Visa",
      date: new Date().toISOString()
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.outcome).toBe("processed");

    // Verify Wallet Import balance is updated (500 - 20 = 480)
    const account = await db.account.findFirst({ where: { userId, name: "Wallet Import" } });
    expect(Number(account?.currentBalance)).toBe(480);
  });

  it("returns 400 when amount is missing or invalid", async () => {
    const req = makeRequest({
      merchant: "Carrefour",
      card: "Mashreq",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
    expect(json.fieldErrors.amount).toBeDefined();
  });

  it("returns 400 when both merchant and name are missing", async () => {
    const req = makeRequest({
      amount: 45.75,
      card: "Mashreq",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
  });

  it("applies default AED currency and server date", async () => {
    const req = makeRequest({
      merchant: "Carrefour",
      amount: 50,
      card: "Emirates NBD",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.currency).toBe("AED");

    // Verify transaction exists in db
    const tx = await db.transaction.findFirst({ where: { userId } });
    expect(tx?.amount.toNumber()).toBe(50);
    expect(tx?.date).toBeDefined();
  });

  it("returns 401 when token is invalid or missing", async () => {
    const req = makeRequest({
      merchant: "Carrefour",
      amount: 50,
      card: "Emirates NBD",
    }, "invalid-token");

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("prevents duplicate requests using idempotencyKey (returns 409)", async () => {
    const payload = {
      merchant: "Carrefour",
      amount: 50,
      card: "Emirates NBD",
      idempotencyKey: "test-wallet-idem"
    };

    const req1 = makeRequest(payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const req2 = makeRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(409);
  });

  it("prevents duplicate requests using fingerprint (returns 409)", async () => {
    const payload = {
      merchant: "Carrefour",
      amount: 50,
      card: "Emirates NBD",
      date: "2026-07-16T16:35:22+04:00"
    };

    const req1 = makeRequest(payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    const req2 = makeRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(409);
  });
});
