/**
 * src/imports/email/parser-registry.ts
 *
 * Selects the correct IEmailParser for a given (fromAddress, subject, body)
 * tuple. Mirrors src/imports/sms/parser-registry.ts's structure.
 *
 * Unlike the SMS registry, there is no separate sender-allowlist check —
 * Gmail access is already scoped to the user's own inbox via OAuth (a much
 * stronger trust boundary than SMS's arbitrary-sender-forwarding model), so
 * the registry's own per-parser canParse() is the only gate.
 *
 * Adding new bank parsers:
 *   - Implement IEmailParser
 *   - Add an instance to REGISTERED_PARSERS below
 *   - No other changes required
 */

import type { IEmailParser, NormalizedEmailTransaction } from "./email-parser.interface";
import { emiratesNbdEmailParser } from "./parsers/emirates-nbd.parser";
import { mashreqEmailParser } from "./parsers/mashreq.parser";
import { mashreqCardPurchaseEmailParser } from "./parsers/mashreq-card-purchase.parser";

const REGISTERED_PARSERS: IEmailParser[] = [
  emiratesNbdEmailParser,
  mashreqEmailParser,
  mashreqCardPurchaseEmailParser,
];

export type EmailParserSelectionResult =
  | { outcome: "matched"; parser: IEmailParser }
  | { outcome: "no_match"; reason: string }
  | { outcome: "ambiguous"; matchedParsers: string[] };

export class EmailParserRegistry {
  select(fromAddress: string, subject: string, body: string): EmailParserSelectionResult {
    const candidates = REGISTERED_PARSERS.filter((p) => p.canParse(fromAddress, subject, body));

    if (candidates.length === 0) {
      return { outcome: "no_match", reason: "No parser recognised this email format" };
    }

    if (candidates.length > 1) {
      return { outcome: "ambiguous", matchedParsers: candidates.map((p) => p.parserKey) };
    }

    return { outcome: "matched", parser: candidates[0] };
  }

  /**
   * Convenience: select and immediately parse.
   * Returns null if no parser matches, ambiguous, or parse() itself
   * returned null (recognized format, extraction failed).
   */
  parse(
    fromAddress: string,
    subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): { result: NormalizedEmailTransaction; selectionResult: Extract<EmailParserSelectionResult, { outcome: "matched" }> } | null {
    const selectionResult = this.select(fromAddress, subject, body);
    if (selectionResult.outcome !== "matched") return null;
    const { parser } = selectionResult;
    const result = parser.parse(fromAddress, subject, body, receivedAt, externalMessageId);
    if (!result) return null;
    return { result, selectionResult };
  }
}

/** Singleton */
export const emailParserRegistry = new EmailParserRegistry();
