import { describe, it, expect } from "vitest";
import { emiratesNbdAccountDeductionEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd-account-deduction.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-29T09:00:00.000Z");

// Structurally identical to the real ENBD account-deduction alert, with
// synthetic (non-real) field values.
function buildDeductionEmail(overrides: { amount?: string; account?: string; reason?: string; availableBalance?: string } = {}): string {
  const amount = overrides.amount ?? "150.00";
  const account = overrides.account ?? "014XXX70XXX01";
  const reason = overrides.reason ?? "issuance of Telegraphic Transfer";
  const availableBalance = overrides.availableBalance ?? "1,350.48";
  return [
    "Emirates NBD Be alert, stay safe.",
    "Dear Customer,",
    `AED ${amount} has been deducted from your account ${account} for ${reason}. The available balance is AED ${availableBalance}.`,
    "Be aware.",
    "Should you need any assistance, please call 600 540000 .",
  ].join(" ");
}

describe("EmiratesNbdAccountDeductionEmailParser — canParse", () => {
  it("matches the account-deduction alert format", () => {
    const body = buildDeductionEmail();
    expect(emiratesNbdAccountDeductionEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildDeductionEmail();
    expect(emiratesNbdAccountDeductionEmailParser.canParse("MashreqAlerts@mashreq.com", "Be alert, stay safe.", body)).toBe(false);
  });

  it("does not match the salary-credit format (different verb, different sibling parser)", () => {
    const creditBody = "Salary of AED 5,750.00 has been credited into your account 014XXX70XXX01. The available balance is AED 5,750.48.";
    expect(emiratesNbdAccountDeductionEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", creditBody)).toBe(false);
  });

  it("does not match the ATM withdrawal format", () => {
    const withdrawalBody = "Your ATM withdrawal transaction was successfully completed on 28th Aug 2026 at 16:57 PM . Amount: AED 3,500.00";
    expect(emiratesNbdAccountDeductionEmailParser.canParse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", withdrawalBody)).toBe(false);
  });
});

describe("EmiratesNbdAccountDeductionEmailParser — parse", () => {
  it("extracts amount, OUTFLOW direction, account ending, reason, and available balance", () => {
    const body = buildDeductionEmail();
    const result = emiratesNbdAccountDeductionEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("150.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.OUTFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.merchant).toBe("issuance of Telegraphic Transfer");
    expect(result!.accountEnding).toBe("7001");
    expect(result!.availableBalance!.toFixed(2)).toBe("1350.48");
    expect(result!.reference).toBeNull();
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
  });

  it("uses the Gmail-reported receivedAt directly as transactionDate (no separate date field in this format)", () => {
    const body = buildDeductionEmail();
    const result = emiratesNbdAccountDeductionEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-2");
    expect(result!.transactionDate.getTime()).toBe(now.getTime());
  });

  it("handles a different amount and a different deduction reason", () => {
    const body = buildDeductionEmail({ amount: "25.00", reason: "SWIFT charges" });
    const result = emiratesNbdAccountDeductionEmailParser.parse("OnlineBanking@emiratesnbd.com", "Be alert, stay safe.", body, now, "gmail-msg-3");
    expect(result!.amount.toFixed(2)).toBe("25.00");
    expect(result!.merchant).toBe("SWIFT charges");
  });
});
