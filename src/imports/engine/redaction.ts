/**
 * src/imports/engine/redaction.ts
 *
 * Centralized financial-text redaction utility.
 *
 * Handles:
 *   - Account numbers following "account no." patterns
 *   - Partially pre-masked account identifiers (already contain X)
 *   - Card-number-like sequences (16-digit groups)
 *   - Long numeric sequences adjacent to known account labels
 *
 * IMPORTANT: This module makes no guarantee that *no* digit ever appears
 * consecutively in stored text — valid transaction references (e.g. EPHCOP1810A4BEZH)
 * may contain numeric substrings. The guarantee is that account number identifiers
 * (those following "account no." labels or matching card patterns) are safely masked.
 *
 * Masking format: keeps first 3 and last 2 chars, replaces middle with XXX.
 * e.g. 014557001234501 → 014XXX01
 *      014XXX70XXX01   → retained as-is (already masked)
 */

/**
 * Mask a single account-number string.
 * Keeps first 3 and last 2 characters, replaces middle with "XXX".
 * If the string is already masked (contains X), returns it as-is.
 */
export function maskAccountNumber(raw: string): string {
  // Already masked — do not re-process
  if (/X/i.test(raw)) return raw.replace(/x/g, "X");

  const digits = raw.replace(/\s/g, "");
  if (digits.length <= 5) return digits; // too short to meaningfully mask
  const first = digits.slice(0, 3);
  const last = digits.slice(-2);
  return `${first}XXX${last}`;
}

/**
 * Redact account numbers that appear after "account no." in financial text.
 * The account token is the continuous alphanumeric string immediately after
 * "account no." (possibly including dashes, as seen in ENBD messages).
 */
export function redactAccountNumbers(text: string): string {
  return text.replace(
    /\baccount\s+no\.\s+([\dXx][-\dXx]*[\dXx])/gi,
    (_match, acct: string) => `account no. ${maskAccountNumber(acct)}`
  );
}

/**
 * Redact card-number-like patterns (4 groups of 4 digits separated by spaces or dashes).
 */
export function redactCardNumbers(text: string): string {
  return text.replace(
    /\b(\d{4})[\s-](\d{4})[\s-](\d{4})[\s-](\d{4})\b/g,
    (_m, a: string) => `${a} XXXX XXXX XXXX`
  );
}

/**
 * Redact account/IBAN-style identifiers after the broader label set banking
 * confirmation emails use — SMS is terse ("account no."), but email
 * confirmations spell these out verbosely (e.g. "Beneficiary Account /
 * IBAN:", "From Account:", "CIF:") and IBAN values are alphanumeric, not
 * pure digits, so this widens the value pattern beyond redactAccountNumbers.
 */
export function redactEmailAccountFields(text: string): string {
  return text.replace(
    /\b(account\s+no\.?|beneficiary\s+account(?:\s*\/\s*iban)?|from\s+account|to\s+account|iban|cif)(\s*:?\s+)([A-Za-z\dXx][-A-Za-z\dXx]*[A-Za-z\dXx])/gi,
    (_m, label: string, sep: string, acct: string) => `${label}${sep}${maskAccountNumber(acct)}`
  );
}

/**
 * Redact a sender string. Retains only the first word or recognizable institution name.
 * Full phone numbers or internal routing codes are stripped.
 */
export function maskSender(sender: string): string {
  // If purely numeric (short code or mobile number), return generic mask
  if (/^\+?\d[\d\s-]{4,}$/.test(sender.trim())) return "SMS_SENDER";
  // Otherwise, keep only the alphanumeric token (no symbols, no numbers after the name)
  const clean = sender.trim().replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 30);
  return clean || "SMS_SENDER";
}

/**
 * Redact an email "From" address. Unlike an SMS sender code, the domain
 * itself identifies the institution (not a secret) — only the local part
 * (before the @) is masked, so "OnlineBanking@emiratesnbd.com" becomes
 * "OnXXX@emiratesnbd.com" rather than disappearing into a generic label.
 */
export function maskEmailSender(fromAddress: string): string {
  const trimmed = fromAddress.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return "EMAIL_SENDER";
  }
  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const maskedLocal = localPart.length <= 2 ? localPart : `${localPart.slice(0, 2)}XXX`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Primary entry point: apply all financial-text redaction rules to an SMS body.
 * Returns the redacted text safe to store as redactedPayload.
 */
export function redactFinancialText(text: string): string {
  let result = text;
  result = redactAccountNumbers(result);
  result = redactCardNumbers(result);
  return result;
}

/**
 * Entry point for email bodies — same card-number redaction as SMS, plus
 * the broader account/IBAN label set (see redactEmailAccountFields) that
 * email confirmations use but terse SMS text doesn't.
 */
export function redactFinancialEmailText(text: string): string {
  let result = text;
  result = redactAccountNumbers(result);
  result = redactEmailAccountFields(result);
  result = redactCardNumbers(result);
  return result;
}

/**
 * Compute SHA-256 hash of any string (used for payloadHash and fingerprinting).
 */
import { createHash } from "crypto";
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
