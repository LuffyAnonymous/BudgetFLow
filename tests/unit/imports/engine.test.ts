import { describe, it, expect } from "vitest";
import { AccountType } from "@prisma/client";
import { resolveInstitution } from "../../../src/imports/engine/sender-normalizer";
import { classifyDirection, TransactionDirection } from "../../../src/imports/engine/direction-classifier";
import { categorizeMerchant, KnownCategory } from "../../../src/imports/engine/merchant-categorizer";

describe("Import Engine Core Modules", () => {
  describe("Institution resolution", () => {
    it("should match Emirates NBD", () => {
      expect(resolveInstitution("EmiratesNBD").accountType).toBe(AccountType.EMIRATES_NBD);
      expect(resolveInstitution("ENBD").accountType).toBe(AccountType.EMIRATES_NBD);
    });

    it("should match other known UAE banks and BNPL/wallet senders", () => {
      expect(resolveInstitution("ADCB").accountType).toBe(AccountType.ADCB);
      expect(resolveInstitution("FAB").accountType).toBe(AccountType.FAB);
      expect(resolveInstitution("TABBY").accountType).toBe(AccountType.TABBY);
      expect(resolveInstitution("TAMARA").accountType).toBe(AccountType.TAMARA);
      expect(resolveInstitution("BOTIM").accountType).toBe(AccountType.BOTIM);
    });

    it("should fall back to OTHER_BANK with a derived name for an unrecognized sender, never null", () => {
      const allCaps = resolveInstitution("SOMENEWBANK");
      expect(allCaps.accountType).toBe(AccountType.OTHER_BANK);
      expect(allCaps.displayName).toBe("Somenewbank");

      // Already-readable mixed-case sender IDs are passed through as-is.
      const mixedCase = resolveInstitution("SomeNewBank");
      expect(mixedCase.accountType).toBe(AccountType.OTHER_BANK);
      expect(mixedCase.displayName).toBe("SomeNewBank");
    });
  });

  describe("Direction Classifier", () => {
    it("should classify purchases as OUTFLOW", () => {
      expect(classifyDirection("AED 100 debited for Transfer")).toBe(TransactionDirection.OUTFLOW);
      expect(classifyDirection("Amount withdrawn from ATM")).toBe(TransactionDirection.OUTFLOW);
    });

    it("should classify salary as INFLOW", () => {
      expect(classifyDirection("Salary of AED 5000 credited")).toBe(TransactionDirection.INFLOW);
    });

    it("should classify declined/OTP messages", () => {
      expect(classifyDirection("Transaction declined due to insufficient limit")).toBe(TransactionDirection.DECLINED);
      expect(classifyDirection("Your OTP is 123456")).toBe(TransactionDirection.INFORMATIONAL);
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
