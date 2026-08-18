import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { Decimal } from "decimal.js";
import type { AllowedMimeType } from "@/server/utils/file-magic";

const ExtractionSchema = z.object({
  amountFound: z.boolean().describe("True if a total transaction amount is present on the receipt/invoice."),
  amount: z.number().describe("The total amount charged/invoiced, as a positive number. 0 if amountFound is false."),
  currency: z.string().describe("ISO 4217 currency code, e.g. AED, USD. Best guess from symbols/context if not explicit."),
  vendor: z.string().nullable().describe("The merchant, store, or company name on the receipt/invoice, else null."),
  transactionDate: z.string().nullable().describe("The date on the receipt/invoice in YYYY-MM-DD format, else null."),
  description: z.string().nullable().describe("A short one-line description of what was purchased, else null."),
});

export interface AiReceiptExtractionResult {
  amount: Decimal;
  currency: string;
  vendor: string | null;
  transactionDate: Date | null;
  description: string | null;
}

type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

function isImageMime(mimeType: AllowedMimeType): mimeType is ImageMimeType {
  return mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Extracts transaction fields from a photographed/scanned receipt or a PDF
 * invoice. Returns null on failure (unreadable document, no amount found,
 * or the API call itself fails) — the caller must still create a
 * REVIEW_REQUIRED record with nulls rather than lose the upload.
 */
export async function extractReceiptTransaction(
  fileBuffer: Buffer,
  mimeType: AllowedMimeType
): Promise<AiReceiptExtractionResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[ai-receipt-extractor] ANTHROPIC_API_KEY not configured; cannot extract");
    return null;
  }

  const base64Data = fileBuffer.toString("base64");
  const documentBlock = isImageMime(mimeType)
    ? { type: "image" as const, source: { type: "base64" as const, media_type: mimeType, data: base64Data } }
    : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64Data } };

  try {
    const response = await getClient().messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system:
        "You extract structured transaction fields from a single photographed or scanned receipt/invoice. " +
        "Extract only what is legible on the document. Do not guess a vendor or amount that isn't clearly present.",
      messages: [
        {
          role: "user",
          content: [documentBlock, { type: "text", text: "Extract the transaction details from this receipt/invoice." }],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed || !parsed.amountFound || parsed.amount <= 0) {
      return null;
    }

    return {
      amount: new Decimal(parsed.amount),
      currency: (parsed.currency || "AED").toUpperCase(),
      vendor: parsed.vendor,
      transactionDate: parsed.transactionDate ? new Date(parsed.transactionDate) : null,
      description: parsed.description,
    };
  } catch (err) {
    console.error("[ai-receipt-extractor] Extraction failed", err instanceof Error ? err.message : err);
    return null;
  }
}
