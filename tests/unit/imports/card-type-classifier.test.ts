import { describe, it, expect } from "vitest";
import { isCreditCardTransaction } from "../../../src/imports/engine/card-type-classifier";

describe("isCreditCardTransaction", () => {
  it("recognizes a credit card purchase message", () => {
    expect(isCreditCardTransaction("Purchase of AED 250.00 with Credit Card ending 4521 at Carrefour. Available Credit Limit: AED 9,750.00.")).toBe(true);
  });

  it("recognizes 'credit card' regardless of case or double spacing", () => {
    expect(isCreditCardTransaction("your CREDIT CARD ending 1234 was charged")).toBe(true);
    expect(isCreditCardTransaction("your credit  card ending 1234 was charged")).toBe(true);
  });

  it("does not flag a debit card purchase", () => {
    expect(isCreditCardTransaction("Purchase of AED 1.00 with Debit Card ending 8014 at Tabby, 800 82229, DUBAI. Avl Balance is AED 0.48.")).toBe(false);
  });

  it("does not flag a plain credited-to-account message", () => {
    expect(isCreditCardTransaction("AED 5750.00 credited to your account ending 1234. Avl Balance is AED 6000.00.")).toBe(false);
  });
});
