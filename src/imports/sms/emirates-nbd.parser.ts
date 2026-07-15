import { Decimal } from "decimal.js";
import { ImportConfidence } from "@prisma/client";
import {
  ISmsParser,
  NormalizedSmsTransaction,
  ParseError,
} from "./sms-parser.interface";
import { redactFinancialText, maskSender, sha256 } from "../engine/redaction";
import { MERCHANT_CATEGORIES } from "../rules/rules-engine";

const KNOWN_SENDERS = ["ENBD", "EmiratesNBD", "Emirates-NBD", "EMIRATESNBD"];

// Regular Expressions
const AVAILABLE_BALANCE_RE = /(?:available\s+balance|bal|balance)\s+(?:is\s+)?(?:AED\s*)?([\d,]+(?:\.\d{1,2})?)/i;
const MERCHANT_AT_RE = /at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+on|\.|\s+Ref|Ref\b|\s+for|$)/i;
const MERCHANT_USED_AT_RE = /used\s+at\s+([A-Za-z0-9\s&_*.-]+?)(?:\s+for|\.|\s+Ref|Ref\b|$)/i;

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
    if (atMatch) {
      merchant = atMatch[1].trim();
    } else if (usedAtMatch) {
      merchant = usedAtMatch[1].trim();
    }

    // Clean up merchant name
    if (merchant) {
      merchant = merchant.replace(/\*.*$/, "").trim();
      if (/tabby/i.test(merchant)) {
        merchant = "TABBY";
      }
    }

    // 6. Determine Reference
    const refMatch = /(?:Ref|Reference|TR\s+REF|TXN)\s*:?\s*([A-Z0-9-]+)/i.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    // 7. Determine Transaction Type & Direction
    let transactionType: "INCOME" | "EXPENSE" | "TRANSFER" | "DEBT_PAYMENT" | "REMITTANCE" = "EXPENSE";
    const isSalary = /salary/i.test(message) || /SALARY\s+TR\s+REF/i.test(message);
    const isTransfer = /transfer\s+to\s+Mashreq|to\s+Mashreq/i.test(message) || (/transfer/i.test(message) && !/received/i.test(message));
    const isWithdrawal = /ATM/i.test(message) || /withdrawn/i.test(message);
    const isDebt = /tabby|table\s*tennis|butterfly|stiga|tt\s*equipment/i.test(merchant || message);
    const isRemittance = /taptap\s*send/i.test(merchant || message);

    if (isSalary) {
      transactionType = "INCOME";
      merchant = null;
      if (availableBalance && amount.equals(availableBalance)) {
        throw new ParseError(this.parserKey, "Salary amount equals available balance");
      }
    } else if (isTransfer) {
      transactionType = "EXPENSE"; // Keep EXPENSE at parser level per tests, promoted in engine
      if (/Mashreq/i.test(message)) {
        merchant = "Mashreq";
      }
    } else if (isWithdrawal) {
      transactionType = "EXPENSE"; // Will be mapped to Transfer to Cash
      merchant = "ATM";
    } else if (isDebt) {
      transactionType = "DEBT_PAYMENT";
    } else if (isRemittance) {
      transactionType = "REMITTANCE";
    } else {
      const isInflow = /credited|received|refund|reversal|deposited|credit/i.test(message);
      if (isInflow) {
        transactionType = "INCOME";
      } else {
        transactionType = "EXPENSE";
      }
    }

    // 8. Determine Confidence
    const hasKnownMerchant = merchant && Object.keys(MERCHANT_CATEGORIES).some(
      (key) => merchant!.toUpperCase().includes(key) || key.includes(merchant!.toUpperCase())
    );
    const isKnownTransfer = isTransfer || isWithdrawal;
    const isKnownIncome = isSalary || /refund|reversal/i.test(message);

    const isKnown = isKnownIncome || isKnownTransfer || isDebt || isRemittance || hasKnownMerchant;
    const confidence = isKnown
      ? (reference ? ImportConfidence.HIGH : ImportConfidence.MEDIUM)
      : ImportConfidence.LOW;

    // Description
    let description = "Emirates NBD Transaction";
    if (isSalary) {
      description = "Salary";
    } else if (isTransfer) {
      description = merchant ? `Transfer to ${merchant}` : "Internal Transfer";
    } else if (isWithdrawal) {
      description = "ATM Withdrawal";
    } else if (merchant) {
      description = `Purchase at ${merchant}`;
    }

    return {
      source: "SMS",
      institution: this.institution,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      transactionType,
      amount,
      currency: "AED",
      merchant,
      description,
      reference,
      transactionDate: receivedAt,
      redactedMessage,
      payloadHash,
      confidence,
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
