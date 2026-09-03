import { describe, it, expect } from "vitest";
import { AccountType } from "@prisma/client";
import { emiratesNbdCashDepositEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd-cash-deposit.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-09-03T16:04:00.000Z");

// Structurally identical to the real bilingual "cash deposit" confirmation
// email the user forwarded, with synthetic (non-real) field values. The
// Arabic section is kept to prove English-label regexes don't accidentally
// match it.
function buildDepositEmail(overrides: {
  amount?: string;
  depositedTo?: string;
  machineId?: string;
  machineLocation?: string;
  reference?: string;
  date?: string;
} = {}): string {
  const amount = overrides.amount ?? "500";
  const depositedTo = overrides.depositedTo ?? "014XXX70XXX01";
  const machineId = overrides.machineId ?? "E4012434";
  const machineLocation = overrides.machineLocation ?? "JLB Branch";
  const reference = overrides.reference ?? "E4012434262466860";
  const date = overrides.date ?? "03-09-2026 at 20:04 PM";

  return [
    "Emirates NBD Your cash deposit has been successfully processed",
    "CIF: XXX70XXX",
    "Dear TEST USER,",
    `Your cash deposit has been successfully processed on ${date} .`,
    "Deposit details:",
    `Amount: AED ${amount}`,
    `Deposited to: ${depositedTo}`,
    `Machine ID: ${machineId}`,
    `Machine location: ${machineLocation}`,
    `Reference number: ${reference}`,
    "العزيز TEST USER،",
    "لقد تمّت بنجاح معالجة معاملة الإيداع النقدي الخاصة بك",
    "500 درهم المبلغ:",
  ].join("\n");
}

describe("EmiratesNbdCashDepositEmailParser — canParse", () => {
  it("matches the cash deposit confirmation format", () => {
    const body = buildDepositEmail();
    expect(emiratesNbdCashDepositEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Cash deposit", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildDepositEmail();
    expect(emiratesNbdCashDepositEmailParser.canParse("alerts@mashreq.com", "Cash deposit", body)).toBe(false);
  });

  it("does not match ENBD's ATM withdrawal format", () => {
    const withdrawalBody = "Your ATM withdrawal transaction was successfully completed on 28th Aug 2026 at 16:57 PM.\nAmount: AED 3,500.00";
    expect(emiratesNbdCashDepositEmailParser.canParse("OnlineBanking@emiratesnbd.com", "ATM withdrawal", withdrawalBody)).toBe(false);
  });
});

describe("EmiratesNbdCashDepositEmailParser — parse", () => {
  it("extracts amount, account ending, merchant, and reference, with an implied Cash source", () => {
    const body = buildDepositEmail();
    const result = emiratesNbdCashDepositEmailParser.parse("OnlineBanking@emiratesnbd.com", "Cash deposit", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("500.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.INFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.availableBalance).toBeNull();
    expect(result!.accountEnding).toBe("7001"); // "014XXX70XXX01" with X's stripped is "0147001"
    expect(result!.merchant).toBe("Cash Deposit - JLB Branch");
    expect(result!.reference).toBe("E4012434262466860");
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
    expect(result!.impliedFromAccount).toEqual({ type: AccountType.CASH, name: "Cash" });
    expect(result!.impliedToAccount).toBeUndefined();
  });

  it("returns null when the amount can't be extracted", () => {
    const body = buildDepositEmail().replace(/Amount: AED [\d,.]+/, "Amount: N/A");
    const result = emiratesNbdCashDepositEmailParser.parse("OnlineBanking@emiratesnbd.com", "Cash deposit", body, now, "gmail-msg-2");
    expect(result).toBeNull();
  });

  it("handles the bank template's redundant 24h+PM quirk (20:04 PM) without corrupting the hour", () => {
    const body = buildDepositEmail({ date: "03-09-2026 at 20:04 PM" });
    const result = emiratesNbdCashDepositEmailParser.parse("OnlineBanking@emiratesnbd.com", "Cash deposit", body, now, "gmail-msg-3");
    // Dubai 20:04 -> UTC 16:04 (subtract 4h)
    expect(result!.transactionDate.getUTCHours()).toBe(16);
    expect(result!.transactionDate.getUTCMinutes()).toBe(4);
  });

  it("does not double-apply the Dubai offset near midnight", () => {
    const body = buildDepositEmail({ date: "31-08-2026 at 00:15 AM" });
    const result = emiratesNbdCashDepositEmailParser.parse("OnlineBanking@emiratesnbd.com", "Cash deposit", body, now, "gmail-msg-4");

    expect(result!.transactionDate.getUTCDate()).toBe(30);
    expect(result!.transactionDate.getUTCHours()).toBe(20);

    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const dubaiRecovered = new Date(result!.transactionDate.getTime() + DUBAI_OFFSET_MS);
    expect(dubaiRecovered.getUTCDate()).toBe(31);
  });
});
