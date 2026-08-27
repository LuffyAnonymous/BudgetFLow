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

// Senders with their own dedicated (more accurate) parser are excluded here
// so the two parsers never both claim the same message (parser-registry.ts
// treats that as "ambiguous" and rejects it).
const HANDLED_BY_DEDICATED_PARSER = new Set<AccountType>([
  AccountType.EMIRATES_NBD,
  AccountType.TABBY,
  AccountType.TAMARA,
]);

// Same extraction patterns as the Emirates NBD parser, generalized: most
// UAE bank SMS notifications share this vocabulary regardless of issuer.
const AVAILABLE_BALANCE_RE = /(?:available\s+balance|bal|balance)\s+(?:is\s+)?(?:AED\s*)?([\d,]+(?:\.\d{1,2})?)/i;
// Merchant fields are frequently followed by ", <phone>, <city>" — a comma is
// a hard stop so we capture just the merchant name, not the trailing detail.
const MERCHANT_AT_RE = /at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+on|\.|,|\s+Ref|Ref\b|\s+for|$)/i;
const MERCHANT_USED_AT_RE = /used\s+at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+for|\.|,|\s+Ref|Ref\b|$)/i;
const TRANSFER_TO_FROM_RE = /transfer\s+(?:of\s+(?:AED|USD)\s*[\d,.]+\s+)?(?:to|from)\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+(?:account|a\/c|card)|\.|,|\s+Ref|Ref\b|$)/i;
const RECEIVED_FROM_RE = /received\s+(?:from\s+)?([A-Za-z0-9\s&_*.-]+?)(?:\s+on|\.|,|\s+Ref|Ref\b|$)/i;

const AMOUNT_RE = /(?:AED|USD|Dhs)\s*([\d,]+(?:\.\d{1,2})?)/i;
const DIRECTION_KEYWORDS_RE = /credited|debited|received|deposited|withdrawn|purchase|payment\s+of|used\s+for|transaction\s+of|charged|spent|sent/i;
const DECLINED_RE = /declined|insufficient\s*funds|insufficient\s*limit|unsuccessful|failed/i;

function extractAccountEnding(message: string): string | null {
  const match = /(?:account|card|a\/c|acct)\s+(?:no\.?\s*|ending\s+)?([A-Za-z0-9X-]+)/i.exec(message);
  if (match) {
    const raw = match[1].trim();
    return raw.length > 4 ? raw.slice(-4) : raw;
  }
  const matchEnding = /ending\s+([A-Za-z0-9X-]+)/i.exec(message);
  if (matchEnding) {
    const raw = matchEnding[1].trim();
    return raw.length > 4 ? raw.slice(-4) : raw;
  }
  return null;
}

/**
 * Bank-agnostic fallback for any allowlisted sender not matched by a
 * bank-specific parser (e.g. Emirates NBD's). Deliberately broad — this is
 * safe because parser-registry.ts only ever runs canParse() against senders
 * the user has already trusted via their own configured allowlist.
 */
export class GenericBankCreditDebitParser implements ISmsParser {
  readonly parserKey = "generic-bank-credit-debit-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Bank";

  canParse(sender: string, message: string): boolean {
    if (isOtpMessage(message) || isPromoMessage(message)) return false;
    if (HANDLED_BY_DEDICATED_PARSER.has(resolveInstitution(sender).accountType)) return false;
    return AMOUNT_RE.test(message) && DIRECTION_KEYWORDS_RE.test(message);
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

    const isDeclined = DECLINED_RE.test(message);

    const balMatch = AVAILABLE_BALANCE_RE.exec(message);
    const availableBalance = balMatch ? new Decimal(balMatch[1].replace(/,/g, "")) : null;

    const amountMatches = [...message.matchAll(/(?:AED|USD|Dhs)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
    let amount = new Decimal(0);
    if (amountMatches.length > 0) {
      amount = new Decimal(amountMatches[0][1].replace(/,/g, ""));
    } else {
      throw new ParseError(this.parserKey, "Failed to extract transaction amount");
    }

    const accountEnding = extractAccountEnding(message);

    let merchant: string | null = null;
    const atMatch = MERCHANT_AT_RE.exec(message);
    const usedAtMatch = MERCHANT_USED_AT_RE.exec(message);
    const transferMatch = TRANSFER_TO_FROM_RE.exec(message);
    const receivedFromMatch = RECEIVED_FROM_RE.exec(message);

    if (atMatch) {
      merchant = atMatch[1].trim();
    } else if (usedAtMatch) {
      merchant = usedAtMatch[1].trim();
    } else if (transferMatch) {
      merchant = transferMatch[1].trim();
    } else if (receivedFromMatch) {
      merchant = receivedFromMatch[1].trim();
    }

    if (merchant) {
      merchant = merchant.replace(/\*.*$/, "").trim();
    } else if (/salary/i.test(message)) {
      merchant = "Salary";
    }

    // Word-boundary anchored so "Ref" doesn't false-match inside a merchant
    // name that happens to contain those letters (e.g. "CARREFOUR").
    const refMatch = /\b(?:Ref|Reference|TR\s+REF|TXN)\b\s*:?\s*([A-Z0-9-]+)/i.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    return {
      source: "SMS",
      institution: resolvedInstitution.displayName,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      amount,
      currency: "AED",
      merchant,
      reference,
      transactionDate: receivedAt,
      redactedMessage,
      payloadHash,
      availableBalance,
      accountEnding,
      isDeclined,
      metadata: {
        maskedSender: maskedSenderValue,
        hasAvailableBalance: !!availableBalance,
        isDeclined,
      },
    };
  }
}

export const genericBankCreditDebitParser = new GenericBankCreditDebitParser();
