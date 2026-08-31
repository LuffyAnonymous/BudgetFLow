import { describe, it, expect } from "vitest";
import { emiratesNbdSalaryCreditEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd-salary-credit.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-25T05:00:00.000Z");

// Structurally identical to the real ENBD salary-credit alert, with
// synthetic (non-real) field values.
function buildSalaryCreditEmail(overrides: { amount?: string; account?: string; availableBalance?: string } = {}): string {
  const amount = overrides.amount ?? "5,750.00";
  const account = overrides.account ?? "014XXX70XXX01";
  const availableBalance = overrides.availableBalance ?? "5,750.48";
  return [
    "Emirates NBD Be alert, stay safe.",
    "Dear Customer,",
    `Salary of AED ${amount} has been credited into your account ${account}. The available balance is AED ${availableBalance}.`,
    "Be aware.",
    "Should you need any assistance, please call 600 540000 .",
  ].join(" ");
}

describe("EmiratesNbdSalaryCreditEmailParser — canParse", () => {
  it("matches the salary-credit alert format", () => {
    const body = buildSalaryCreditEmail();
    expect(emiratesNbdSalaryCreditEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildSalaryCreditEmail();
    expect(emiratesNbdSalaryCreditEmailParser.canParse("MashreqAlerts@mashreq.com", "Be alert, stay safe.", body)).toBe(false);
  });

  it("does not match a generic 'has been credited' alert that isn't specifically a salary (no real sample of that wording supplied — never guessed at)", () => {
    const genericCreditBody = "Transfer of AED 500.00 has been credited into your account 014XXX70XXX01. The available balance is AED 500.00.";
    expect(emiratesNbdSalaryCreditEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", genericCreditBody)).toBe(false);
  });
});

describe("EmiratesNbdSalaryCreditEmailParser — parse", () => {
  it("extracts amount, INFLOW direction, account ending, and available balance", () => {
    const body = buildSalaryCreditEmail();
    const result = emiratesNbdSalaryCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("5750.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.INFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.merchant).toBe("Salary");
    expect(result!.accountEnding).toBe("7001");
    expect(result!.availableBalance!.toFixed(2)).toBe("5750.48");
    expect(result!.reference).toBeNull();
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
  });

  it("uses the Gmail-reported receivedAt directly as transactionDate (no separate date field in this format)", () => {
    const body = buildSalaryCreditEmail();
    const result = emiratesNbdSalaryCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-2");
    expect(result!.transactionDate.getTime()).toBe(now.getTime());
  });

  it("handles a different amount", () => {
    const body = buildSalaryCreditEmail({ amount: "12,000.00" });
    const result = emiratesNbdSalaryCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-3");
    expect(result!.amount.toFixed(2)).toBe("12000.00");
  });
});
