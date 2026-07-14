/**
 * GET /api/imports/salary-status
 *
 * Returns the salary import status for the current month.
 * Used by the dashboard Salary Status card.
 *
 * Status values:
 *   "waiting"          — no salary processed this month (within grace period)
 *   "review_required"  — a salary SMS is pending user review
 *   "received"         — salary imported and confirmed
 *   "late"             — past payday + 2 grace days with no salary
 *   "disabled"         — import engine not enabled
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportStatus } from "@prisma/client";
import { getDubaiCurrentDate, getDubaiMonthRange } from "@/lib/dates";

const GRACE_DAYS = 2;
const DUBAI_OFFSET_HOURS = 4;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [importSetting, settings] = await Promise.all([
    db.importSetting.findUnique({
      where: { userId },
      select: { enabled: true, autoImportSalary: true },
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
        latestImport: null,
        expectedPayday: null,
        importEnabled: false,
        autoImportEnabled: false,
      },
    });
  }

  // Current month in Dubai time
  const today = getDubaiCurrentDate();
  const monthStr = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const { start, nextMonthStart } = getDubaiMonthRange(monthStr);

  const latestImport = await db.importedTransaction.findFirst({
    where: {
      userId,
      status: { in: [ImportStatus.PROCESSED, ImportStatus.REVIEW_REQUIRED] },
      receivedAt: { gte: start, lt: nextMonthStart },
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
      transactionId: true,
    },
  });

  // Compute expected payday and late status
  let expectedPayday: string | null = null;
  let isLate = false;

  if (settings?.payday) {
    const daysInMonth = new Date(
      Date.UTC(today.year, today.month, 0)
    ).getUTCDate();
    const paydayDay = Math.min(settings.payday, daysInMonth);

    // Payday date as UTC midnight of Dubai local date
    const paydayUTC = new Date(
      Date.UTC(today.year, today.month - 1, paydayDay) -
        DUBAI_OFFSET_HOURS * 60 * 60 * 1000
    );
    // Format as YYYY-MM-DD using Dubai local date
    expectedPayday = `${today.year}-${String(today.month).padStart(2, "0")}-${String(paydayDay).padStart(2, "0")}`;

    // Grace cutoff = payday + GRACE_DAYS
    const graceCutoffMs =
      paydayUTC.getTime() +
      GRACE_DAYS * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    if (!latestImport && nowMs > graceCutoffMs && today.day > paydayDay + GRACE_DAYS) {
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
            transactionId: latestImport.transactionId,
          }
        : null,
      expectedPayday,
      importEnabled: importSetting.enabled,
      autoImportEnabled: importSetting.autoImportSalary,
    },
  });
}
