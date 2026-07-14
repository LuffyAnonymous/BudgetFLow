import { Decimal } from "decimal.js";
import { ImportConfidence } from "@prisma/client";
import {
  ISmsParser,
  NormalizedSmsTransaction,
  ParseError,
} from "./sms-parser.interface";
import { redactFinancialText, maskSender, sha256 } from "../engine/redaction";

const KNOWN_MASHREQ_SENDERS = ["MASHREQ", "MashreqBank", "Mashreq-Bank", "MASHREQBANK"];

// Regular Expressions
const AMOUNT_RE = /AED\s*([\d,]+(?:\.\d{1,2})?)/i;
const REFERENCE_RE = /(?:TR\s+REF|Ref|Reference|Ref\.?|TXN)\s*:?\s*([A-Z0-9-]+)/i;

// Match merchant patterns:
// "at MerchantName on ..."
// "at MerchantName."
// "used at MerchantName for AED ..."
const MERCHANT_AT_RE = /at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+on|\.|\s+Ref|Ref\b|\s+for|$)/i;
const MERCHANT_USED_AT_RE = /used\s+at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+for|\.|\s+Ref|Ref\b|$)/i;

export class MashreqParser implements ISmsParser {
  readonly parserKey = "mashreq-v1";
  readonly parserVersion = "1.0.0";
  readonly institution = "Mashreq";

  canParse(sender: string, message: string): boolean {
    const senderMatch = KNOWN_MASHREQ_SENDERS.some((s) =>
      sender.toUpperCase().includes(s.toUpperCase())
    );
    if (!senderMatch) return false;

    // Reject obvious OTPs and promotions
    const isOtp = /otp|verification|one-time|passcode|security\s*code|activate/i.test(message);
    const isPromo = /promo|discount|offer|win|apply\s*now|cashback|credit\s*card\s*offer|rewards/i.test(message);
    if (isOtp || isPromo) return false;

    return true;
  }

  parse(sender: string, message: string, receivedAt: Date): NormalizedSmsTransaction {
    const redactedMessage = redactFinancialText(message);
    const payloadHash = sha256(message);
    const maskedSenderValue = maskSender(sender);

    // 1. Extract Amount
    const amountMatch = AMOUNT_RE.exec(message);
    if (!amountMatch) {
      throw new ParseError(this.parserKey, "Failed to extract transaction amount");
    }
    const amount = new Decimal(amountMatch[1].replace(/,/g, ""));

    // 2. Extract Merchant Name
    let merchant: string | null = null;
    const atMatch = MERCHANT_AT_RE.exec(message);
    const usedAtMatch = MERCHANT_USED_AT_RE.exec(message);
    
    if (atMatch) {
      merchant = atMatch[1].trim();
    } else if (usedAtMatch) {
      merchant = usedAtMatch[1].trim();
    }

    // Clean up merchant name if it has wildcard or extra trailing characters
    if (merchant) {
      // e.g., Tabby* UAE -> Tabby
      merchant = merchant.replace(/\*.*$/, "").trim();
      if (/tabby/i.test(merchant)) {
        merchant = "TABBY";
      }
    }

    // 3. Extract Reference
    const refMatch = REFERENCE_RE.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    // Determine type: typically purchases/debits are EXPENSEs
    const transactionType = "EXPENSE";

    // Assess confidence: Mashreq SMS formats are not VERIFIED_REAL yet. Keep in review mode.
    const confidence = ImportConfidence.LOW;

    return {
      source: "SMS",
      institution: this.institution,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      transactionType,
      amount,
      currency: "AED",
      merchant: merchant || null,
      description: merchant ? `Purchase at ${merchant}` : "Mashreq Transaction",
      reference,
      transactionDate: receivedAt,
      redactedMessage,
      payloadHash,
      confidence,
      metadata: {
        maskedSender: maskedSenderValue,
        parsedMerchant: merchant,
      },
    };
  }
}

export const mashreqParser = new MashreqParser();
