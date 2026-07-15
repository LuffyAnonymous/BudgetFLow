import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeSender, SupportedBank } from "../../../src/imports/engine/sender-normalizer";
import { classifyDirection, TransactionDirection } from "../../../src/imports/engine/direction-classifier";
import { categorizeMerchant, KnownCategory } from "../../../src/imports/engine/merchant-categorizer";
import { evaluateConfidence } from "../../../src/imports/engine/confidence-evaluator";

describe("Import Engine Core Modules", () => {
  describe("Sender Normalizer", () => {
    it("should match Mashreq", () => {
      expect(normalizeSender("MASHREQ")).toBe(SupportedBank.MASHREQ);
      expect(normalizeSender("MashreqBank")).toBe(SupportedBank.MASHREQ);
    });

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
      expect(classifyDirection("Purchase of AED 100 at Carrefour", SupportedBank.MASHREQ)).toBe(TransactionDirection.OUTFLOW);
      expect(classifyDirection("AED 100 debited for Transfer", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.OUTFLOW);
      expect(classifyDirection("Amount withdrawn from ATM", SupportedBank.MASHREQ)).toBe(TransactionDirection.OUTFLOW);
    });

    it("should classify salary as INFLOW", () => {
      expect(classifyDirection("Salary of AED 5000 credited", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.INFLOW);
      expect(classifyDirection("Refund of AED 50 deposited", SupportedBank.MASHREQ)).toBe(TransactionDirection.INFLOW);
    });

    it("should classify declined/OTP messages", () => {
      expect(classifyDirection("Transaction declined due to insufficient limit", SupportedBank.MASHREQ)).toBe(TransactionDirection.DECLINED);
      expect(classifyDirection("Your OTP is 123456", SupportedBank.EMIRATES_NBD)).toBe(TransactionDirection.INFORMATIONAL);
    });
  });

  describe("Merchant Categorizer", () => {
    it("should map known merchants", () => {
      expect(categorizeMerchant("Carrefour")).toBe(KnownCategory.GROCERIES);
      expect(categorizeMerchant("Talabat")).toBe(KnownCategory.FOOD_DELIVERY);
      expect(categorizeMerchant("Uber")).toBe(KnownCategory.TRANSPORT);
      expect(categorizeMerchant("Tabby")).toBe(KnownCategory.BNPL);
    });

    it("should fallback to UNCATEGORIZED", () => {
      expect(categorizeMerchant("Random Shop")).toBe(KnownCategory.UNCATEGORIZED);
      expect(categorizeMerchant(null)).toBe(KnownCategory.UNCATEGORIZED);
    });
  });

  describe("Confidence Evaluator", () => {
    it("should return high confidence for fully matched known transactions", () => {
      const score = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, true, true);
      expect(score).toBe(100);
    });

    it("should drop confidence for missing reference or balance", () => {
      const score = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, false, false);
      expect(score).toBe(85); // 100 - 10 (balance) - 5 (reference)
    });

    it("should drop confidence below 70 for uncategorized merchant without reference/balance", () => {
      const score = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.UNCATEGORIZED, false, false);
      expect(score).toBe(50); // 100 - 35 (uncat) - 10 (bal) - 5 (ref) -> Review Required
    });

    it("should return absolute 0 if amount is not found", () => {
      const score = evaluateConfidence(false, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, true, true);
      expect(score).toBe(0);
    });
  });
});
