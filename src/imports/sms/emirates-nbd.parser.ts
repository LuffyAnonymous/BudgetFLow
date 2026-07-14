import { Decimal } from "decimal.js";
import { ImportConfidence } from "@prisma/client";
import {
  ISmsParser,
  NormalizedSmsTransaction,
  ParseError,
} from "./sms-parser.interface";
import { redactFinancialText, maskSender, sha256 } from "../engine/redaction";

const KNOWN_SENDERS = ["ENBD", "EmiratesNBD", "Emirates-NBD", "EMIRATESNBD"];

// Regular Expressions
const SALARY_AMOUNT_RE = /AED\s*([\d,]+(?:\.\d{1,2})?)\s+has\s+been\s+credited\s+to\s+your\s+account/i;
const SALARY_MARKER_RE = /SALARY\s+TR\s+REF/i;
const REFERENCE_RE = /SALARY\s+TR\s+REF\s+([A-Z0-9-]+)/i;
const AVAILABLE_BALANCE_RE = /available\s+balance\s+is\s+AED\s*([\d,]+(?:\.\d{1,2})?)/i;
const GENERIC_AMOUNT_RE = /AED\s*([\d,]+(?:\.\d{1,2})?)/i;
const GENERIC_REFERENCE_RE = /(?:Ref|Reference)\s*:?\s*([A-Z0-9-]+)/i;

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
    const isPromo = /promo|discount|offer|win|apply\s*now|cashback|credit\s*card\s*offer|rewards/i.test(message);
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
    if (/promo|discount|offer|win|apply\s*now|cashback|credit\s*card\s*offer|rewards/i.test(message)) {
      throw new ParseError(this.parserKey, "Promo message cannot be parsed as a financial transaction");
    }

    // 1. Check if it is a Salary Credit
    if (SALARY_AMOUNT_RE.test(message) && SALARY_MARKER_RE.test(message)) {
      const match = SALARY_AMOUNT_RE.exec(message);
      if (!match) throw new ParseError(this.parserKey, "Failed to extract salary amount");
      const amount = new Decimal(match[1].replace(/,/g, ""));
      const refMatch = REFERENCE_RE.exec(message);
      const reference = refMatch ? refMatch[1].toUpperCase() : null;

      // Extract available balance for safety check
      const balMatch = AVAILABLE_BALANCE_RE.exec(message);
      const availableBalance = balMatch ? new Decimal(balMatch[1].replace(/,/g, "")) : null;

      if (availableBalance && amount.eq(availableBalance)) {
        throw new ParseError(this.parserKey, "Salary amount equals available balance");
      }

      return {
        source: "SMS",
        institution: this.institution,
        parserKey: this.parserKey,
        parserVersion: this.parserVersion,
        transactionType: "INCOME",
        amount,
        currency: "AED",
        merchant: null,
        description: "Salary",
        reference,
        transactionDate: receivedAt,
        redactedMessage,
        payloadHash,
        confidence: reference ? ImportConfidence.HIGH : ImportConfidence.MEDIUM,
        metadata: {
          maskedSender: maskedSenderValue,
          category: "salary",
          hasAvailableBalance: !!availableBalance,
        },
      };
    }

    // 2. Check if it is an Internal Transfer to Mashreq
    if (/to\s+Mashreq/i.test(message) || /Transfer\s+to\s+Mashreq/i.test(message)) {
      const match = GENERIC_AMOUNT_RE.exec(message);
      if (!match) throw new ParseError(this.parserKey, "Failed to extract transfer amount");
      const amount = new Decimal(match[1].replace(/,/g, ""));
      const refMatch = GENERIC_REFERENCE_RE.exec(message);
      const reference = refMatch ? refMatch[1].toUpperCase() : null;

      return {
        source: "SMS",
        institution: this.institution,
        parserKey: this.parserKey,
        parserVersion: this.parserVersion,
        transactionType: "EXPENSE",
        amount,
        currency: "AED",
        merchant: "Mashreq",
        description: "Transfer to Mashreq",
        reference,
        transactionDate: receivedAt,
        redactedMessage,
        payloadHash,
        confidence: ImportConfidence.LOW, // Keep in review mode until VERIFIED_REAL example provided
        metadata: { maskedSender: maskedSenderValue, category: "transfer" },
      };
    }

    // 3. Check if it is an ATM Cash Withdrawal
    if (/ATM/i.test(message) || /withdrawn/i.test(message)) {
      const match = GENERIC_AMOUNT_RE.exec(message);
      if (!match) throw new ParseError(this.parserKey, "Failed to extract ATM withdrawal amount");
      const amount = new Decimal(match[1].replace(/,/g, ""));
      const refMatch = GENERIC_REFERENCE_RE.exec(message);
      const reference = refMatch ? refMatch[1].toUpperCase() : null;

      return {
        source: "SMS",
        institution: this.institution,
        parserKey: this.parserKey,
        parserVersion: this.parserVersion,
        transactionType: "EXPENSE",
        amount,
        currency: "AED",
        merchant: "ATM",
        description: "ATM Withdrawal",
        reference,
        transactionDate: receivedAt,
        redactedMessage,
        payloadHash,
        confidence: ImportConfidence.LOW, // Keep in review mode until VERIFIED_REAL example provided
        metadata: { maskedSender: maskedSenderValue, category: "atm" },
      };
    }

    // 4. Unknown SMS from Emirates NBD (but not promo/OTP) -> parse amount if possible, mark as LOW confidence
    const amountMatch = GENERIC_AMOUNT_RE.exec(message);
    const amount = amountMatch ? new Decimal(amountMatch[1].replace(/,/g, "")) : new Decimal(0);
    const refMatch = GENERIC_REFERENCE_RE.exec(message);
    const reference = refMatch ? refMatch[1].toUpperCase() : null;

    return {
      source: "SMS",
      institution: this.institution,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      transactionType: "EXPENSE",
      amount,
      currency: "AED",
      merchant: null,
      description: "Emirates NBD Unknown Transaction",
      reference,
      transactionDate: receivedAt,
      redactedMessage,
      payloadHash,
      confidence: ImportConfidence.LOW,
      metadata: { maskedSender: maskedSenderValue, unknown: true },
    };
  }
}

export const emiratesNBDParser = new EmiratesNBDParser();
