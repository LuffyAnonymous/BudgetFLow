/**
 * src/imports/engine/duplicate-detector.ts
 *
 * Fingerprinting and duplicate detection for the import engine.
 *
 * Two-layer protection:
 *   1. Idempotency key (Idempotency-Key request header) — protects request retries.
 *   2. Financial fingerprint — protects the same SMS submitted under a new request key.
 *
 * Fingerprint construction (per correction #14):
 *   When reference is present:
 *     SHA-256( institution + "|" + normalizedRef + "|" + amount.toFixed(2) + "|" + currency )
 *   When no reference:
 *     SHA-256( institution + "|" + maskedSender + "|" + amount.toFixed(2) + "|" + currency + "|" + financialDate )
 *
 * Normalization applied before hashing:
 *   - institution:   trim, lowercase
 *   - reference:     trim, uppercase
 *   - amount:        Decimal.toFixed(2)
 *   - currency:      trim, uppercase
 *   - financialDate: YYYY-MM-DD in Dubai timezone
 *   - maskedSender:  trim, uppercase
 */

import { sha256 } from "./redaction";
import type { Decimal } from "decimal.js";

const DUBAI_OFFSET_HOURS = 4;

/**
 * The subset of fields the fingerprint algorithm actually reads — shared
 * structurally by NormalizedSmsTransaction and NormalizedEmailTransaction
 * rather than typed against one or the other, so the same transaction
 * arriving via a different channel (e.g. SMS and email for the same bank)
 * naturally dedupes against the same fingerprint.
 */
export interface FingerprintableTransaction {
  institution: string;
  amount: Decimal;
  currency: string;
  reference: string | null;
  transactionDate: Date;
  merchant: string | null;
}

/**
 * Convert a Date to a Dubai-local YYYY-MM-DD string without external dependencies.
 */
function toDubaiDateString(date: Date): string {
  const dubaiMs = date.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000;
  const d = new Date(dubaiMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Build a deterministic fingerprint for a normalized transaction.
 * Uses reference when available (stronger), falls back to date-based identity.
 */
export function buildFingerprint(
  normalized: FingerprintableTransaction,
  maskedSender: string
): string {
  const institution = normalized.institution.trim().toLowerCase();
  const amount = normalized.amount.toFixed(2);
  const currency = normalized.currency.trim().toUpperCase();

  if (normalized.reference) {
    const ref = normalized.reference.trim().toUpperCase();
    return sha256(`${institution}|${ref}|${amount}|${currency}`);
  }

  // Fallback: use Dubai financial calendar date
  const financialDate = toDubaiDateString(normalized.transactionDate);
  const sender = maskedSender.trim().toUpperCase();
  const desc = (normalized.merchant ?? "").trim().toLowerCase();
  return sha256(`${institution}|${sender}|${amount}|${currency}|${financialDate}|${desc}`);
}

/**
 * Result of a duplicate check.
 */
export type DuplicateCheckResult =
  | { isDuplicate: false }
  | { isDuplicate: true; existingId: string; duplicateCount: number };
