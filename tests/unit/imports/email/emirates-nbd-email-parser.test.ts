import { describe, it, expect } from "vitest";
import { emiratesNbdEmailParser } from "../../../../src/imports/email/parsers/emirates-nbd.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-19T20:00:00Z");

// Structurally identical to the real "Local Bank Transfer" confirmation
// format the user supplied, with synthetic (non-real) field values.
function buildLocalTransferEmail(overrides: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    "Transaction Date": "15/Mar/2026 02:30 PM",
    "From Account": "014***99***01",
    "Debit Amount": "AED 500.00",
    "Transaction Amount": "AED 500.00",
    "Destination Country": "UNITED ARAB EMIRATES",
    "Beneficiary Name": "Jane Doe",
    "Beneficiary Account / IBAN": "AE070331234567890123456",
    "Beneficiary Bank Name": "MASHREQBANK PSC",
    "SWIFT / Routing Code": "BOMLAEAD",
    "Channel Reference No": "TESTREF123456",
    "SWIFT Reference No": "202603150001TESTSWIFT99",
    Status: "Success",
    ...overrides,
  };

  return [
    "CIF: ***1234***",
    "",
    "Dear Test User,",
    "",
    "Here is a consolidated status of your Local Bank Transfer.",
    "",
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
}

describe("EmiratesNbdEmailParser — canParse", () => {
  it("matches the ENBD Local Bank Transfer format", () => {
    const body = buildLocalTransferEmail();
    expect(emiratesNbdEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body)).toBe(true);
  });

  it("does not match a non-ENBD sender", () => {
    const body = buildLocalTransferEmail();
    expect(emiratesNbdEmailParser.canParse("alerts@mashreqbank.com", "Local Bank Transfer", body)).toBe(false);
  });

  it("does not match an ENBD email that isn't this specific format (e.g. a POS purchase alert)", () => {
    const posBody = "Dear Customer,\n\nPurchase of AED 45.00 at CARREFOUR DUBAI.\nAvl Balance is AED 1,200.00.";
    expect(emiratesNbdEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Purchase Alert", posBody)).toBe(false);
  });
});

describe("EmiratesNbdEmailParser — parse", () => {
  it("extracts amount, direction, reference, and beneficiary bank as merchant", () => {
    const body = buildLocalTransferEmail();
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("500.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.OUTFLOW);
    expect(result!.isCreditCard).toBe(false);
    // Prefers Beneficiary Bank Name (matches categorizeMerchant's keyword
    // list) over the beneficiary's own personal name.
    expect(result!.merchant).toBe("MASHREQBANK PSC");
    expect(result!.reference).toBe("TESTREF123456");
    expect(result!.institution).toBe("Emirates NBD");
    expect(result!.institutionCode).toBe("ENBD");
    expect(result!.externalMessageId).toBe("gmail-msg-1");
    expect(result!.isDeclined).toBe(false);
  });

  it("falls back to SWIFT Reference No when Channel Reference No is absent", () => {
    const body = buildLocalTransferEmail({ "Channel Reference No": "" }).replace(/Channel Reference No: \n/, "");
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-2");
    expect(result!.reference).toBe("202603150001TESTSWIFT99");
  });

  it("returns null (not a guessed transaction) when Status is not Success", () => {
    const body = buildLocalTransferEmail({ Status: "Pending" });
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-3");
    expect(result).toBeNull();
  });

  it("returns null when the amount can't be extracted", () => {
    const body = buildLocalTransferEmail({ "Debit Amount": "N/A" });
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-4");
    expect(result).toBeNull();
  });

  it("masks the beneficiary IBAN in the redacted payload", () => {
    const body = buildLocalTransferEmail();
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-5");
    expect(result!.redactedMessage).not.toContain("AE070331234567890123456");
  });

  it("does not double-apply the Dubai offset — a transaction just after midnight Dubai time lands on the correct calendar day once the shared engine re-applies its +4h offset", () => {
    // 00:15 AM Dubai on 31 Aug is 20:15 UTC on 30 Aug — the transactionDate
    // this parser returns must be that UTC instant, so that import.service.ts's
    // downstream `transactionDate.getTime() + 4h` recovers 31 Aug, not 30 Aug.
    const body = buildLocalTransferEmail({ "Transaction Date": "31/Aug/2026 00:15 AM" });
    const result = emiratesNbdEmailParser.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", body, now, "gmail-msg-6");

    expect(result).not.toBeNull();
    expect(result!.transactionDate.getUTCDate()).toBe(30);
    expect(result!.transactionDate.getUTCMonth()).toBe(7); // August, 0-indexed
    expect(result!.transactionDate.getUTCHours()).toBe(20);
    expect(result!.transactionDate.getUTCMinutes()).toBe(15);

    // Simulate the shared engine's own +4h Dubai re-application.
    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const dubaiRecovered = new Date(result!.transactionDate.getTime() + DUBAI_OFFSET_MS);
    expect(dubaiRecovered.getUTCDate()).toBe(31);
    expect(dubaiRecovered.getUTCMonth()).toBe(7);
  });
});
