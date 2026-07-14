import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { calculateNextPaymentDate, parseYYYYMMDD, formatYYYYMMDD } from "@/lib/dates";

describe("Milestone 3 Unit Tests", () => {
  describe("Rollover Fee & Projection Math", () => {
    it("should calculate rollover fee only after payment is subtracted", async () => {
      // Starting balance: AED 8,284.58
      // Payment: AED 828
      // Remaining after payment: AED 7,456.58
      // Estimated fee: 7,456.58 * 4.5% = 335.5461
      // Projected ending: remaining + fee = 7,792.1261
      const currentBalance = new Decimal("8284.58");
      const payment = new Decimal("828.00");
      const rolloverRate = new Decimal("4.50");

      const remaining = currentBalance.minus(payment);
      expect(remaining.toFixed(2)).toBe("7456.58");

      const fee = remaining.mul(rolloverRate.div(100));
      expect(fee.toFixed(4)).toBe("335.5461");

      const ending = remaining.plus(fee);
      expect(ending.toFixed(4)).toBe("7792.1261");
    });

    it("should handle a zero-fee debt correctly", () => {
      const currentBalance = new Decimal("700.00");
      const payment = new Decimal("250.00");
      const rolloverRate = new Decimal("0.00");

      const remaining = currentBalance.minus(payment);
      const fee = remaining.mul(rolloverRate.div(100));
      expect(fee.isZero()).toBe(true);

      const ending = remaining.plus(fee);
      expect(ending.toFixed(2)).toBe("450.00");
    });
  });

  describe("Calendar Date Parsing & Formatting", () => {
    it("should parse and format date-only strings consistently in UTC midnight", () => {
      const dateStr = "2026-07-25";
      const parsed = parseYYYYMMDD(dateStr);
      
      expect(parsed.getUTCFullYear()).toBe(2026);
      expect(parsed.getUTCMonth()).toBe(6); // July (0-indexed)
      expect(parsed.getUTCDate()).toBe(25);
      expect(parsed.getUTCHours()).toBe(0);

      const formatted = formatYYYYMMDD(parsed);
      expect(formatted).toBe(dateStr);
    });
  });

  describe("Next Due Date Calculations", () => {
    const dubaiNowBase = { year: 2026, month: 7, day: 11 }; // July 11, 2026

    it("should compute correctly for day 28 (not paid this month)", () => {
      const res = calculateNextPaymentDate(28, false, dubaiNowBase);
      expect(formatYYYYMMDD(res.date)).toBe("2026-07-28");
      expect(res.isOverdue).toBe(false);
    });

    it("should compute correctly for day 28 (already paid this month)", () => {
      const res = calculateNextPaymentDate(28, true, dubaiNowBase);
      expect(formatYYYYMMDD(res.date)).toBe("2026-08-28");
      expect(res.isOverdue).toBe(false);
    });

    it("should compute correctly for day 31 in November (30 days)", () => {
      const dubaiNowNov = { year: 2026, month: 11, day: 15 };
      const res = calculateNextPaymentDate(31, false, dubaiNowNov);
      // November only has 30 days, so day 31 snaps to Nov 30
      expect(formatYYYYMMDD(res.date)).toBe("2026-11-30");
      expect(res.isOverdue).toBe(false);
    });

    it("should compute correctly for day 31 in February (28 days)", () => {
      const dubaiNowFeb = { year: 2026, month: 2, day: 15 };
      const res = calculateNextPaymentDate(31, false, dubaiNowFeb);
      // February 2026 has 28 days, so day 31 snaps to Feb 28
      expect(formatYYYYMMDD(res.date)).toBe("2026-02-28");
      expect(res.isOverdue).toBe(false);
    });

    it("should detect overdue payments when current date is past due day", () => {
      const res = calculateNextPaymentDate(5, false, dubaiNowBase); // dueDay 5, today is 11
      expect(formatYYYYMMDD(res.date)).toBe("2026-07-05");
      expect(res.isOverdue).toBe(true);
    });
  });
});
