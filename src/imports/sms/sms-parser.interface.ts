/**
 * src/imports/sms/sms-parser.interface.ts
 *
 * Core types for the SMS import pipeline.
 *
 * Every bank SMS parser must implement ISmsParser.
 * The rest of the import engine ONLY consumes NormalizedSmsTransaction.
 * No module outside src/imports/ should know how SMS parsing works.
 */

import type { Decimal } from "decimal.js";

/**
 * The normalized transaction produced by any SMS parser.
 * All fields are derived purely from the SMS text; no BudgetFlow state
 * (user settings, category IDs, etc.) is included here.
 */
export interface NormalizedSmsTransaction {
  /** Always "SMS" for this interface */
  readonly source: "SMS";
  /** Human-readable institution name, e.g. "Emirates NBD" */
  readonly institution: string;
  /** Internal parser identifier, e.g. "emirates-nbd-salary-v1" */
  readonly parserKey: string;
  /** Semver string, e.g. "1.0.0" */
  readonly parserVersion: string;
  /** Positive amount — always positive regardless of direction */
  readonly amount: Decimal;
  /** ISO 4217 currency code, e.g. "AED" */
  readonly currency: string;
  /** Merchant name if detectable, null otherwise */
  readonly merchant: string | null;
  /** Bank reference code, null if not present in message */
  readonly reference: string | null;
  /**
   * Financial calendar date — the date of the transaction as stated by the bank.
   * Falls back to the receivedAt date from the webhook caller if not parseable.
   */
  readonly transactionDate: Date;
  /**
   * Redacted SMS text (account numbers already masked).
   * This is what gets stored in ImportedTransaction.redactedPayload.
   */
  readonly redactedMessage: string;
  /** SHA-256 of the original unredacted message */
  readonly payloadHash: string;
  /** Authoritative available balance if reported in the SMS, null otherwise */
  readonly availableBalance: Decimal | null;
  /** Last 4 digits of the account/card if available, null otherwise */
  readonly accountEnding: string | null;
  /** Whether the transaction was explicitly declined/failed */
  readonly isDeclined: boolean;
  /** Additional structured data the parser found (no sensitive values) */
  readonly metadata: Record<string, unknown>;
}

/**
 * Every SMS parser must implement this interface.
 * A parser is responsible only for converting a raw SMS string into a
 * NormalizedSmsTransaction. It has no knowledge of database IDs, users,
 * or BudgetFlow categories.
 */
export interface ISmsParser {
  /** Unique identifier matching parserKey in NormalizedSmsTransaction */
  readonly parserKey: string;
  /** Semver version string */
  readonly parserVersion: string;
  /** Institution name produced by this parser */
  readonly institution: string;

  /**
   * Returns true if this parser can handle the given sender + message combination.
   * Must be deterministic and fast (no I/O).
   * Must NOT match on common words like "credited", "salary", or "AED" alone.
   *
   * @param sender   Raw sender string as seen on the device
   * @param message  Raw SMS message body
   */
  canParse(sender: string, message: string): boolean;

  /**
   * Parses the SMS and returns a NormalizedSmsTransaction.
   * Throws ParseError if parsing fails despite canParse() returning true.
   *
   * @param sender      Raw sender string (used for masking)
   * @param message     Raw SMS message body
   * @param receivedAt  Server-side receipt timestamp (fallback date if no date in SMS)
   */
  parse(sender: string, message: string, receivedAt: Date): NormalizedSmsTransaction;
}

/** Thrown by a parser when it cannot extract required fields */
export class ParseError extends Error {
  constructor(
    public readonly parserKey: string,
    public readonly reason: string
  ) {
    super(`[${parserKey}] Parse failed: ${reason}`);
    this.name = "ParseError";
  }
}
