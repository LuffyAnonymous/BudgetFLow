import { describe, it, expect } from "vitest";
import { emiratesNbdInstantTransferCreditEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd-instant-transfer-credit.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-29T09:00:00.000Z");

// Structurally identical to the real ENBD instant-transfer-credit alert,
// with synthetic (non-real) field values.
function buildInstantTransferCreditEmail(overrides: { amount?: string; account?: string; availableBalance?: string } = {}): string {
  const amount = overrides.amount ?? "200.00";
  const account = overrides.account ?? "014XXX70XXX01";
  const availableBalance = overrides.availableBalance ?? "200.93";
  return [
    "Emirates NBD Be alert, stay safe.",
    "Be alert, stay safe.",
    "Dear Customer,",
    `Dear Customer, AED ${amount} has been credited to your account ${account} towards instant transfer. The available balance is AED ${availableBalance}.`,
    "Be aware.",
    "In our emails, we will never ask you for confidential information or to confirm any security details like User IDs, passwords or PINS.",
  ].join(" ");
}

describe("EmiratesNbdInstantTransferCreditEmailParser — canParse", () => {
  it("matches the instant-transfer-credit alert format", () => {
    const body = buildInstantTransferCreditEmail();
    expect(emiratesNbdInstantTransferCreditEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildInstantTransferCreditEmail();
    expect(emiratesNbdInstantTransferCreditEmailParser.canParse("MashreqAlerts@mashreq.com", "Be alert, stay safe.", body)).toBe(false);
  });

  it("does not match the salary-credit format (different wording, different sibling parser)", () => {
    const salaryBody = "Salary of AED 5,750.00 has been credited into your account 014XXX70XXX01. The available balance is AED 5,750.48.";
    expect(emiratesNbdInstantTransferCreditEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", salaryBody)).toBe(false);
  });

  it("does not match the account-deduction format (opposite direction, different sibling parser)", () => {
    const deductionBody = "AED 150.00 has been deducted from your account 014XXX70XXX01 for issuance of Telegraphic Transfer. The available balance is AED 1,350.48.";
    expect(emiratesNbdInstantTransferCreditEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", deductionBody)).toBe(false);
  });
});

describe("EmiratesNbdInstantTransferCreditEmailParser — parse", () => {
  it("extracts amount, INFLOW direction, account ending, and available balance", () => {
    const body = buildInstantTransferCreditEmail();
    const result = emiratesNbdInstantTransferCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("200.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.INFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.merchant).toBe("Instant Transfer");
    expect(result!.accountEnding).toBe("7001");
    expect(result!.availableBalance!.toFixed(2)).toBe("200.93");
    expect(result!.reference).toBeNull();
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
    expect(result!.impliedToAccount).toBeUndefined();
  });

  it("uses the Gmail-reported receivedAt directly as transactionDate (no separate date field in this format)", () => {
    const body = buildInstantTransferCreditEmail();
    const result = emiratesNbdInstantTransferCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-2");
    expect(result!.transactionDate.getTime()).toBe(now.getTime());
  });

  it("handles a different amount", () => {
    const body = buildInstantTransferCreditEmail({ amount: "1250.75", availableBalance: "4000.00" });
    const result = emiratesNbdInstantTransferCreditEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-3");
    expect(result!.amount.toFixed(2)).toBe("1250.75");
    expect(result!.availableBalance!.toFixed(2)).toBe("4000.00");
  });
});
