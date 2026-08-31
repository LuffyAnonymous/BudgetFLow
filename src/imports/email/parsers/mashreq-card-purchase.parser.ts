import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /mashreq(?:bank)?\.com/i;
const DUBAI_OFFSET_HOURS = 4;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// "...was used for a purchase of AED 60.00 at e& Digital App Abu Dhabi AE on
// 31-AUG-2026 05:49 PM. Available limit is AED 44.00" — built against one
// real "Mashreq Card" purchase-alert email. Requires the literal "was used
// for a purchase of AED" phrase — distinct wording from this parser's
// sibling mashreq.parser.ts (the "is debited with AED" bank-transfer
// alert), so the two never collide.
const PURCHASE_ALERT_RE =
  /Card\s+ending\s+with\s+(\d{4})\s+was\s+used\s+for\s+a\s+purchase\s+of\s+AED\s*([\d,]+\.\d{2})\s+at\s+(.+?)\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i;
const AVAILABLE_LIMIT_RE = /Available\s+limit\s+is\s+AED\s*([\d,]+\.\d{2})/i;

/**
 * Parses "31-AUG-2026 05:49 PM" — the bank reports this in Dubai-local
 * time (confirmed: it matches the email's own Gmail receipt time when
 * displayed in Asia/Dubai). Converted to its true UTC instant here so the
 * shared engine's own +4h re-application lands on the correct calendar
 * day — see emirates-nbd.parser.ts for the identical concern.
 */
function parseDubaiLocalTimestamp(raw: string): Date | null {
  const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(raw);
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
 * Mashreq debit-card purchase alert email (from MashreqAlerts@mashreq.com).
 * A third, distinct Mashreq email format alongside mashreq.parser.ts's
 * bank-transfer alert and the unsupported "Local AED Transfer request via
 * Mobile Banking" confirmation — a bank sends multiple real formats and
 * each one gets its own parser, never a guessed catch-all.
 */
export class MashreqCardPurchaseEmailParser implements IEmailParser {
  readonly parserKey = "mashreq-card-purchase-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Mashreq";
  private readonly institutionCode = "MASHREQ";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return PURCHASE_ALERT_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    _receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const match = PURCHASE_ALERT_RE.exec(body);
    if (!match) return null;

    const [, accountEnding, amountStr, merchantRaw, dateStr] = match;
    const transactionDate = parseDubaiLocalTimestamp(dateStr);
    if (!transactionDate) return null;

    const amount = new Decimal(amountStr.replace(/,/g, ""));
    const merchant = merchantRaw.trim() || null;

    const limitMatch = AVAILABLE_LIMIT_RE.exec(body);
    const availableBalance = limitMatch ? new Decimal(limitMatch[1].replace(/,/g, "")) : null;

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
      reference: null,
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
      },
    };
  }
}

export const mashreqCardPurchaseEmailParser = new MashreqCardPurchaseEmailParser();
