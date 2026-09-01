import { Decimal } from "decimal.js";
import { AccountType } from "@prisma/client";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;
const DUBAI_OFFSET_HOURS = 4;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// Built against one real "ATM withdrawal" confirmation email — a bilingual
// (English + Arabic) template. The Arabic section repeats each field under
// different (Arabic) labels, so English-only label regexes below never
// accidentally match the Arabic duplicate.
const WITHDRAWAL_MARKER_RE = /ATM\s+withdrawal\s+transaction\s+was\s+successfully\s+completed/i;
const DATE_RE = /on\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-zA-Z]*\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const AMOUNT_RE = /\bAmount:\s*AED\s*([\d,]+\.\d{2})/i;
const AVAILABLE_BALANCE_RE = /Available\s+balance:\s*AED\s*([\d,]+\.\d{2})/i;
const CARD_NUMBER_RE = /Card\s+number:\s*([\dXx]+)/i;
const MACHINE_LOCATION_RE = /Machine\s+location:\s*(.+)/i;
const MACHINE_ID_RE = /Machine\s+ID:\s*(\S+)/i;
const REFERENCE_RE = /Reference\s+number:\s*(\S+)/i;

/**
 * Parses "28th Aug 2026 at 16:57 PM" — Dubai-local (confirmed: same
 * convention as every other ENBD/Mashreq email so far). Converted to its
 * true UTC instant here so the shared engine's own +4h re-application
 * lands on the correct calendar day — see emirates-nbd.parser.ts for the
 * identical concern. The `% 12` step also harmlessly absorbs this
 * template's own quirk of pairing a 24-hour value ("16") with a redundant
 * "PM" suffix — (16 % 12) + 12 still recovers 16.
 */
function parseDubaiLocalTimestamp(raw: string): Date | null {
  const m = DATE_RE.exec(raw);
  if (!m) return null;
  const [, dayStr, monStr, yearStr, hourStr, minStr, meridiem] = m;
  const monthKey = monStr.charAt(0).toUpperCase() + monStr.slice(1).toLowerCase();
  const monthIndex = MONTHS[monthKey];
  if (monthIndex === undefined) return null;

  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;

  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  const minute = parseInt(minStr, 10);

  return new Date(Date.UTC(year, monthIndex, day, hour, minute) - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Emirates NBD "ATM withdrawal" confirmation email — a distinct format
 * from emirates-nbd.parser.ts's "Local Bank Transfer" confirmation (this
 * one has no "Debit Amount:"/"Beneficiary" fields at all, so the two never
 * collide on canParse).
 */
export class EmiratesNbdAtmWithdrawalEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-atm-withdrawal-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return WITHDRAWAL_MARKER_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    _receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const amountMatch = AMOUNT_RE.exec(body);
    if (!amountMatch) return null;
    const amount = new Decimal(amountMatch[1].replace(/,/g, ""));

    const transactionDate = parseDubaiLocalTimestamp(body);
    if (!transactionDate) return null;

    const availableMatch = AVAILABLE_BALANCE_RE.exec(body);
    const availableBalance = availableMatch ? new Decimal(availableMatch[1].replace(/,/g, "")) : null;

    const cardMatch = CARD_NUMBER_RE.exec(body);
    const cardDigits = cardMatch ? cardMatch[1].replace(/x/gi, "") : "";
    const accountEnding = cardDigits.length >= 4 ? cardDigits.slice(-4) : null;

    const locationMatch = MACHINE_LOCATION_RE.exec(body);
    const machineId = MACHINE_ID_RE.exec(body)?.[1] ?? null;
    const reference = REFERENCE_RE.exec(body)?.[1] ?? null;
    const merchant = locationMatch ? `ATM Withdrawal - ${locationMatch[1].trim()}` : "ATM Withdrawal";

    const redactedMessage = redactFinancialEmailText(body);
    const payloadHash = sha256(body);
    const maskedSenderValue = maskEmailSender(fromAddress);

    return {
      source: "EMAIL",
      institution: this.institution,
      institutionCode: this.institutionCode,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      amount,
      currency: "AED",
      direction: TransactionDirection.OUTFLOW,
      isCreditCard: false,
      merchant,
      reference,
      transactionDate,
      redactedMessage,
      payloadHash,
      availableBalance,
      accountEnding,
      isDeclined: false,
      externalMessageId,
      metadata: {
        maskedSender: maskedSenderValue,
        hasAvailableBalance: availableBalance !== null,
        isDeclined: false,
        machineId,
      },
      // The withdrawn cash didn't disappear — it's now physically in the
      // user's hand. Unlike a bank-to-bank transfer, there's no ambiguity
      // to wait on: this one message is the complete, certain fact.
      impliedToAccount: { type: AccountType.CASH, name: "Cash" },
    };
  }
}

export const emiratesNbdAtmWithdrawalEmailParser = new EmiratesNbdAtmWithdrawalEmailParser();
