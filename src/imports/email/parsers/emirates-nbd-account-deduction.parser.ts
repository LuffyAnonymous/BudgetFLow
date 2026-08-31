import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /emiratesnbd\.com/i;

// "AED 150.00 has been deducted from your account 014XXX70XXX01 for
// issuance of Telegraphic Transfer. The available balance is AED
// 1,350.48." — built against one real ENBD account-deduction alert. The
// reason phrase ("issuance of Telegraphic Transfer") is captured as a
// variable field within this verified fixed template — not guessed at as
// a separate format; other reasons (fees, charges, etc.) using this same
// "AED X has been deducted...for Y" template are expected to match too,
// since Y is exactly what's captured, not assumed.
const DEDUCTION_RE =
  /AED\s*([\d,]+\.\d{2})\s+has\s+been\s+deducted\s+from\s+your\s+account\s+([\dXx]+)\s+for\s+(.+?)\.\s*The\s+available\s+balance\s+is\s+AED\s*([\d,]+\.\d{2})/i;

/**
 * Emirates NBD generic account-deduction alert email — distinct from
 * emirates-nbd-salary-credit.parser.ts (INFLOW, "credited into") and
 * emirates-nbd.parser.ts's "Local Bank Transfer" confirmation (has its
 * own "Debit Amount:"/"Beneficiary" fields this format lacks entirely).
 * No separate transaction-date field in this format (a real-time "this
 * just happened" alert), so the Gmail-reported receivedAt is used
 * directly as transactionDate, same as the salary-credit parser.
 */
export class EmiratesNbdAccountDeductionEmailParser implements IEmailParser {
  readonly parserKey = "emirates-nbd-account-deduction-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";
  private readonly institutionCode = "ENBD";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return DEDUCTION_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const match = DEDUCTION_RE.exec(body);
    if (!match) return null;

    const [, amountStr, accountRaw, reason, availableBalanceStr] = match;
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
      direction: TransactionDirection.OUTFLOW,
      isCreditCard: false,
      merchant: reason.trim() || null,
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

export const emiratesNbdAccountDeductionEmailParser = new EmiratesNbdAccountDeductionEmailParser();
