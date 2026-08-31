import { Decimal } from "decimal.js";
import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";
import { redactFinancialEmailText, maskEmailSender, sha256 } from "../../engine/redaction";
import { TransactionDirection } from "../../engine/direction-classifier";

const SENDER_DOMAIN_RE = /mashreq(?:bank)?\.com/i;

// "Your AC No:XXXXXXXX9523 is debited with AED 200.00 for Aani Instant
// Payments (Local IPP Transfer). Login to Online Banking for details" —
// built against one real "Transaction Notification" alert from
// MashreqAlerts@mashreq.com. Deliberately requires the literal "is debited
// with AED" phrase — a "credited" version of this alert may exist but no
// real sample of one has been supplied, so this parser does not guess at
// it (falls through to "recognized sender, no matching format yet").
const DEBIT_ALERT_RE =
  /AC\s*No\s*:?\s*[X\d]*?(\d{4})\s+is\s+debited\s+with\s+AED\s*([\d,]+\.\d{2})\s+for\s+(.+?)\.\s*Login\s+to/i;

/**
 * Mashreq "Transaction Notification" debit alert email
 * (from MashreqAlerts@mashreq.com). This is a distinct, simpler format
 * from Mashreq's other "Local AED Transfer request via Mobile Banking"
 * confirmation email (MashreqDigital@mashreq.com) — that richer format
 * is not yet supported (no raw sample obtained for it), so this parser
 * only claims this specific alert wording.
 *
 * Unlike the ENBD parser, this format has no separate transaction-date
 * field in the body — the alert is a real-time "this just happened"
 * push, so the Gmail-reported receivedAt (already a true UTC instant) is
 * used directly as transactionDate, with no Dubai-offset conversion
 * needed.
 */
export class MashreqEmailParser implements IEmailParser {
  readonly parserKey = "mashreq-debit-alert-email-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Mashreq";
  private readonly institutionCode = "MASHREQ";

  canParse(fromAddress: string, _subject: string, body: string): boolean {
    if (!SENDER_DOMAIN_RE.test(fromAddress)) return false;
    return DEBIT_ALERT_RE.test(body);
  }

  parse(
    fromAddress: string,
    _subject: string,
    body: string,
    receivedAt: Date,
    externalMessageId: string
  ): NormalizedEmailTransaction | null {
    const match = DEBIT_ALERT_RE.exec(body);
    if (!match) return null;

    const [, accountEnding, amountStr, description] = match;
    const amount = new Decimal(amountStr.replace(/,/g, ""));
    const merchant = description.trim() || null;

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
      transactionDate: receivedAt,
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
      },
    };
  }
}

export const mashreqEmailParser = new MashreqEmailParser();
