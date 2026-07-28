/**
 * src/lib/salary-month.ts
 *
 * Utilities for determining the reporting/budget month (YYYY-MM) for transactions,
 * specifically handling early/end-of-month salary attribution.
 */

/**
 * Determines the budget/reporting month (YYYY-MM) for a transaction date.
 * If isSalary is true and the date falls on or after day 20 of the month,
 * the reporting month defaults to the following calendar month (YYYY-MM).
 *
 * Examples:
 *   - 28 July 2026 (isSalary = true)  => "2026-08"
 *   - 15 July 2026 (isSalary = true)  => "2026-07"
 *   - 28 July 2026 (isSalary = false) => "2026-07"
 */
export function determineBudgetMonth(date: Date, isSalary: boolean = false): string {
  const d = new Date(date);
  
  // Use Dubai timezone (UTC+4) or UTC for local date components
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed (0 = Jan, 6 = Jul)
  const day = d.getUTCDate();

  if (isSalary && day >= 20) {
    // Increment month to next month
    const nextMonthDate = new Date(Date.UTC(year, month + 1, 1));
    const nextYear = nextMonthDate.getUTCFullYear();
    const nextMonth = nextMonthDate.getUTCMonth() + 1; // 1-indexed
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  }

  const currentYear = year;
  const currentMonth = month + 1;
  return `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
}

/**
 * Helper to validate YYYY-MM month string format.
 */
export function isValidMonthStr(monthStr: string): boolean {
  return /^\d{4}-\d{2}$/.test(monthStr);
}
