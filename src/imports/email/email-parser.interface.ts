/**
 * src/imports/email/email-parser.interface.ts
 *
 * Core types for the email import pipeline. Mirrors
 * src/imports/sms/sms-parser.interface.ts structurally, with two
 * deliberate differences:
 *   - parse() returns null on failure instead of throwing, so "recognized
 *     sender, no matching format" is distinguishable from "sender not
 *     recognized at all" by the caller (both matter for the failure reason).
 *   - direction and isCreditCard are explicit output fields, not re-derived
 *     from raw text by the shared engine — email bodies are full of
 *     boilerplate (disclaimers, footers) that can trigger false keyword
 *     matches SMS's terser text doesn't risk.
 *
 * Every bank email parser must implement IEmailParser.
 * The rest of the import engine ONLY consumes NormalizedEmailTransaction.
 */

import type { Decimal } from "decimal.js";
import type { AccountType } from "@prisma/client";
import { TransactionDirection } from "../engine/direction-classifier";

/**
 * The normalized transaction produced by any email parser.
 * All fields are derived purely from the email; no BudgetFlow state
 * (user settings, category IDs, etc.) is included here.
 */
export interface NormalizedEmailTransaction {
  /** Always "EMAIL" for this interface */
  readonly source: "EMAIL";
  /** Human-readable institution name, e.g. "Emirates NBD" */
  readonly institution: string;
  /** Stable parser-registry key, e.g. "ENBD" */
  readonly institutionCode: string;
  /** Internal parser identifier, e.g. "emirates-nbd-local-transfer-v1" */
  readonly parserKey: string;
  /** Semver string, e.g. "1.0.0" */
  readonly parserVersion: string;
  /** Positive amount — always positive regardless of direction */
  readonly amount: Decimal;
  /** ISO 4217 currency code, e.g. "AED" */
  readonly currency: string;
  /**
   * Declared by the parser from structured fields (e.g. "Debit Amount"),
   * never re-derived from body text by the shared engine.
   */
  readonly direction: TransactionDirection;
  /**
   * Declared by the parser; never re-derived from body text by the shared
   * engine (unlike SMS's isCreditCardTransaction() text scan).
   */
  readonly isCreditCard: boolean;
  /** Merchant/beneficiary name if detectable, null otherwise */
  readonly merchant: string | null;
  /** Bank reference code, null if not present in the email */
  readonly reference: string | null;
  /**
   * Financial calendar date — the date of the transaction as stated by the
   * bank, converted to its UTC equivalent (the shared engine re-applies a
   * +4h Dubai offset on top of this to compute financialDate, so this must
   * NOT already be Dubai-local — see emirates-nbd.parser.ts for the exact
   * conversion).
   */
  readonly transactionDate: Date;
  /**
   * Redacted email body (account numbers/IBANs already masked).
   * This is what gets stored in ImportedTransaction.redactedPayload.
   */
  readonly redactedMessage: string;
  /** SHA-256 of the original unredacted email body */
  readonly payloadHash: string;
  /** Authoritative available balance if reported in the email, null otherwise */
  readonly availableBalance: Decimal | null;
  /** Last 4 digits of the account/card if available, null otherwise */
  readonly accountEnding: string | null;
  /** Whether the transaction was explicitly declined/failed */
  readonly isDeclined: boolean;
  /** Gmail message ID — dedup guard independent of the content fingerprint */
  readonly externalMessageId: string;
  /** Additional structured data the parser found (no sensitive values) */
  readonly metadata: Record<string, unknown>;
  /**
   * Set only when a single message unambiguously declares BOTH sides of a
   * transfer by itself (e.g. an ATM withdrawal — the money didn't
   * disappear, it became cash in hand) — never for a bank-to-bank
   * transfer, where the real destination is genuinely unknown until
   * either a second confirming message arrives or reconcile-transfers'
   * Phase 2 matching runs. This is NOT the risky "guess which account
   * this probably went to" heuristic the two-phase redesign removed from
   * ingestion — it's a deterministic fact the parser itself is certain of,
   * so resolving it immediately carries none of that risk.
   */
  readonly impliedToAccount?: { type: AccountType; name: string } | null;
}

/**
 * Every bank email parser must implement this interface.
 * A parser is responsible only for converting a decoded email into a
 * NormalizedEmailTransaction. It has no knowledge of database IDs, users,
 * or BudgetFlow categories.
 */
export interface IEmailParser {
  /** Unique identifier matching parserKey in NormalizedEmailTransaction */
  readonly parserKey: string;
  /** Semver version string */
  readonly parserVersion: string;
  /** Institution name produced by this parser */
  readonly institution: string;

  /**
   * Returns true if this parser can handle the given sender + content
   * combination. Must be deterministic and fast (no I/O). Must check for
   * structural markers of the specific email format, not just the sender
   * domain — a bank sends multiple email formats and this parser may only
   * understand one of them.
   *
   * @param fromAddress  Raw "From" header address
   * @param subject      Email subject line
   * @param body         Decoded plain-text body (see gmail-message-decoder.ts)
   */
  canParse(fromAddress: string, subject: string, body: string): boolean;

  /**
   * Parses the email and returns a NormalizedEmailTransaction, or null if
   * canParse() matched but required fields couldn't actually be extracted
   * (never guess — a null here routes to a FAILED record, not a fabricated
   * transaction).
   *
   * @param fromAddress      Raw "From" header address (used for masking)
   * @param subject          Email subject line
   * @param body             Decoded plain-text body
   * @param receivedAt       Server-side receipt timestamp (fallback date)
   * @param externalMessageId Gmail message ID
   */
  parse(
    fromAddress: string,
    subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null;
}
