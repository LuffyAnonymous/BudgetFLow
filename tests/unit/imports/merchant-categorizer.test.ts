import { describe, it, expect } from "vitest";
import { categorizeMerchant, KnownCategory } from "../../../src/imports/engine/merchant-categorizer";

describe("categorizeMerchant", () => {
  it("returns Uncategorized for null or unrecognized merchants", () => {
    expect(categorizeMerchant(null)).toBe(KnownCategory.UNCATEGORIZED);
    expect(categorizeMerchant("Some Random Kiosk LLC")).toBe(KnownCategory.UNCATEGORIZED);
  });

  it("is case-insensitive", () => {
    expect(categorizeMerchant("CARREFOUR MARKET")).toBe(KnownCategory.GROCERIES);
  });

  const cases: [string, KnownCategory][] = [
    ["Spinneys Umm Suqeim", KnownCategory.GROCERIES],
    ["Deliveroo UAE", KnownCategory.FOOD_DELIVERY],
    ["Salik Toll Recharge", KnownCategory.TRANSPORT],
    ["ADNOC Station 245", KnownCategory.FUEL],
    ["POSTPAY INSTALLMENT", KnownCategory.BNPL],
    ["Starbucks Dubai Mall", KnownCategory.DINING],
    ["ADCB Funds Transfer", KnownCategory.TRANSFERS],
    ["Amazon.ae", KnownCategory.SHOPPING],
    ["DEWA Bill Payment", KnownCategory.TELECOM_UTILITIES],
    ["Aster Pharmacy Al Barsha", KnownCategory.HEALTH],
    ["Netflix.com", KnownCategory.ENTERTAINMENT],
  ];

  it.each(cases)("categorizes %s as %s", (merchant, expected) => {
    expect(categorizeMerchant(merchant)).toBe(expected);
  });

  it("keeps the original Emirates NBD / ENBD transfer matches intact", () => {
    expect(categorizeMerchant("EMIRATES NBD")).toBe(KnownCategory.TRANSFERS);
    expect(categorizeMerchant("ENBD Internal Transfer")).toBe(KnownCategory.TRANSFERS);
  });
});
