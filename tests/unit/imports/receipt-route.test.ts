import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Decimal } from "decimal.js";
import { db } from "@/lib/db";

let currentUserId: string | null = "receipt-route-user";
let extractionResult: {
  amount: Decimal;
  currency: string;
  vendor: string | null;
  transactionDate: Date | null;
  description: string | null;
} | null = {
  amount: new Decimal("45.50"),
  currency: "AED",
  vendor: "Carrefour",
  transactionDate: null,
  description: "Groceries",
};

vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
}));

vi.mock("@/imports/engine/ai-receipt-extractor", () => ({
  extractReceiptTransaction: async () => extractionResult,
}));

vi.mock("@/server/services/attachment.service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/attachment.service")>(
    "@/server/services/attachment.service"
  );
  return {
    ...actual,
    AttachmentService: { upload: vi.fn(async () => {}) },
  };
});

const { POST } = await import("../../../src/app/api/imports/receipt/route");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function makeRequest(): NextRequest {
  const formData = new FormData();
  formData.append("file", new File([PNG_MAGIC], "receipt.png", { type: "image/png" }));
  return new NextRequest("http://localhost/api/imports/receipt", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/imports/receipt", () => {
  let userId: string;

  beforeEach(async () => {
    await db.notification.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "receipt_route@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "receipt_route@budgetflow.ae", passwordHash: "dummy-hash", name: "Receipt Tester" },
    });
    userId = user.id;
    currentUserId = user.id;

    extractionResult = {
      amount: new Decimal("45.50"),
      currency: "AED",
      vendor: "Carrefour",
      transactionDate: null,
      description: "Groceries",
    };
  });

  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("auto-posts a successful extraction instead of requiring review", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("processed");
    expect(json.transactionId).toBeTruthy();

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: json.transactionId } });
    expect(tx.amount.toString()).toBe("45.5");
    expect(tx.origin).toBe("DOCUMENT_IMPORT");

    const importedTx = await db.importedTransaction.findFirst({ where: { userId } });
    expect(importedTx?.status).toBe("PROCESSED");
  });

  it("creates the auto-posted transaction on the user's primary account when one is set", async () => {
    const primary = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", isPrimary: true } });

    const res = await POST(makeRequest());
    const json = await res.json();

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: json.transactionId } });
    expect(tx.accountId).toBe(primary.id);
  });

  it("falls back to a shared Receipts account when no primary account is set", async () => {
    const res = await POST(makeRequest());
    const json = await res.json();

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: json.transactionId } });
    const account = await db.account.findUniqueOrThrow({ where: { id: tx.accountId! } });
    expect(account.name).toBe("Receipts");
  });

  it("raises an IMPORT_AUTO_POSTED notification so a misread amount is still catchable", async () => {
    const res = await POST(makeRequest());
    const json = await res.json();

    const notifications = await db.notification.findMany({ where: { userId, type: "IMPORT_AUTO_POSTED" } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].relatedEntityId).toBe(json.transactionId);
  });

  it("still requires manual entry when extraction genuinely fails (nothing readable)", async () => {
    extractionResult = null;

    const res = await POST(makeRequest());
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.outcome).toBe("extraction_failed");

    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(0);

    const importedTx = await db.importedTransaction.findFirst({ where: { userId } });
    expect(importedTx?.status).toBe("REVIEW_REQUIRED");
  });
});
