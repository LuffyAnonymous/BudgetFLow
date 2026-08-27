import { Decimal } from "decimal.js";
import { AccountType } from "@prisma/client";
import {
  ISmsParser,
  NormalizedSmsTransaction,
  ParseError,
} from "./sms-parser.interface";
import { redactFinancialText, maskSender, sha256 } from "../engine/redaction";
import { resolveInstitution } from "../engine/sender-normalizer";
import { isOtpMessage, isPromoMessage } from "./otp-promo-filter";

const AMOUNT_RE = /(?:AED|USD|Dhs)\s*([\d,]+(?:\.\d{1,2})?)/i;
const BNPL_ACCOUNT_TYPES = new Set<AccountType>([AccountType.TABBY, AccountType.TAMARA]);

/**
 * Tabby / Tamara notifications — completed-charge wording ("AED X charged
 * for your order") differs from a bank debit notice, and an "installment
 * due" reminder is a future payment, not a completed transaction: it's
 * deliberately left with no OUTFLOW/INFLOW keyword match so
 * direction-classifier.ts's existing INFORMATIONAL fallback keeps it out
 * of the ledger, exactly as intended, with no special-casing needed here.
 */
export class BnplParser implements ISmsParser {
  readonly parserKey = "bnpl-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "BNPL";

  canParse(sender: string, message: string): boolean {
    if (isOtpMessage(message) || isPromoMessage(message)) return false;
    const { accountType } = resolveInstitution(sender);
    if (!BNPL_ACCOUNT_TYPES.has(accountType)) return false;
    return AMOUNT_RE.test(message);
  }

  parse(sender: string, message: string, receivedAt: Date): NormalizedSmsTransaction {
    const redactedMessage = redactFinancialText(message);
    const payloadHash = sha256(message);
    const maskedSenderValue = maskSender(sender);
    const resolvedInstitution = resolveInstitution(sender);

    if (isOtpMessage(message)) {
      throw new ParseError(this.parserKey, "OTP message cannot be parsed as a financial transaction");
    }
    if (isPromoMessage(message)) {
      throw new ParseError(this.parserKey, "Promo message cannot be parsed as a financial transaction");
    }

    const amountMatch = AMOUNT_RE.exec(message);
    if (!amountMatch) {
      throw new ParseError(this.parserKey, "Failed to extract transaction amount");
    }
    const amount = new Decimal(amountMatch[1].replace(/,/g, ""));

    const refMatch = /\b(?:Ref|Reference|Order)\b\s*(?:no\.?|#|:)?\s*([A-Z0-9-]+)/i.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    return {
      source: "SMS",
      institution: resolvedInstitution.displayName,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      amount,
      currency: "AED",
      merchant: resolvedInstitution.displayName,
      reference,
      transactionDate: receivedAt,
      redactedMessage,
      payloadHash,
      availableBalance: null,
      accountEnding: null,
      isDeclined: false,
      metadata: { maskedSender: maskedSenderValue },
    };
  }
}

export const bnplParser = new BnplParser();
