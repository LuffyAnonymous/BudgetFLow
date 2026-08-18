/**
 * src/imports/sms/parser-registry.ts
 *
 * Selects the correct ISmsParser for a given (sender, message, receivedAt) tuple.
 *
 * Selection criteria:
 *   1. The sender must appear in the user's configured senderAllowlist (supplied by caller).
 *   2. The parser's canParse(sender, message) must return true.
 *   3. If zero parsers match → REJECTED (unknown message).
 *   4. If multiple parsers match → REVIEW_REQUIRED (ambiguous — do not auto-create).
 *
 * Adding new bank parsers:
 *   - Implement ISmsParser
 *   - Add an instance to REGISTERED_PARSERS below
 *   - No other changes required
 */

import type { ISmsParser, NormalizedSmsTransaction } from "./sms-parser.interface";
import { emiratesNBDParser } from "./emirates-nbd.parser";
import { bnplParser } from "./bnpl.parser";
import { genericBankCreditDebitParser } from "./generic-bank-credit-debit.parser";

// ─── Registry of all available parsers ──────────────────────────────────────
// Order doesn't affect correctness (each parser's canParse() is mutually
// exclusive by sender — see the exclusion sets in bnpl.parser.ts and
// generic-bank-credit-debit.parser.ts), but the more specific parsers are
// listed first for readability.

const REGISTERED_PARSERS: ISmsParser[] = [
  emiratesNBDParser,
  bnplParser,
  genericBankCreditDebitParser,
];

// ─── Parser selection result ─────────────────────────────────────────────────

export type ParserSelectionResult =
  | { outcome: "matched"; parser: ISmsParser }
  | { outcome: "no_match"; reason: string }
  | { outcome: "ambiguous"; matchedParsers: string[] };

// ─── Aliases Mapping ─────────────────────────────────────────────────────────

const SENDER_ALIASES: Record<string, string> = {
  EMIRATESNBD: "ENBD",
  EMIRATES: "ENBD",
  ENBD: "ENBD",
};

export function getCanonicalSender(rawSender: string): string {
  const clean = rawSender.trim().toUpperCase().replace(/[\s-]/g, "");
  return SENDER_ALIASES[clean] || clean;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class SmsParserRegistry {
  /**
   * Selects the parser for the given SMS.
   *
   * @param sender          Raw sender string from the device
   * @param message         Raw SMS body
   * @param senderAllowlist User-configured trusted sender strings
   */
  select(
    sender: string,
    message: string,
    senderAllowlist: string[]
  ): ParserSelectionResult {
    // ── 1. Sender allowlist check ─────────────────────────────────────────
    const incomingCanonical = getCanonicalSender(sender);
    const normalizedAllowlist = senderAllowlist.map((allowed) => getCanonicalSender(allowed));
    const senderTrusted =
      senderAllowlist.length === 0
        ? false
        : senderAllowlist.some((allowed) => {
            const allowedCanonical = getCanonicalSender(allowed);
            return (
              incomingCanonical === allowedCanonical ||
              incomingCanonical.includes(allowedCanonical) ||
              allowedCanonical.includes(incomingCanonical)
            );
          });

    console.log(`[sms-webhook] Sender check:`, {
      incomingSender: sender,
      normalizedSender: incomingCanonical,
      configuredAllowlist: senderAllowlist,
      normalizedAllowlist: normalizedAllowlist,
      finalComparisonResult: senderTrusted,
    });

    if (!senderTrusted) {
      return {
        outcome: "no_match",
        reason: "Sender not in configured allowlist",
      };
    }

    // ── 2. Find parsers that accept this message ──────────────────────────
    const candidates = REGISTERED_PARSERS.filter((p) => p.canParse(sender, message));

    if (candidates.length === 0) {
      return {
        outcome: "no_match",
        reason: "No parser recognised this message format",
      };
    }

    if (candidates.length > 1) {
      return {
        outcome: "ambiguous",
        matchedParsers: candidates.map((p) => p.parserKey),
      };
    }

    return { outcome: "matched", parser: candidates[0] };
  }

  /**
   * Convenience: select and immediately parse.
   * Returns null if no parser matches or ambiguous.
   * Throws ParseError if parsing fails (parser.canParse was true but parse failed).
   */
  parse(
    sender: string,
    message: string,
    receivedAt: Date,
    senderAllowlist: string[]
  ): { result: NormalizedSmsTransaction; selectionResult: Extract<ParserSelectionResult, { outcome: "matched" }> } | null {
    const selectionResult = this.select(sender, message, senderAllowlist);
    if (selectionResult.outcome !== "matched") return null;
    const { parser } = selectionResult;
    const result = parser.parse(sender, message, receivedAt);
    return { result, selectionResult };
  }
}

/** Singleton */
export const smsParserRegistry = new SmsParserRegistry();
