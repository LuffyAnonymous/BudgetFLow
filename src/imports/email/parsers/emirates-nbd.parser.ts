import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;
const DUBAI_OFFSET_HOURS = 4;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parses "Transaction Date: 29/Aug/2026 09:22 AM" — the bank reports this
 * in Dubai-local time. The shared engine (import.service.ts) re-applies a
 * +4h Dubai offset on top of `transactionDate` to compute financialDate,
 * assuming that field is UTC (true for SMS's device-supplied receivedAt).
 * So this converts the Dubai-local reading to its true UTC instant
 * (subtract 4h) here — otherwise the +4h gets double-applied and a
 * transaction near midnight lands on the wrong calendar day.
 */
function parseDubaiLocalTimestamp(raw: string): Date | null {
  const m = /(\d{1,2})\/([A-Za-z]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(raw);
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

function extractAccountEnding(body: string): string | null {
  const match = /From\s+Account:\s*([A-Za-z0-9X*]+)/i.exec(body);
  if (!match) return null;
  const raw = match[1].replace(/[X*]/gi, "").trim();
  return raw.length >= 4 ? raw.slice(-4) : null;
}

/**
 * Emirates NBD "Local Bank Transfer" confirmation email
 * (from OnlineBanking@emiratesnbd.com). Built against one real sample —
 * ENBD sends other email formats (POS purchases, salary credits, etc.)
 * this parser deliberately does NOT recognize; those fall through to
 * "recognized sender, no matching format yet" rather than being
 * mis-parsed by a format this parser wasn't built for.
 */
export class EmiratesNbdEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-local-transfer-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    const hasFormatMarker = /local\s+bank\s+transfer/i.test(subject) || /local\s+bank\s+transfer/i.test(body);
    const hasDebitAmount = /debit\s+amount\s*:/i.test(body);
    return hasFormatMarker && hasDebitAmount;
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    // Only a confirmed-successful transfer is safe to post — anything else
    // (pending, failed) returns null rather than guessing at semantics
    // this parser wasn't built to handle.
    const statusMatch = /Status:\s*(\S+)/i.exec(body);
    if (!statusMatch || statusMatch[1].toLowerCase() !== "success") return null;

    const amountMatch = /Debit\s+Amount:\s*AED\s*([\d,]+\.\d{2})/i.exec(body);
    if (!amountMatch) return null;
    const amount = new Decimal(amountMatch[1].replace(/,/g, ""));

    const dateMatch = /Transaction\s+Date:\s*(\d{1,2}\/[A-Za-z]{3}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i.exec(body);
    const transactionDate = dateMatch ? parseDubaiLocalTimestamp(dateMatch[1]) : null;
    if (!transactionDate) return null;

    const channelRefMatch = /Channel\s+Reference\s+No:\s*(\S+)/i.exec(body);
    const swiftRefMatch = /SWIFT\s+Reference\s+No:\s*(\S+)/i.exec(body);
    const reference = channelRefMatch?.[1] ?? swiftRefMatch?.[1] ?? null;

    // Prefer the beneficiary *bank* name for the description/merchant field
    // when present — it's what categorizeMerchant()'s keyword list matches
    // against to auto-tag this as a Transfer, the same way the SMS parsers'
    // TRANSFER_TO_RE capture feeds a bank/beneficiary name for the same
    // purpose. Falls back to the beneficiary's own name otherwise.
    const beneficiaryBankMatch = /Beneficiary\s+Bank\s+Name:\s*(.+)/i.exec(body);
    const beneficiaryNameMatch = /Beneficiary\s+Name:\s*(.+)/i.exec(body);
    const merchant = (beneficiaryBankMatch?.[1] ?? beneficiaryNameMatch?.[1] ?? "").trim() || null;

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
      availableBalance: null,
      accountEnding: extractAccountEnding(body),
      isDeclined: false,
      externalMessageId,
      metadata: {
        maskedSender: maskedSenderValue,
        hasAvailableBalance: false,
        isDeclined: false,
      },
    };
  }
}

export const emiratesNbdEmailParser = new EmiratesNbdEmailParser();
