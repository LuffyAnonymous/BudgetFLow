import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { Decimal } from "decimal.js";

/**
 * Safety-net extraction for a bank/BNPL/wallet SMS that no regex parser
 * recognized, from a sender the user has explicitly trusted via their own
 * allowlist. Only mechanical field extraction — direction classification
 * and confidence scoring still run through the same shared logic every
 * other parsed message goes through (direction-classifier.ts,
 * confidence-evaluator.ts), so this module has no special-casing to get
 * wrong.
 */

const ExtractionSchema = z.object({
  amountFound: z.boolean().describe("True if a transaction amount is present in the message."),
  amount: z.number().describe("The transaction amount as a positive number. 0 if amountFound is false."),
  currency: z.string().describe("ISO 4217 currency code, e.g. AED, USD. Default to AED if the message gives no currency but is clearly a UAE bank/fintech message."),
  merchant: z.string().nullable().describe("Merchant, payer, or counterparty name if identifiable, else null."),
  referenceCode: z.string().nullable().describe("Bank/transaction reference or ID if present, else null."),
  availableBalance: z.number().nullable().describe("Available/remaining balance stated in the message, else null."),
});

export interface AiSmsExtractionResult {
  amount: Decimal;
  currency: string;
  merchant: string | null;
  referenceCode: string | null;
  availableBalance: Decimal | null;
}

const PARSER_KEY = "ai-text-extraction-v1";
export { PARSER_KEY as AI_SMS_PARSER_KEY };

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Attempts to extract transaction fields from a raw SMS the regex parsers
 * couldn't recognize. Returns null on failure (no amount found, or the API
 * call itself fails) — callers must fall back to a REVIEW_REQUIRED record
 * rather than dropping the message.
 */
export async function extractSmsTransaction(message: string): Promise<AiSmsExtractionResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[ai-sms-extractor] ANTHROPIC_API_KEY not configured; skipping AI fallback");
    return null;
  }

  try {
    const response = await getClient().messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system:
        "You extract structured financial transaction fields from a single bank, BNPL, or wallet-app SMS notification (UAE context). " +
        "Extract only what is explicitly stated in the message. Do not guess a merchant or amount that isn't present.",
      messages: [{ role: "user", content: message }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed || !parsed.amountFound || parsed.amount <= 0) {
      return null;
    }

    return {
      amount: new Decimal(parsed.amount),
      currency: (parsed.currency || "AED").toUpperCase(),
      merchant: parsed.merchant,
      referenceCode: parsed.referenceCode,
      availableBalance: parsed.availableBalance != null ? new Decimal(parsed.availableBalance) : null,
    };
  } catch (err) {
    console.error("[ai-sms-extractor] Extraction failed", err instanceof Error ? err.message : err);
    return null;
  }
}
