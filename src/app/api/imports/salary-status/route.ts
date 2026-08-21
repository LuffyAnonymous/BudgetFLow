/**
 * GET /api/imports/salary-status
 *
 * Returns the salary import status for a specified budget month (defaults to current Dubai month).
 * Used by the dashboard Salary Status card.
 *
 * Status values:
 *   "waiting"          — no salary processed for this budget month (within grace period)
 *   "review_required"  — a salary SMS is pending user review
 *   "received"         — salary imported and confirmed
 *   "late"             — past payday + 2 grace days with no salary for this budget month
 *   "disabled"         — import engine not enabled
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportStatus } from "@prisma/client";
import { getDubaiCurrentDate, getDubaiMonthRange } from "@/lib/dates";

const GRACE_DAYS = 2;
const DUBAI_OFFSET_HOURS = 4;

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const requestedMonth = searchParams.get("month");

  const today = getDubaiCurrentDate();
  const currentMonthStr = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const monthStr = (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth))
    ? requestedMonth
    : currentMonthStr;

  const { start, nextMonthStart } = getDubaiMonthRange(monthStr);
  const [targetYear, targetMonth] = monthStr.split("-").map(Number);

  const [importSetting, settings] = await Promise.all([
    db.importSetting.findUnique({
      where: { userId },
      select: { enabled: true },
    }),
    db.setting.findUnique({
      where: { userId },
      select: { payday: true },
    }),
  ]);

  if (!importSetting?.enabled) {
    return NextResponse.json({
      data: {
        status: "disabled",
        month: monthStr,
        latestImport: null,
        expectedPayday: null,
        importEnabled: false,
      },
    });
  }

  // Query salary import matching the specified budgetMonth (or un-attributed in calendar range)
  const latestImport = await db.importedTransaction.findFirst({
    where: {
      userId,
      status: { in: [ImportStatus.PROCESSED, ImportStatus.REVIEW_REQUIRED] },
      OR: [
        { budgetMonth: monthStr },
        {
          budgetMonth: null,
          receivedAt: { gte: start, lt: nextMonthStart },
        },
      ],
    },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      status: true,
      parsedAmount: true,
      parsedCurrency: true,
      institution: true,
      source: true,
      receivedAt: true,
      financialDate: true,
      budgetMonth: true,
      transactionId: true,
    },
  });

  // Compute expected payday and late status
  let expectedPayday: string | null = null;
  let isLate = false;

  if (settings?.payday) {
    const daysInMonth = new Date(
      Date.UTC(targetYear, targetMonth, 0)
    ).getUTCDate();
    const paydayDay = Math.min(settings.payday, daysInMonth);

    const paydayUTC = new Date(
      Date.UTC(targetYear, targetMonth - 1, paydayDay) -
        DUBAI_OFFSET_HOURS * 60 * 60 * 1000
    );
    expectedPayday = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(paydayDay).padStart(2, "0")}`;

    const graceCutoffMs = paydayUTC.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    const isPastMonth = targetYear < today.year || (targetYear === today.year && targetMonth < today.month);
    const isCurrentMonthPastGrace = targetYear === today.year && targetMonth === today.month && nowMs > graceCutoffMs && today.day > paydayDay + GRACE_DAYS;

    if (!latestImport && (isPastMonth || isCurrentMonthPastGrace)) {
      isLate = true;
    }
  }

  let status: "waiting" | "review_required" | "received" | "late";
  if (!latestImport) {
    status = isLate ? "late" : "waiting";
  } else if (latestImport.status === ImportStatus.REVIEW_REQUIRED) {
    status = "review_required";
  } else {
    status = "received";
  }

  return NextResponse.json({
    data: {
      status,
      month: monthStr,
      latestImport: latestImport
        ? {
            id: latestImport.id,
            status: latestImport.status,
            amount: latestImport.parsedAmount?.toString() ?? null,
            currency: latestImport.parsedCurrency,
            institution: latestImport.institution,
            source: latestImport.source,
            receivedAt: latestImport.receivedAt,
            financialDate: latestImport.financialDate,
            budgetMonth: latestImport.budgetMonth,
            transactionId: latestImport.transactionId,
          }
        : null,
      expectedPayday,
      importEnabled: importSetting.enabled,
    },
  });
}
