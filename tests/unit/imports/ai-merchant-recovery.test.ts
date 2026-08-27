import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { parse: mockParse } };
  }),
}));

import { importService } from "../../../src/imports/engine/import.service";

/**
 * Regex parsers will always have a next edge case they don't handle —
 * unusual punctuation, a new bank's phrasing, etc. Rather than treating each
 * one as a fresh regex patch, a regex parser that extracts everything except
 * the merchant name should fall back to the AI extractor to recover just
 * that field, so an unrecognized merchant format doesn't need a fallback
 * "Auto-imported" description when it doesn't have to.
 */
describe("AI merchant recovery after a partially-successful regex parse", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  let userId: string;

  beforeEach(async () => {
    mockParse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";

    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "ai_merchant_recovery@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "ai_merchant_recovery@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Recovery Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    await db.category.createMany({
      data: [
        { userId, name: "Dining", type: "VARIABLE_EXPENSE" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("recovers the merchant via AI when the regex parser's character class rejects it, and still auto-posts", async () => {
    // A semicolon in the merchant name isn't in the regex's allowed
    // character set or its terminator list, so MERCHANT_AT_RE fails to
    // match at all, even though amount/balance extraction succeeds fine.
    const message = "Purchase of AED 25.00 with Debit Card ending 1234 at Zoom's Cafe; Downtown. Avl Balance is AED 500.00.";

    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: true,
        amount: 25,
        currency: "AED",
        merchant: "Zoom's Cafe",
        referenceCode: null,
        availableBalance: 500,
      },
    });

    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx?.description).toBe("Zoom's Cafe");
    }
  });

  it("still auto-posts (with a fallback description) when both regex and AI fail to find a merchant", async () => {
    // The regex parser already succeeded on amount/balance — a missing
    // merchant name isn't a hard parse failure, just a cosmetic gap.
    const message = "Purchase of AED 25.00 with Debit Card ending 1234 at Zoom's Cafe; Downtown. Avl Balance is AED 500.00.";

    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: true,
        amount: 25,
        currency: "AED",
        merchant: null,
        referenceCode: null,
        availableBalance: 500,
      },
    });

    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx?.description).toBe("Auto-imported");
    }
  });
});
