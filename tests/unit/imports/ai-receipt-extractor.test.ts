import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { parse: mockParse } };
  }),
}));

import { extractReceiptTransaction } from "../../../src/imports/engine/ai-receipt-extractor";

const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
const fakePdf = Buffer.from("%PDF-1.4 fake content");

describe("extractReceiptTransaction (AI vision extraction)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockParse.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns null without calling the API when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractReceiptTransaction(fakeJpeg, "image/jpeg");
    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("returns extracted fields for a successful image extraction", async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: true,
        amount: 42.5,
        currency: "aed",
        vendor: "Corniche Cafe",
        transactionDate: "2026-08-10",
        description: "Coffee and pastry",
      },
    });

    const result = await extractReceiptTransaction(fakeJpeg, "image/jpeg");
    expect(result).not.toBeNull();
    expect(result?.amount.toFixed(2)).toBe("42.50");
    expect(result?.currency).toBe("AED");
    expect(result?.vendor).toBe("Corniche Cafe");
    expect(result?.transactionDate?.toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("sends a PDF as a document content block, not an image block", async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: true,
        amount: 1200,
        currency: "AED",
        vendor: "Acme Supplies LLC",
        transactionDate: null,
        description: "Office supplies invoice",
      },
    });

    await extractReceiptTransaction(fakePdf, "application/pdf");
    const callArgs = mockParse.mock.calls[0][0];
    const contentBlocks = callArgs.messages[0].content;
    expect(contentBlocks[0].type).toBe("document");
    expect(contentBlocks[0].source.media_type).toBe("application/pdf");
  });

  it("returns null when no amount is found on the document", async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        amountFound: false,
        amount: 0,
        currency: "AED",
        vendor: null,
        transactionDate: null,
        description: null,
      },
    });

    const result = await extractReceiptTransaction(fakeJpeg, "image/jpeg");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the API call itself fails", async () => {
    mockParse.mockRejectedValue(new Error("network error"));
    const result = await extractReceiptTransaction(fakeJpeg, "image/jpeg");
    expect(result).toBeNull();
  });
});
