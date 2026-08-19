import { describe, it, expect } from "vitest";
import { emiratesNBDParser } from "../../../src/imports/sms/emirates-nbd.parser";

const now = new Date("2026-08-19T20:00:00Z");

describe("EmiratesNBDParser — merchant extraction", () => {
  it("stops merchant capture at a comma instead of swallowing trailing phone/city detail", () => {
    // Real-world format: "at <merchant>, <phone>, <city>." — a comma-containing
    // merchant field previously broke extraction entirely, leaving merchant
    // null and dropping a recognizable BNPL charge into manual review.
    const message = "Purchase of AED 1.00 with Debit Card ending 8014 at Tabby, 800 82229, DUBAI. Avl Balance is AED 0.48.";
    const result = emiratesNBDParser.parse("ENBD", message, now);
    // The parser uppercases recognized Tabby merchants to "TABBY" — this
    // predates this fix and just confirms merchant extraction now succeeds
    // at all instead of returning null.
    expect(result.merchant).toBe("TABBY");
    expect(result.amount.toFixed(2)).toBe("1.00");
    expect(result.availableBalance?.toFixed(2)).toBe("0.48");
  });

  it("still extracts a merchant with no trailing comma detail", () => {
    const message = "AED 50.00 debited from card ending 1234 at RTA NOL on 11-07-2026. Ref: TXN11";
    const result = emiratesNBDParser.parse("ENBD", message, now);
    expect(result.merchant).toBe("RTA NOL");
  });
});
