import { describe, it, expect } from "vitest";
import { mashreqCardPurchaseEmailParser } from "../../../../src/imports/email/parsers/mashreq-card-purchase.parser";
import { TransactionDirection } from "../../../../src/imports/engine/direction-classifier";

const now = new Date("2026-08-31T13:49:00.000Z");

// Structurally identical (post gmail-message-decoder.ts HTML-stripping) to
// the real "Mashreq Card" purchase alert from MashreqAlerts@mashreq.com,
// with synthetic (non-real) field values.
function buildPurchaseAlertEmail(overrides: {
  cardEnding?: string;
  amount?: string;
  merchant?: string;
  date?: string;
  availableLimit?: string;
} = {}): string {
  const cardEnding = overrides.cardEnding ?? "3411";
  const amount = overrides.amount ?? "60.00";
  const merchant = overrides.merchant ?? "e& Digital App Abu Dhabi AE";
  const date = overrides.date ?? "31-AUG-2026 05:49 PM";
  const availableLimit = overrides.availableLimit ?? "44.00";
  return [
    "Dear Customer,",
    "Thank you for banking with Mashreq Bank.",
    "Please note the details of a recent transaction on your Mashreq Card.",
    `Your NEO VISA Debit Card Card ending with ${cardEnding} was used for a purchase of AED ${amount} at ${merchant} on ${date}. Available limit is AED ${availableLimit}`,
    "This is a system generated alert. We request you not to reply to this message.",
  ].join(" ");
}

describe("MashreqCardPurchaseEmailParser — canParse", () => {
  it("matches the Mashreq card-purchase alert format", () => {
    const body = buildPurchaseAlertEmail();
    expect(mashreqCardPurchaseEmailParser.canParse("MashreqAlerts@mashreq.com", "Transaction Notification", body)).toBe(true);
  });

  it("does not match a non-Mashreq sender", () => {
    const body = buildPurchaseAlertEmail();
    expect(mashreqCardPurchaseEmailParser.canParse("OnlineBanking@emiratesnbd.com", "Transaction Notification", body)).toBe(false);
  });

  it("does not match Mashreq's other debit-alert wording (the bank-transfer format, different sibling parser)", () => {
    const transferBody = "Your AC No:XXXXXXXX9523 is debited with AED 200.00 for Aani Instant Payments. Login to Online Banking for details";
    expect(mashreqCardPurchaseEmailParser.canParse("MashreqAlerts@mashreq.com", "Transaction Notification", transferBody)).toBe(false);
  });
});

describe("MashreqCardPurchaseEmailParser — parse", () => {
  it("extracts amount, direction, card ending, merchant, and available limit", () => {
    const body = buildPurchaseAlertEmail();
    const result = mashreqCardPurchaseEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-1");

    expect(result).not.toBeNull();
    expect(result!.amount.toFixed(2)).toBe("60.00");
    expect(result!.currency).toBe("AED");
    expect(result!.direction).toBe(TransactionDirection.OUTFLOW);
    expect(result!.isCreditCard).toBe(false);
    expect(result!.merchant).toBe("e& Digital App Abu Dhabi AE");
    expect(result!.accountEnding).toBe("3411");
    expect(result!.availableBalance!.toFixed(2)).toBe("44.00");
    expect(result!.reference).toBeNull();
    expect(result!.institution).toBe("Mashreq");
    expect(result!.institutionCode).toBe("MASHREQ");
    expect(result!.externalMessageId).toBe("gmail-msg-1");
  });

  it("returns null when the amount can't be extracted", () => {
    const body = "Your NEO VISA Debit Card Card ending with 3411 was used at e& Digital App on 31-AUG-2026 05:49 PM.";
    const result = mashreqCardPurchaseEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-2");
    expect(result).toBeNull();
  });

  it("does not double-apply the Dubai offset — a purchase just after midnight Dubai time lands on the correct calendar day once the shared engine re-applies its +4h offset", () => {
    const body = buildPurchaseAlertEmail({ date: "31-AUG-2026 00:15 AM" });
    const result = mashreqCardPurchaseEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-3");

    expect(result).not.toBeNull();
    expect(result!.transactionDate.getUTCDate()).toBe(30);
    expect(result!.transactionDate.getUTCHours()).toBe(20);

    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const dubaiRecovered = new Date(result!.transactionDate.getTime() + DUBAI_OFFSET_MS);
    expect(dubaiRecovered.getUTCDate()).toBe(31);
  });

  it("handles a different merchant, card ending, and amount", () => {
    const body = buildPurchaseAlertEmail({ cardEnding: "7890", amount: "1,050.75", merchant: "CARREFOUR DUBAI MALL" });
    const result = mashreqCardPurchaseEmailParser.parse("MashreqAlerts@mashreq.com", "Transaction Notification", body, now, "gmail-msg-4");
    expect(result!.amount.toFixed(2)).toBe("1050.75");
    expect(result!.accountEnding).toBe("7890");
    expect(result!.merchant).toBe("CARREFOUR DUBAI MALL");
  });
});
