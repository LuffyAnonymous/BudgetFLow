import { describe, it, expect } from "vitest";
import { AccountType } from "@prisma/client";
import { emiratesNbdAtmWithdrawalEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd-atm-withdrawal.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-28T13:00:00.000Z");

// Structurally identical to the real bilingual "ATM withdrawal" confirmation
// email, with synthetic (non-real) field values. The Arabic section is kept
// to prove English-label regexes don't accidentally match it.
function buildWithdrawalEmail(overrides: {
  amount?: string;
  availableBalance?: string;
  cardNumber?: string;
  accountNumber?: string;
  machineId?: string;
  machineLocation?: string;
  reference?: string;
  date?: string;
} = {}): string {
  const amount = overrides.amount ?? "3,500.00";
  const availableBalance = overrides.availableBalance ?? "1,500.48";
  const cardNumber = overrides.cardNumber ?? "443913XXXXXX8014";
  const accountNumber = overrides.accountNumber ?? "014XXX70XXX01";
  const machineId = overrides.machineId ?? "E4012432";
  const machineLocation = overrides.machineLocation ?? "JLB Branch";
  const reference = overrides.reference ?? "624016112506";
  const date = overrides.date ?? "28th Aug 2026 at 16:57 PM";

  return [
    "Emirates NBD Your ATM withdrawal transaction was successfully completed",
    "CIF: XXX70XXX",
    "Dear TEST USER,",
    `Your ATM withdrawal transaction was successfully completed on ${date} .`,
    "Transaction details:",
    `Amount: AED ${amount}`,
    `Available balance: AED ${availableBalance}`,
    `Card number: ${cardNumber}`,
    `Account number: ${accountNumber}`,
    `Machine ID: ${machineId}`,
    `Machine location: ${machineLocation}`,
    `Reference number: ${reference}`,
    "العزيز TEST USER،",
    "لقد تمّ بنجاح تنفيذ عملية سحب خاصة بك من جهاز الصراف الآلي",
    "3,500.00 درهم المبلغ:",
  ].join("\n");
}

describe("EmiratesNbdAtmWithdrawalEmailParser — canParse", () => {
  it("matches the ATM withdrawal confirmation format", () => {
    const body = buildWithdrawalEmail();
    expect(emiratesNbdAtmWithdrawalEmailParser.canParse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildWithdrawalEmail();
    expect(emiratesNbdAtmWithdrawalEmailParser.canParse("alerts@mashreq.com", "ATM withdrawal", body)).toBe(false);
  });

  it("does not match ENBD's Local Bank Transfer format", () => {
    const transferBody = "Here is a consolidated status of your Local Bank Transfer.\nDebit Amount: AED 500.00\nStatus: Success";
    expect(emiratesNbdAtmWithdrawalEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", transferBody)).toBe(false);
  });
});

describe("EmiratesNbdAtmWithdrawalEmailParser — parse", () => {
  it("extracts amount, available balance, card ending, merchant, and reference", () => {
    const body = buildWithdrawalEmail();
    const result = emiratesNbdAtmWithdrawalEmailParser.parse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("3500.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.OUTFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.availableBalance!.toFixed(2)).toBe("1500.48");
    expect(result!.accountEnding).toBe("8014");
    expect(result!.merchant).toBe("ATM Withdrawal - JLB Branch");
    expect(result!.reference).toBe("624016112506");
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
    expect(result!.impliedToAccount).toEqual({ type: AccountType.CASH, name: "Cash" });
  });

  it("returns null when the amount can't be extracted", () => {
    const body = buildWithdrawalEmail().replace(/Amount: AED [\d,.]+/, "Amount: N/A");
    const result = emiratesNbdAtmWithdrawalEmailParser.parse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", body, now, "gmail-msg-2");
    expect(result).toBeNull();
  });

  it("handles the bank template's redundant 24h+PM quirk (16:57 PM) without corrupting the hour", () => {
    const body = buildWithdrawalEmail({ date: "28th Aug 2026 at 16:57 PM" });
    const result = emiratesNbdAtmWithdrawalEmailParser.parse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", body, now, "gmail-msg-3");
    // Dubai 16:57 -> UTC 12:57 (subtract 4h)
    expect(result!.transactionDate.getUTCHours()).toBe(12);
    expect(result!.transactionDate.getUTCMinutes()).toBe(57);
  });

  it("does not double-apply the Dubai offset near midnight", () => {
    const body = buildWithdrawalEmail({ date: "31st Aug 2026 at 00:15 AM" });
    const result = emiratesNbdAtmWithdrawalEmailParser.parse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", body, now, "gmail-msg-4");

    expect(result!.transactionDate.getUTCDate()).toBe(30);
    expect(result!.transactionDate.getUTCHours()).toBe(20);

    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const dubaiRecovered = new Date(result!.transactionDate.getTime() + DUBAI_OFFSET_MS);
    expect(dubaiRecovered.getUTCDate()).toBe(31);
  });
});
