import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { parse: mockParse } };
  }),
}));

import { extractSmsTransaction } from "../../../src/imports/engine/ai-sms-extractor";

describe("extractSmsTransaction (AI SMS fallback)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockParse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    // Restore the real env var value, so other test files relying on its
    // absence/presence aren't affected by ordering.
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns null without calling the API when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractSmsTransaction("AED 100 credited to your account");
    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("returns extracted fields on a successful, confident extraction", async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: true,
        amount: 500,
        currency: "aed",
        merchant: "Acme Consulting FZE",
        referenceCode: "ref123",
        availableBalance: 1000,
      },
    });

    const result = await extractSmsTransaction("You have received AED 500 from Acme Consulting FZE. New balance AED 1000.");
    expect(result).not.toBeNull();
    expect(result?.amount.toFixed(2)).toBe("500.00");
    expect(result?.currency).toBe("AED");
    expect(result?.merchant).toBe("Acme Consulting FZE");
    expect(result?.availableBalance?.toFixed(2)).toBe("1000.00");
  });

  it("returns null when the model reports no amount was found", async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: false,
        amount: 0,
        currency: "AED",
        merchant: null,
        referenceCode: null,
        availableBalance: null,
      },
    });

    const result = await extractSmsTransaction("Thanks for being a loyal customer!");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the API call itself fails", async () => {
    mockParse.mockRejectedValue(new Error("network error"));
    const result = await extractSmsTransaction("some unusual bank message");
    expect(result).toBeNull();
  });
});
