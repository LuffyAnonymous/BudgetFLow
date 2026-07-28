import { describe, it, expect, beforeEach } from "vitest";
import { POST, extractSmsText } from "../../src/app/api/imports/sms/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { importSettingService } from "../../src/server/services/import-setting.service";
import { accountService } from "../../src/server/services/account.service";

describe("SMS Shortcut Payload Extraction & Webhook Behavior", () => {
  let token: string;
  let userId: string;

  beforeEach(async () => {
    // 1. Clean up database
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.account.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // 2. Create test user
    const user = await db.user.create({
      data: {
        email: "extraction_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Extraction Tester",
      },
    });
    userId = user.id;

    // 3. Create default categories
    await db.category.create({
      data: {
        userId,
        name: "Salary",
        type: "INCOME",
      },
    });
    await db.category.create({
      data: {
        userId,
        name: "Groceries",
        type: "VARIABLE_EXPENSE",
      },
    });
    await db.category.create({
      data: {
        userId,
        name: "Uncategorized",
        type: "VARIABLE_EXPENSE",
      },
    });

    // 4. Create import setting with enabled & allowlist
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        autoImportSalary: true,
        senderAllowlist: ["ENBD"],
      },
    });

    // 5. Ensure default accounts exist
    await accountService.ensureDefaultAccounts(userId);

    // 6. Generate webhook API token
    const resToken = await importSettingService.generateToken(userId);
    token = resToken.plaintext;
  });

  const makeRequest = (payload: unknown) => {
    return new NextRequest("http://localhost/api/imports/sms", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  };

  describe("extractSmsText utility logic", () => {
    it("extracts from direct message string", () => {
      const payload = { sender: "ENBD", message: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00." };
      expect(extractSmsText(payload)).toBe(payload.message);
    });

    it("extracts from text string", () => {
      const payload = { sender: "ENBD", text: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00." };
      expect(extractSmsText(payload)).toBe(payload.text);
    });

    it("extracts from content string", () => {
      const payload = { sender: "ENBD", content: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00." };
      expect(extractSmsText(payload)).toBe(payload.content);
    });

    it("extracts from nested message object", () => {
      const payload = {
        sender: "ENBD",
        input: {
          message: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00."
        }
      };
      expect(extractSmsText(payload)).toBe(payload.input.message);
    });

    it("extracts from array payload", () => {
      const payload = {
        sender: "ENBD",
        input: [
          { value: "short" },
          { body: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00." }
        ]
      };
      expect(extractSmsText(payload)).toBe("Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00.");
    });

    it("rejects metadata-only or too short strings", () => {
      const payload = {
        sender: "ENBD",
        input: "short"
      };
      // "short" is too short (<= 15 chars) to be matched in generic search
      expect(extractSmsText(payload)).toBeNull();
    });

    it("stops infinite recursion on deeply nested payload and returns null", () => {
      // Build a deeply nested object of depth 10
      let nested: any = { message: "Purchase of AED 120.00 at Carrefour. Available balance is AED 850.00." };
      for (let i = 0; i < 10; i++) {
        nested = { val: nested };
      }
      expect(extractSmsText(nested)).toBeNull();
    });
  });

  describe("POST route behavior with varied iOS payloads", () => {
    it("processes direct message format successfully", async () => {
      const req = makeRequest({
        sender: "ENBD",
        message: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.outcome).toBe("auto_posted");
    });

    it("processes text format successfully", async () => {
      const req = makeRequest({
        sender: "ENBD",
        text: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.outcome).toBe("auto_posted");
    });

    it("processes input format successfully", async () => {
      const req = makeRequest({
        sender: "ENBD",
        input: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.outcome).toBe("auto_posted");
    });

    it("processes nested content format successfully", async () => {
      const req = makeRequest({
        sender: "ENBD",
        input: {
          content: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
        }
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.outcome).toBe("auto_posted");
    });

    it("processes array containing message format successfully", async () => {
      const req = makeRequest({
        sender: "ENBD",
        input: [
          { message: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00." }
        ]
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.outcome).toBe("auto_posted");
    });

    it("returns HTTP 400 with receivedKeys when SMS text is empty or missing", async () => {
      const req = makeRequest({
        sender: "ENBD",
        someRandomKey: 12345,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("SMS text could not be extracted");
      expect(json.receivedKeys).toContain("someRandomKey");
    });

    it("returns HTTP 400 when payload is empty", async () => {
      const req = makeRequest({});
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("SMS text could not be extracted");
      expect(json.receivedKeys).toHaveLength(0);
    });

    it("prevents DoS/crash on malicious deeply nested payload", async () => {
      let nested: any = { content: "Legitimate text that is too deep" };
      for (let i = 0; i < 20; i++) {
        nested = { depth: nested };
      }
      const req = makeRequest({
        sender: "ENBD",
        input: nested,
      });

      const res = await POST(req);
      expect(res.status).toBe(400); // Should fail extraction without throwing/crashing the process
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("SMS text could not be extracted");
    });

    it("handles duplicate transaction correctly", async () => {
      const payload = {
        sender: "ENBD",
        message: "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY. Available balance is AED 5,000.00.",
      };

      // First submit
      const res1 = await POST(makeRequest(payload));
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.outcome).toBe("auto_posted");

      // Duplicate submit
      const res2 = await POST(makeRequest(payload));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);
      expect(json2.outcome).toBe("duplicate");
    });
  });
});
