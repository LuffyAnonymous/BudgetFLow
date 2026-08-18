import { describe, it, expect } from "vitest";
import { bnplParser } from "../../../src/imports/sms/bnpl.parser";
import { classifyDirection, TransactionDirection } from "../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-18T12:00:00Z");

describe("BnplParser", () => {
  it("parses a completed Tabby charge", () => {
    const message = "AED 249.00 was charged for your Tabby order. Ref: TBY-88213";
    expect(bnplParser.canParse("TABBY", message)).toBe(true);

    const result = bnplParser.parse("TABBY", message, now);
    expect(result.amount.toFixed(2)).toBe("249.00");
    expect(result.merchant).toBe("Tabby");
    expect(result.institution).toBe("Tabby");
    expect(result.reference).toBe("TBY-88213");

    // Downstream direction classification (independent of the parser) must
    // recognize this as a completed outflow, not merely informational.
    expect(classifyDirection(message)).toBe(TransactionDirection.OUTFLOW);
  });

  it("parses a completed Tamara charge", () => {
    const message = "AED 180.00 charged for your Tamara purchase at H&M.";
    expect(bnplParser.canParse("TAMARA", message)).toBe(true);

    const result = bnplParser.parse("TAMARA", message, now);
    expect(result.amount.toFixed(2)).toBe("180.00");
    expect(result.merchant).toBe("Tamara");
  });

  it("parses an installment-due reminder without crashing, and it correctly stays out of the ledger", () => {
    // "due" isn't a completed-transaction keyword in direction-classifier.ts,
    // so this deliberately falls through to INFORMATIONAL — a reminder about
    // a future payment should never auto-post as an expense.
    const message = "Your Tabby installment of AED 250.00 is due on 25-08-2026.";
    expect(bnplParser.canParse("TABBY", message)).toBe(true);
    expect(() => bnplParser.parse("TABBY", message, now)).not.toThrow();
    expect(classifyDirection(message)).toBe(TransactionDirection.INFORMATIONAL);
  });

  it("does not claim messages from senders it doesn't own", () => {
    const message = "AED 100.00 charged for your order.";
    expect(bnplParser.canParse("ADCB", message)).toBe(false);
    expect(bnplParser.canParse("ENBD", message)).toBe(false);
  });

  it("rejects OTP messages", () => {
    expect(bnplParser.canParse("TABBY", "Your Tabby OTP is 112233")).toBe(false);
  });
});
