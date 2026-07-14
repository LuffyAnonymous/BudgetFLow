const DUBAI_OFFSET_HOURS = 4;

/**
 * Validates and parses a canonical month string in YYYY-MM format.
 * Returns a Date representing the first day of the month at UTC midnight.
 * Throws an error for invalid values (e.g. "2026-13", "July-2026", empty strings).
 */
export function parseCanonicalMonth(yearMonth: string): Date {
  if (!yearMonth) {
    throw new Error("Month is required.");
  }
  
  const regex = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!regex.test(yearMonth)) {
    throw new Error(`Invalid month format. Expected YYYY-MM, got: "${yearMonth}"`);
  }
  
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed for Date.UTC
  
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

/**
 * Converts a canonical Date (representing UTC midnight of first of month) back to YYYY-MM string.
 */
export function formatCanonicalMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Converts a month YYYY-MM into an exact UTC range [start, nextMonthStart) 
 * adjusted for the Asia/Dubai (UTC+4) timezone.
 * 
 * - start: July 1 00:00:00 Dubai time -> June 30 20:00:00 UTC
 * - nextMonthStart: Aug 1 00:00:00 Dubai time -> July 31 20:00:00 UTC
 */
export function getDubaiMonthRange(yearMonth: string): { start: Date; nextMonthStart: Date } {
  const date = parseCanonicalMonth(yearMonth);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed

  // Start of the month in Dubai local time (00:00:00)
  const localStart = Date.UTC(year, month, 1, 0, 0, 0, 0);
  // Subtract 4 hours to convert to UTC
  const start = new Date(localStart - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);

  // First day of next month in Dubai local time (00:00:00)
  const localNextMonthStart = Date.UTC(year, month + 1, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(localNextMonthStart - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);

  return { start, nextMonthStart };
}

/**
 * Returns the current date components (year, month, day) in the Asia/Dubai timezone.
 */
export function getDubaiCurrentDate(date: Date = new Date()): { year: number; month: number; day: number } {
  // Adjust time by adding 4 hours to represent Dubai local time
  const adjusted = new Date(date.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: adjusted.getUTCFullYear(),
    month: adjusted.getUTCMonth() + 1, // 1-indexed
    day: adjusted.getUTCDate(),
  };
}

/**
 * Returns the remaining calendar days in the current month in Asia/Dubai timezone,
 * including today.
 */
export function getRemainingDaysInMonthDubai(date: Date = new Date()): number {
  const { year, month, day } = getDubaiCurrentDate(date);
  
  // Get last day of the current month in UTC
  // month in JS Date is 0-indexed, so passing month (which is 1-indexed) as month index
  // with day 0 returns the last day of the previous month.
  // E.g. month = 7 (July). UTC(2026, 7, 0) gives August 0th -> July 31st.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  
  return lastDay - day + 1;
}

/**
 * Parses YYYY-MM-DD string into a UTC Date object at midnight.
 */
export function parseYYYYMMDD(str: string): Date {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(str)) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD, got: "${str}"`);
  }
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Formats a Date object as YYYY-MM-DD string using UTC components.
 */
export function formatYYYYMMDD(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Safely computes the valid year/month/day components for a given dueDay.
 */
export function getValidDateForDay(year: number, month: number, dueDay: number): { year: number; month: number; day: number } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return { year, month, day };
}

/**
 * Computes next payment date and overdue status.
 */
export function calculateNextPaymentDate(
  dueDay: number,
  hasPaymentThisMonth: boolean,
  currentDateDubai: { year: number; month: number; day: number }
): { date: Date; isOverdue: boolean } {
  const { year, month, day } = currentDateDubai;

  // Due date for this month
  const thisMonthDue = getValidDateForDay(year, month, dueDay);
  const thisMonthDueDate = new Date(Date.UTC(thisMonthDue.year, thisMonthDue.month - 1, thisMonthDue.day));

  if (hasPaymentThisMonth) {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const nextMonthDue = getValidDateForDay(nextYear, nextMonth, dueDay);
    const nextMonthDueDate = new Date(Date.UTC(nextMonthDue.year, nextMonthDue.month - 1, nextMonthDue.day));
    return { date: nextMonthDueDate, isOverdue: false };
  } else {
    const todayDate = new Date(Date.UTC(year, month - 1, day));
    if (todayDate.getTime() > thisMonthDueDate.getTime()) {
      return { date: thisMonthDueDate, isOverdue: true };
    } else {
      return { date: thisMonthDueDate, isOverdue: false };
    }
  }
}
