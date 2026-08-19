import { Decimal } from "decimal.js";
import {
  ISmsParser,
  NormalizedSmsTransaction,
  ParseError,
} from "./sms-parser.interface";
import { redactFinancialText, maskSender, sha256 } from "../engine/redaction";

const KNOWN_SENDERS = ["ENBD", "EmiratesNBD", "Emirates-NBD", "EMIRATESNBD"];

// Regular Expressions
const AVAILABLE_BALANCE_RE = /(?:available\s+balance|bal|balance)\s+(?:is\s+)?(?:AED\s*)?([\d,]+(?:\.\d{1,2})?)/i;
// Merchant fields are frequently followed by ", <phone>, <city>" — a comma is
// a hard stop so we capture just the merchant name, not the trailing detail.
const MERCHANT_AT_RE = /at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+on|\.|,|\s+Ref|Ref\b|\s+for|$)/i;
const MERCHANT_USED_AT_RE = /used\s+at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+for|\.|,|\s+Ref|Ref\b|$)/i;
const TRANSFER_TO_RE = /transfer\s+(?:of\s+(?:AED|USD)\s*[\d,.]+\s+)?to\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+(?:account|a\/c|card)|\.|,|\s+Ref|Ref\b|$)/i;

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

export class EmiratesNBDParser implements ISmsParser {
  readonly parserKey = "emirates-nbd-salary-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Emirates NBD";

  canParse(sender: string, message: string): boolean {
    const senderMatch = KNOWN_SENDERS.some((s) =>
      sender.toUpperCase().includes(s.toUpperCase())
    );
    if (!senderMatch) return false;

    // Reject obvious OTPs and promotions
    const isOtp = /otp|verification|one-time|passcode|security\s*code|activate/i.test(message);
    const isPromo = /promo|discount|offer|win|apply\s*now|customs|cashback|credit\s*card\s*offer|rewards/i.test(message);
    if (isOtp || isPromo) return false;

    return true;
  }

  parse(sender: string, message: string, receivedAt: Date): NormalizedSmsTransaction {
    const redactedMessage = redactFinancialText(message);
    const payloadHash = sha256(message);
    const maskedSenderValue = maskSender(sender);

    // Reject obvious OTPs and promotions inside parse too
    if (/otp|verification|one-time|passcode|security\s*code|activate/i.test(message)) {
      throw new ParseError(this.parserKey, "OTP message cannot be parsed as a financial transaction");
    }
    if (/promo|discount|offer|win|apply\s*now|customs|cashback|credit\s*card\s*offer|rewards/i.test(message)) {
      throw new ParseError(this.parserKey, "Promo message cannot be parsed as a financial transaction");
    }

    // 1. Check if declined
    const isDeclined = /declined|insufficient\s*funds|insufficient\s*limit|unsuccessful|failed/i.test(message);

    // 2. Extract Available Balance
    const balMatch = AVAILABLE_BALANCE_RE.exec(message);
    const availableBalance = balMatch ? new Decimal(balMatch[1].replace(/,/g, "")) : null;

    // 3. Extract Transaction Amount (first amount in message)
    const amountMatches = [...message.matchAll(/(?:AED|USD)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
    let amount = new Decimal(0);
    if (amountMatches.length > 0) {
      amount = new Decimal(amountMatches[0][1].replace(/,/g, ""));
    } else {
      throw new ParseError(this.parserKey, "Failed to extract transaction amount");
    }

    // 4. Extract Account Ending
    const accountEnding = extractAccountEnding(message);

    // 5. Extract Merchant
    let merchant: string | null = null;
    const atMatch = MERCHANT_AT_RE.exec(message);
    const usedAtMatch = MERCHANT_USED_AT_RE.exec(message);
    const transferMatch = TRANSFER_TO_RE.exec(message);
    
    if (atMatch) {
      merchant = atMatch[1].trim();
    } else if (usedAtMatch) {
      merchant = usedAtMatch[1].trim();
    } else if (transferMatch) {
      merchant = transferMatch[1].trim();
    }

    // Clean up merchant name
    if (merchant) {
      merchant = merchant.replace(/\*.*$/, "").trim();
      if (/tabby/i.test(merchant)) {
        merchant = "TABBY";
      }
    } else if (/salary/i.test(message)) {
      merchant = "Salary";
    }

    // 6. Determine Reference
    const refMatch = /(?:Ref|Reference|TR\s+REF|TXN)\s*:?\s*([A-Z0-9-]+)/i.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    return {
      source: "SMS",
      institution: this.institution,
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

export const emiratesNBDParser = new EmiratesNBDParser();
