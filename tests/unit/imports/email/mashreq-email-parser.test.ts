import { describe, it, expect } from "vitest";
import { mashreqEmailParser } from "../../../../src/imports/email/parsers/mashreq.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-30T07:38:33.000Z");

// Structurally identical (post gmail-message-decoder.ts HTML-stripping) to
// the real "Transaction Notification" debit alert from
// MashreqAlerts@mashreq.com, with synthetic (non-real) field values.
function buildDebitAlertEmail(overrides: { acctEnding?: string; amount?: string; description?: string } = {}): string {
  const acctEnding = overrides.acctEnding ?? "9523";
  const amount = overrides.amount ?? "200.00";
  const description = overrides.description ?? "Aani Instant Payments (Local IPP Transfer)";
  return [
    "Dear Customer,",
    "Thank you for banking with Mashreq.",
    `Your AC No:XXXXXXXX${acctEnding} is debited with AED ${amount} for ${description}. Login to Online Banking for details`,
    "To view details, log in to Mashreq Mobile App or Online Banking.",
    "Regards,",
    "Mashreq NEO",
  ].join(" ");
}

describe("MashreqEmailParser — canParse", () => {
  it("matches the Mashreq debit-alert format", () => {
    const body = buildDebitAlertEmail();
    expect(mashreqEmailParser.canParse("MashreqAlerts@mashreq.com", "Transaction Notification", body)).toBe(true);
  });

  it("does not match a non-Mashreq sender", () => {
    const body = buildDebitAlertEmail();
    expect(mashreqEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Transaction Notification", body)).toBe(false);
  });

  it("does not match a Mashreq email that isn't this specific debit-alert wording (e.g. the richer transfer-confirmation format)", () => {
    const otherFormatBody = "Transfer type Local AED. Amount to be debited AED 300.00. Status Success.";
    expect(mashreqEmailParser.canParse("MashreqDigital@mashreq.com", "Local AED Transfer request via Mobile Banking", otherFormatBody)).toBe(false);
  });

  it("does not match a hypothetical credit-alert wording (no real sample supplied — never guessed at)", () => {
    const creditBody = "Your AC No:XXXXXXXX9523 is credited with AED 200.00 for Salary. Login to Online Banking for details";
    expect(mashreqEmailParser.canParse("MashreqAlerts@mashreq.com", "Transaction Notification", creditBody)).toBe(false);
  });
});

describe("MashreqEmailParser — parse", () => {
  it("extracts amount, direction, account ending, and description as merchant", () => {
    const body = buildDebitAlertEmail();
    const result = mashreqEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("200.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.OUTFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.merchant).toBe("Aani Instant Payments (Local IPP Transfer)");
    expect(result!.accountEnding).toBe("9523");
    expect(result!.reference).toBeNull();
    expect(result!.institution).toBe("Mashreq");
    expect(result!.institutionCode).toBe("MASHREQ");
    expect(result!.externalMessageId).toBe("gmail-msg-1");
    expect(result!.isDeclined).toBe(false);
  });

  it("uses the Gmail-reported receivedAt directly as transactionDate (no separate date field in this format)", () => {
    const body = buildDebitAlertEmail();
    const result = mashreqEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-2");
    expect(result!.transactionDate.getTime()).toBe(now.getTime());
  });

  it("returns null when the amount can't be extracted", () => {
    const body = "Your AC No:XXXXXXXX9523 is debited for some payment. Login to Online Banking for details";
    const result = mashreqEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-3");
    expect(result).toBeNull();
  });

  it("handles a different account ending and amount", () => {
    const body = buildDebitAlertEmail({ acctEnding: "4471", amount: "1,250.50", description: "Etisalat Bill Payment" });
    const result = mashreqEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-4");
    expect(result!.amount.toFixed(2)).toBe("1250.50");
    expect(result!.accountEnding).toBe("4471");
    expect(result!.merchant).toBe("Etisalat Bill Payment");
  });
});
