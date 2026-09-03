import { Decimal } from "decimal.js";
import { AccountType } from "@prisma/client";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;
const DUBAI_OFFSET_HOURS = 4;

// Built against one real "cash deposit" confirmation email — a bilingual
// (English + Arabic) template, structurally the mirror image of
// emirates-nbd-atm-withdrawal.parser.ts (same Machine ID/location/
// Reference number fields, opposite direction). Date format here is
// numeric ("03-09-2026"), not the withdrawal template's "28th Aug 2026" —
// a different template, not a shared one.
const DEPOSIT_MARKER_RE = /cash\s+deposit\s+has\s+been\s+successfully\s+processed/i;
const DATE_RE = /on\s+(\d{1,2})-(\d{1,2})-(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const AMOUNT_RE = /\bAmount:\s*AED\s*([\d,]+(?:\.\d{2})?)/i;
const DEPOSITED_TO_RE = /Deposited\s+to:\s*([\dXx]+)/i;
const MACHINE_LOCATION_RE = /Machine\s+location:\s*(.+)/i;
const MACHINE_ID_RE = /Machine\s+ID:\s*(\S+)/i;
const REFERENCE_RE = /Reference\s+number:\s*(\S+)/i;

/**
 * Parses "03-09-2026 at 20:04 PM" — Dubai-local, DD-MM-YYYY. Converted to
 * its true UTC instant so the shared engine's own +4h re-application lands
 * on the correct calendar day (see emirates-nbd.parser.ts). The `% 12`
 * step absorbs this template's same quirk as the ATM withdrawal one:
 * pairing a 24-hour value ("20") with a redundant "PM" suffix — (20 % 12)
 * + 12 still recovers 20.
 */
function parseDubaiLocalTimestamp(raw: string): Date | null {
  const m = DATE_RE.exec(raw);
  if (!m) return null;
  const [, dayStr, monthStr, yearStr, hourStr, minStr, meridiem] = m;

  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;

  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);
  const minute = parseInt(minStr, 10);
  if (month < 0 || month > 11) return null;

  return new Date(Date.UTC(year, month, day, hour, minute) - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Emirates NBD "cash deposit" confirmation email — the mirror image of
 * emirates-nbd-atm-withdrawal.parser.ts: cash the user physically had
 * moves into the bank account, not out of it. No "Available balance"
 * field in this template (confirmed against a real sample), so the ENBD
 * side always applies as a plain increment, never an authoritative
 * overwrite.
 */
export class EmiratesNbdCashDepositEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-cash-deposit-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return DEPOSIT_MARKER_RE.test(body);
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

    const depositedToMatch = DEPOSITED_TO_RE.exec(body);
    const accountDigits = depositedToMatch ? depositedToMatch[1].replace(/x/gi, "") : "";
    const accountEnding = accountDigits.length >= 4 ? accountDigits.slice(-4) : null;

    const locationMatch = MACHINE_LOCATION_RE.exec(body);
    const machineId = MACHINE_ID_RE.exec(body)?.[1] ?? null;
    const reference = REFERENCE_RE.exec(body)?.[1] ?? null;
    const merchant = locationMatch ? `Cash Deposit - ${locationMatch[1].trim()}` : "Cash Deposit";

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
      direction: TransactionDirection.INFLOW,
      isCreditCard: false,
      merchant,
      reference,
      transactionDate,
      redactedMessage,
      payloadHash,
      availableBalance: null,
      accountEnding,
      isDeclined: false,
      externalMessageId,
      metadata: {
        maskedSender: maskedSenderValue,
        hasAvailableBalance: false,
        isDeclined: false,
        machineId,
      },
      // The deposited cash didn't appear from nowhere — it left the user's
      // physical cash on hand. Unlike a bank-to-bank transfer, there's no
      // ambiguity to wait on: this one message is the complete, certain
      // fact, same reasoning as the ATM withdrawal parser's
      // impliedToAccount, just the other direction.
      impliedFromAccount: { type: AccountType.CASH, name: "Cash" },
    };
  }
}

export const emiratesNbdCashDepositEmailParser = new EmiratesNbdCashDepositEmailParser();
