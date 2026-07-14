import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { NotificationSeverity, NotificationType } from "@prisma/client";
import { getLocalDateMidnight, formatLocalDateString } from "@/server/services/recurring.service";

describe("Milestone 5 Unit Calculations & Rules", () => {
  describe("Timezone Date Handling & Short Month Boundaries", () => {
    const tz = "Asia/Dubai";

    it("should calculate correct local midnight for standard dates", () => {
      const date = getLocalDateMidnight(2026, 7, 11, tz);
      // Dubai is UTC+4. Local midnight 2026-07-11 00:00 is 2026-07-10 20:00 UTC
      expect(date.toISOString()).toBe("2026-07-10T20:00:00.000Z");
    });

    it("should wrap to the last valid day of short months (February standard and leap)", () => {
      // 2026 is non-leap, so February has 28 days
      const maxDays2026 = new Date(Date.UTC(2026, 2, 0)).getUTCDate();
      expect(maxDays2026).toBe(28);

      const dueDay31 = Math.min(31, maxDays2026);
      const dateFeb2026 = getLocalDateMidnight(2026, 2, dueDay31, tz);
      expect(formatLocalDateString(dateFeb2026, tz)).toBe("2026-02-28");

      // 2028 is a leap year, so February has 29 days
      const maxDays2028 = new Date(Date.UTC(2028, 2, 0)).getUTCDate();
      expect(maxDays2028).toBe(29);

      const dueDay31Leap = Math.min(31, maxDays2028);
      const dateFeb2028 = getLocalDateMidnight(2028, 2, dueDay31Leap, tz);
      expect(formatLocalDateString(dateFeb2028, tz)).toBe("2028-02-29");
    });
  });

  describe("Deterministic Occurrence & Notification Event Keys", () => {
    it("should produce a stable deterministic key for recurring occurrence", () => {
      const templateId = "template-abc-123";
      const dateStr = "2026-07-31";
      const idempotencyKey = `recurring:${templateId}:${dateStr}`;
      expect(idempotencyKey).toBe("recurring:template-abc-123:2026-07-31");
    });

    it("should generate stable notification event keys for different types", () => {
      const budgetId = "b-123";
      const debtId = "d-456";
      const activeMonthStr = "2026-07";

      const nearLimitKey = `budget-near-limit:${budgetId}:${activeMonthStr}`;
      const exceededKey = `budget-exceeded:${budgetId}:${activeMonthStr}`;
      const debtDueKey = `debt-due:${debtId}:2026-07-25`;

      expect(nearLimitKey).toBe("budget-near-limit:b-123:2026-07");
      expect(exceededKey).toBe("budget-exceeded:b-123:2026-07");
      expect(debtDueKey).toBe("debt-due:d-456:2026-07-25");
    });
  });

  describe("Rule-Based Notification Severity Rules", () => {
    function getSeverity(type: NotificationType): NotificationSeverity {
      switch (type) {
        case NotificationType.ROLLOVER_AVAILABLE:
        case NotificationType.RECURRING_ENTRY_CREATED:
        case NotificationType.SAVINGS_GOAL_REACHED:
          return NotificationSeverity.INFO;
        case NotificationType.UPCOMING_PAYMENT:
        case NotificationType.PAYMENT_DUE_TODAY:
        case NotificationType.BUDGET_NEAR_LIMIT:
          return NotificationSeverity.WARNING;
        case NotificationType.OVERDUE_PAYMENT:
        case NotificationType.BUDGET_EXCEEDED:
          return NotificationSeverity.CRITICAL;
        default:
          return NotificationSeverity.INFO;
      }
    }

    it("should return correct severity for info events", () => {
      expect(getSeverity(NotificationType.ROLLOVER_AVAILABLE)).toBe(NotificationSeverity.INFO);
      expect(getSeverity(NotificationType.SAVINGS_GOAL_REACHED)).toBe(NotificationSeverity.INFO);
    });

    it("should return correct severity for warning events", () => {
      expect(getSeverity(NotificationType.BUDGET_NEAR_LIMIT)).toBe(NotificationSeverity.WARNING);
      expect(getSeverity(NotificationType.PAYMENT_DUE_TODAY)).toBe(NotificationSeverity.WARNING);
    });

    it("should return correct severity for critical events", () => {
      expect(getSeverity(NotificationType.BUDGET_EXCEEDED)).toBe(NotificationSeverity.CRITICAL);
      expect(getSeverity(NotificationType.OVERDUE_PAYMENT)).toBe(NotificationSeverity.CRITICAL);
    });
  });

  describe("Rollover Unallocated Amount Calculations", () => {
    it("should calculate unallocated salary amount correctly", () => {
      const plannedSalary = new Decimal("12000.00");
      const allocations = [
        new Decimal("3500.00"), // rent
        new Decimal("1200.00"), // food
        new Decimal("800.00"),  // car
        new Decimal("2000.00"), // savings
        new Decimal("1500.00"), // remittance
      ];

      const totalAllocated = allocations.reduce((sum, val) => sum.plus(val), new Decimal(0));
      expect(totalAllocated.toFixed(2)).toBe("9000.00");

      const unallocated = Decimal.max(0, plannedSalary.minus(totalAllocated));
      expect(unallocated.toFixed(2)).toBe("3000.00");
    });
  });
});
