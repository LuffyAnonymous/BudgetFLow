import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";

// Mocking/testing pure function calculation rules
describe("Remittance & Reporting Unit Calculations", () => {
  describe("PHP Received Amount & Outflow Calculations", () => {
    it("should calculate PHP amount exactly using ROUND_HALF_UP to 2 decimal places", () => {
      const amountSent = new Decimal("700.00");
      const exchangeRate = new Decimal("15.201234");
      
      // raw = 700 * 15.201234 = 10640.8638
      // ROUND_HALF_UP to 2 decimals = 10640.86
      const amountReceivedPhp = amountSent.mul(exchangeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      expect(amountReceivedPhp.toFixed(2)).toBe("10640.86");
    });

    it("should round half up properly", () => {
      const amountSent = new Decimal("1.00");
      const rateUp = new Decimal("15.205");
      const rateDown = new Decimal("15.204");

      const phpUp = amountSent.mul(rateUp).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const phpDown = amountSent.mul(rateDown).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      expect(phpUp.toFixed(2)).toBe("15.21");
      expect(phpDown.toFixed(2)).toBe("15.20");
    });

    it("should compute total cash outflow in AED", () => {
      const amountSent = new Decimal("700.00");
      const fee = new Decimal("15.00");
      const totalOutflow = amountSent.add(fee);
      expect(totalOutflow.toFixed(2)).toBe("715.00");
    });
  });

  describe("CSV Security & Escaping Rules", () => {
    const dangerousPrefixes = ["=", "+", "-", "@", "\t", "\r"];

    function escapeCSVValue(val: string): string {
      let str = val;
      if (dangerousPrefixes.some((char) => str.startsWith(char))) {
        str = "'" + str;
      }
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        str = '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    it("should escape dangerous prefixes with a single quote", () => {
      expect(escapeCSVValue("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(escapeCSVValue("+1234")).toBe("'+1234");
      expect(escapeCSVValue("-50.22")).toBe("'-50.22");
      expect(escapeCSVValue("@GCash")).toBe("'@GCash");
    });

    it("should double escape embedded double quotes and wrap in quotes", () => {
      expect(escapeCSVValue('GCash "Promo"')).toBe('"GCash ""Promo"""');
    });

    it("should wrap values with commas in double quotes", () => {
      expect(escapeCSVValue("GCash, GCash PRO")).toBe('"GCash, GCash PRO"');
    });

    it("should combine escaping (dangerous prefix + comma)", () => {
      expect(escapeCSVValue("=SUM(1,2)")).toBe('"\'=SUM(1,2)"');
    });
  });

  describe("Historical Carry-Forward Balances Logic", () => {
    // Standard mock algorithm to test logic
    const monthsList = ["2026-01", "2026-02", "2026-03", "2026-04"];
    
    interface MockPayment {
      paymentDateMonth: string;
      balanceBefore: number;
      balanceAfter: number;
    }

    function reconstructBalances(currentBalance: number, payments: MockPayment[]): Record<string, number> {
      const balances: Record<string, number> = {};
      
      monthsList.forEach((mStr) => {
        const paymentsInMonth = payments.filter((p) => p.paymentDateMonth === mStr);
        if (paymentsInMonth.length > 0) {
          balances[mStr] = paymentsInMonth[paymentsInMonth.length - 1].balanceAfter;
        } else {
          const paymentsAfter = payments.filter((p) => p.paymentDateMonth > mStr);
          if (paymentsAfter.length > 0) {
            balances[mStr] = paymentsAfter[0].balanceBefore;
          } else {
            balances[mStr] = currentBalance;
          }
        }
      });
      return balances;
    }

    it("should carry forward last known balance and reconstruct backward correctly", () => {
      // payments:
      // Month 1 (2026-01): payment, leaves balanceAfter = 800 (starts at 1000)
      // Month 3 (2026-03): payment, leaves balanceAfter = 600 (starts at 800)
      const currentBalance = 600;
      const payments: MockPayment[] = [
        { paymentDateMonth: "2026-01", balanceBefore: 1000, balanceAfter: 800 },
        { paymentDateMonth: "2026-03", balanceBefore: 800, balanceAfter: 600 },
      ];

      const result = reconstructBalances(currentBalance, payments);

      // Month 1 should have payment balanceAfter = 800
      expect(result["2026-01"]).toBe(800);
      // Month 2 should carry forward Month 1's balanceAfter (which is Month 3's balanceBefore = 800)
      expect(result["2026-02"]).toBe(800);
      // Month 3 should have payment balanceAfter = 600
      expect(result["2026-03"]).toBe(600);
      // Month 4 has no payments after, should use currentBalance = 600
      expect(result["2026-04"]).toBe(600);
    });
  });
});
