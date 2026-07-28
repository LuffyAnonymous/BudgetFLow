import { describe, it, expect } from "vitest";
import { normalizeSender, SupportedBank } from "../../../src/imports/engine/sender-normalizer";
import { classifyDirection, TransactionDirection } from "../../../src/imports/engine/direction-classifier";
import { categorizeMerchant, KnownCategory } from "../../../src/imports/engine/merchant-categorizer";

describe("Import Engine Core Modules", () => {
  describe("Sender Normalizer", () => {
    it("should match Emirates NBD", () => {
      expect(normalizeSender("EmiratesNBD")).toBe(SupportedBank.EMIRATES_NBD);
      expect(normalizeSender("ENBD")).toBe(SupportedBank.EMIRATES_NBD);
    });

    it("should return null for unknown sender", () => {
      expect(normalizeSender("ADCB")).toBeNull();
    });
  });

  describe("Direction Classifier", () => {
    it("should classify purchases as OUTFLOW", () => {
      expect(classifyDirection("AED 100 debited for Transfer", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.OUTFLOW);
      expect(classifyDirection("Amount withdrawn from ATM", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.OUTFLOW);
    });

    it("should classify salary as INFLOW", () => {
      expect(classifyDirection("Salary of AED 5000 credited", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.INFLOW);
    });

    it("should classify declined/OTP messages", () => {
      expect(classifyDirection("Transaction declined due to insufficient limit", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.DECLINED);
      expect(classifyDirection("Your OTP is 123456", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.INFORMATIONAL);
    });
  });

  describe("Merchant Categorizer", () => {
    it("should map known merchants", () => {
      expect(categorizeMerchant("Carrefour")).toBe(KnownCategory.GROCERIES);
      expect(categorizeMerchant("Talabat")).toBe(KnownCategory.FOOD_DELIVERY);
      expect(categorizeMerchant("ENBD")).toBe(KnownCategory.TRANSFERS);
      expect(categorizeMerchant("Unknown Shop")).toBe(KnownCategory.UNCATEGORIZED);
    });
  });
});
