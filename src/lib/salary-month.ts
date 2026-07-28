/**
 * src/lib/salary-month.ts
 *
 * Utilities for determining the reporting/budget month (YYYY-MM) for transactions,
 * specifically handling early salary attribution and active financial cycles.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Determines the budget/reporting month (YYYY-MM) for a salary or regular transaction date.
 * If isSalary is true and the date falls on or after day 20 of the month,
 * the reporting month defaults to the following calendar month (YYYY-MM).
 */
export function determineBudgetMonth(date: Date, isSalary: boolean = false): string {
  const d = new Date(date);
  
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  if (isSalary && day >= 20) {
    const nextMonthDate = new Date(Date.UTC(year, month + 1, 1));
    const nextYear = nextMonthDate.getUTCFullYear();
    const nextMonth = nextMonthDate.getUTCMonth() + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  }

  const currentYear = year;
  const currentMonth = month + 1;
  return `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
}

/**
 * Gets the active financial cycle (budgetMonth string YYYY-MM) for a user.
 * Accepts optional Prisma TransactionClient to safely query within db.$transaction blocks.
 * 
 * Future transaction rule:
 * Once a salary assigned to a future budget month is received (or created),
 * that budget month becomes the active financial cycle.
 * Every transaction created after that salary defaults to the same budgetMonth
 * until the next salary cycle begins.
 */
export async function getActiveFinancialCycle(
  userId: string,
  targetDate: Date = new Date(),
  client: Prisma.TransactionClient | typeof db = db
): Promise<string> {
  const defaultMonth = determineBudgetMonth(targetDate, false);

  try {
    const latestSalaryTx = await client.transaction.findFirst({
      where: {
        userId,
        budgetMonth: { not: null },
        date: { lte: targetDate },
        type: "INCOME",
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { budgetMonth: true },
    });

    if (latestSalaryTx?.budgetMonth && latestSalaryTx.budgetMonth >= defaultMonth) {
      return latestSalaryTx.budgetMonth;
    }

    const latestSalaryImp = await client.importedTransaction.findFirst({
      where: {
        userId,
        budgetMonth: { not: null },
        receivedAt: { lte: targetDate },
        status: { in: ["PROCESSED", "REVIEW_REQUIRED"] },
      },
      orderBy: { receivedAt: "desc" },
      select: { budgetMonth: true },
    });

    if (latestSalaryImp?.budgetMonth && latestSalaryImp.budgetMonth >= defaultMonth) {
      return latestSalaryImp.budgetMonth;
    }
  } catch (err) {
    console.error("Error determining active financial cycle:", err);
  }

  return defaultMonth;
}

/**
 * Helper to validate YYYY-MM month string format.
 */
export function isValidMonthStr(monthStr: string): boolean {
  return /^\d{4}-\d{2}$/.test(monthStr);
}
