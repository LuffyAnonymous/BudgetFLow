import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;

// "Salary of AED 5,750.00 has been credited into your account
// 014XXX70XXX01. The available balance is AED 5,750.48." — built against
// one real ENBD salary-credit alert. Requires the literal "Salary of AED"
// phrase — deliberately narrower than a generic "...has been credited"
// match, since ENBD likely uses the same credited-into-your-account
// template for other inflow types (transfers, refunds) this parser has
// no real sample of yet and must not guess at.
const SALARY_CREDIT_RE =
  /Salary\s+of\s+AED\s*([\d,]+\.\d{2})\s+has\s+been\s+credited\s+into\s+your\s+account\s+([\dXx]+)/i;
const AVAILABLE_BALANCE_RE = /available\s+balance\s+is\s+AED\s*([\d,]+\.\d{2})/i;

/**
 * Emirates NBD salary-credit alert email. The first INFLOW-direction email
 * format supported — every parser before this one only handled outgoing
 * transactions (transfers, purchases, withdrawals). No separate
 * transaction-date field exists in this format (a real-time "this just
 * happened" alert), so the Gmail-reported receivedAt is used directly as
 * transactionDate, same as mashreq.parser.ts's debit alert.
 */
export class EmiratesNbdSalaryCreditEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-salary-credit-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return SALARY_CREDIT_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const match = SALARY_CREDIT_RE.exec(body);
    if (!match) return null;

    const [, amountStr, accountRaw] = match;
    const amount = new Decimal(amountStr.replace(/,/g, ""));

    const accountDigits = accountRaw.replace(/x/gi, "");
    const accountEnding = accountDigits.length >= 4 ? accountDigits.slice(-4) : null;

    const availableMatch = AVAILABLE_BALANCE_RE.exec(body);
    const availableBalance = availableMatch ? new Decimal(availableMatch[1].replace(/,/g, "")) : null;

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
      merchant: "Salary",
      reference: null,
      transactionDate: receivedAt,
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

export const emiratesNbdSalaryCreditEmailParser = new EmiratesNbdSalaryCreditEmailParser();
