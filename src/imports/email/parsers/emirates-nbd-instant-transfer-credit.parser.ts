import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;

// "AED 200.00 has been credited to your account 014XXX70XXX01 towards
// instant transfer. The available balance is AED 200.93." — built against
// one real ENBD instant-transfer-in alert. Deliberately distinct wording
// from emirates-nbd-salary-credit.parser.ts's "...credited INTO your
// account" (requiring the literal "Salary of AED" prefix) — this format
// says "credited TO your account...towards instant transfer" and never
// mentions salary, so the two never collide on canParse.
const INSTANT_TRANSFER_CREDIT_RE =
  /AED\s*([\d,]+\.\d{2})\s+has\s+been\s+credited\s+to\s+your\s+account\s+([\dXx]+)\s+towards\s+instant\s+transfer\.\s*The\s+available\s+balance\s+is\s+AED\s*([\d,]+\.\d{2})/i;

/**
 * Emirates NBD "instant transfer" inflow alert — the receiving side of an
 * inter-bank instant transfer (e.g. money arriving from Mashreq). Distinct
 * from emirates-nbd-salary-credit.parser.ts (requires "Salary of AED") and
 * emirates-nbd-account-deduction.parser.ts (OUTFLOW, "deducted from"). No
 * separate transaction-date field in this format (a real-time "this just
 * happened" alert), so the Gmail-reported receivedAt is used directly as
 * transactionDate, same as the other real-time ENBD alert formats.
 *
 * Deliberately does NOT set impliedToAccount — unlike an ATM withdrawal,
 * this message only tells us money arrived here, not which account it left
 * from. Pairing this inflow with its actual source-account outflow leg is
 * reconcile-transfers.service.ts's job (Phase 2), not a guess made here.
 */
export class EmiratesNbdInstantTransferCreditEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-instant-transfer-credit-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return INSTANT_TRANSFER_CREDIT_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const match = INSTANT_TRANSFER_CREDIT_RE.exec(body);
    if (!match) return null;

    const [, amountStr, accountRaw, availableBalanceStr] = match;
    const amount = new Decimal(amountStr.replace(/,/g, ""));
    const availableBalance = new Decimal(availableBalanceStr.replace(/,/g, ""));

    const accountDigits = accountRaw.replace(/x/gi, "");
    const accountEnding = accountDigits.length >= 4 ? accountDigits.slice(-4) : null;

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
      merchant: "Instant Transfer",
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
        hasAvailableBalance: true,
        isDeclined: false,
      },
    };
  }
}

export const emiratesNbdInstantTransferCreditEmailParser = new EmiratesNbdInstantTransferCreditEmailParser();
