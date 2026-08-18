import { describe, it, expect } from "vitest";
import { genericBankCreditDebitParser } from "../../../src/imports/sms/generic-bank-credit-debit.parser";
import { smsParserRegistry } from "../../../src/imports/sms/parser-registry";

const now = new Date("2026-08-18T12:00:00Z");

describe("GenericBankCreditDebitParser", () => {
  it("parses a generic ADCB-style debit message", () => {
    const message = "AED 250.00 debited from your account for purchase at CARREFOUR on 18-08-26. Available Balance AED 3,450.75. Ref: ADC12345";
    expect(genericBankCreditDebitParser.canParse("ADCB", message)).toBe(true);

    const result = genericBankCreditDebitParser.parse("ADCB", message, now);
    expect(result.amount.toFixed(2)).toBe("250.00");
    expect(result.availableBalance?.toFixed(2)).toBe("3450.75");
    expect(result.merchant).toBe("CARREFOUR");
    expect(result.reference).toBe("ADC12345");
    expect(result.institution).toBe("ADCB");
  });

  it("parses a generic credit/received message for a different bank", () => {
    const message = "AED 5,200.00 received from Acme Consulting FZE. Available balance is AED 8,100.00.";
    expect(genericBankCreditDebitParser.canParse("MASHREQ", message)).toBe(true);

    const result = genericBankCreditDebitParser.parse("MASHREQ", message, now);
    expect(result.amount.toFixed(2)).toBe("5200.00");
    expect(result.merchant).toBe("Acme Consulting FZE");
    expect(result.institution).toBe("Mashreq");
  });

  it("rejects OTP and promo noise", () => {
    expect(genericBankCreditDebitParser.canParse("ADCB", "Your OTP is 445566, valid for 5 minutes")).toBe(false);
    expect(genericBankCreditDebitParser.canParse("FAB", "Apply now for our credit card offer and get cashback!")).toBe(false);
  });

  it("does not claim messages from senders with their own dedicated parser", () => {
    // Emirates NBD, Tabby, and Tamara all have dedicated parsers — this
    // parser must stay out of their way to avoid an "ambiguous" outcome.
    const message = "AED 100.00 debited for purchase. Available Balance AED 500.00";
    expect(genericBankCreditDebitParser.canParse("ENBD", message)).toBe(false);
    expect(genericBankCreditDebitParser.canParse("TABBY", message)).toBe(false);
    expect(genericBankCreditDebitParser.canParse("TAMARA", message)).toBe(false);
  });

  it("resolves cleanly through the parser registry for a non-Emirates-NBD, allowlisted sender", () => {
    const message = "AED 75.50 debited for purchase at NOON. Available Balance AED 900.00. Ref: RAK998877";
    const selection = smsParserRegistry.select("RAKBANK", message, ["RAKBANK"]);
    expect(selection.outcome).toBe("matched");
    if (selection.outcome === "matched") {
      expect(selection.parser.parserKey).toBe("generic-bank-credit-debit-v1");
    }
  });
});
