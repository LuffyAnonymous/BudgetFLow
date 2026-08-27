/**
 * GET /api/imports/automation-metrics
 *
 * Consolidated automation dashboard endpoint.
 * Returns salary status, token status, import counts, and system health
 * in ONE response to avoid duplicate queries from separate components.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportStatus, ImportSource, ImportConfidence } from "@prisma/client";
import { getDubaiCurrentDate, getDubaiMonthRange } from "@/lib/dates";

const DUBAI_OFFSET_HOURS = 4;
const RECENT_FAILURE_WINDOW_HOURS = 24;
const TOKEN_EXPIRY_WARN_DAYS = 30;

type ImportHealth = "HEALTHY" | "NEEDS_REVIEW" | "NO_TOKEN" | "DISABLED";

function getCanonicalDisplayName(sender: string): string {
  const normalized = sender.trim().toUpperCase();
  if (normalized === "ENBD" || normalized === "EMIRATESNBD") return "EmiratesNBD";
  return sender.trim();
}

function toDubaiStartOfDay(date: { year: number; month: number; day: number }): Date {
  const localMs = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0);
  return new Date(localMs - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const requestedMonth = searchParams.get("month");

  // ── 1. Load settings ─────────────────────────────────────────────────────────
  const [importSetting, userSetting] = await Promise.all([
    db.importSetting.findUnique({
      where: { userId },
      select: {
        enabled: true,
        senderAllowlist: true,
        salaryCategoryId: true,
        tokenHash: true,
        tokenCreatedAt: true,
        tokenRevokedAt: true,
        tokenExpiresAt: true,
        tokenLastUsedAt: true,
        rawPayloadRetentionDays: true,
      },
    }),
    db.setting.findUnique({
      where: { userId },
      select: { payday: true },
    }),
  ]);

  // ── 2. Token health ───────────────────────────────────────────────────────────
  const hasToken = !!importSetting?.tokenHash;
  const isRevoked = !!importSetting?.tokenRevokedAt;
  const isExpired =
    !!importSetting?.tokenExpiresAt && importSetting.tokenExpiresAt < new Date();
  const isNearExpiry =
    !isExpired &&
    !!importSetting?.tokenExpiresAt &&
    importSetting.tokenExpiresAt <
      new Date(Date.now() + TOKEN_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);

  const hasActiveToken = hasToken && !isRevoked && !isExpired;

  // ── 3. Today in Dubai time ────────────────────────────────────────────────────
  const today = getDubaiCurrentDate();
  const todayStart = toDubaiStartOfDay(today);
  const recentFailureCutoff = new Date(
    Date.now() - RECENT_FAILURE_WINDOW_HOURS * 60 * 60 * 1000
  );

  // ── 4. Import counts (today) ─────────────────────────────────────────────────
  const [todayImports, pendingReview, recentFailures] = await Promise.all([
    db.importedTransaction.findMany({
      where: { userId, receivedAt: { gte: todayStart } },
      select: {
        id: true,
        status: true,
        duplicateCount: true,
        lastDuplicateAt: true,
        parsedAmount: true,
        parsedCurrency: true,
        institution: true,
        source: true,
        receivedAt: true,
        financialDate: true,
        transactionId: true,
        parserKey: true,
        confidence: true,
        directionAmbiguous: true,
      },
    }),
    // REVIEW_REQUIRED is only produced by the DOCUMENT (receipt) flow now —
    // SMS always auto-posts or fails, so this is a receipts-only queue.
    db.importedTransaction.count({
      where: { userId, status: ImportStatus.REVIEW_REQUIRED, source: ImportSource.DOCUMENT },
    }),
    db.importedTransaction.count({
      where: {
        userId,
        status: ImportStatus.FAILED,
        receivedAt: { gte: recentFailureCutoff },
      },
    }),
  ]);

  const processedToday = todayImports.filter(
    (r) => r.status === ImportStatus.PROCESSED
  ).length;
  const failedToday = todayImports.filter(
    (r) => r.status === ImportStatus.FAILED
  ).length;
  const autoImportedToday = todayImports.filter(
    (r) => r.status === ImportStatus.PROCESSED && !r.transactionId
  ).length;
  // Auto-posted today but flagged for a second look (MEDIUM/LOW confidence
  // or an ambiguous debit/credit direction) — the at-a-glance replacement
  // for the old blocking review queue, now that SMS never blocks on review.
  const needsSecondLookToday = todayImports.filter(
    (r) =>
      r.status === ImportStatus.PROCESSED &&
      (r.confidence === ImportConfidence.MEDIUM || r.confidence === ImportConfidence.LOW || r.directionAmbiguous)
  ).length;

  const importsWithDuplicateActivityToday = todayImports.filter(
    (r) =>
      r.duplicateCount > 0 &&
      r.lastDuplicateAt !== null &&
      r.lastDuplicateAt >= todayStart
  ).length;

  // ── 5. Latest import (global bank import - any time) ────────────────────────
  const latestImport = await db.importedTransaction.findFirst({
    where: {
      userId,
      status: {
        in: [ImportStatus.PROCESSED, ImportStatus.REVIEW_REQUIRED, ImportStatus.FAILED],
      },
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
      budgetMonth: true,
      transactionId: true,
      parserKey: true,
    },
  });

  // ── 6. Salary status (scoped to requested/active budget month) ───────────────
  const currentMonthStr = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const monthStr = (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth))
    ? requestedMonth
    : currentMonthStr;
  const { start: monthStart, nextMonthStart } = getDubaiMonthRange(monthStr);
  const [targetYear, targetMonth] = monthStr.split("-").map(Number);

  const salaryImport = await db.importedTransaction.findFirst({
    where: {
      userId,
      status: ImportStatus.PROCESSED,
      OR: [
        { budgetMonth: monthStr },
        {
          budgetMonth: null,
          receivedAt: { gte: monthStart, lt: nextMonthStart },
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
      receivedAt: true,
      financialDate: true,
      budgetMonth: true,
      transactionId: true,
      parsedReference: true,
    },
  });

  // Compute salary status and expected payday
  let salaryStatus: "waiting" | "received" | "late" | "disabled";
  let expectedPayday: string | null = null;
  let isLate = false;

  if (!importSetting?.enabled) {
    salaryStatus = "disabled";
  } else {
    if (userSetting?.payday) {
      const daysInMonth = new Date(
        Date.UTC(targetYear, targetMonth, 0)
      ).getUTCDate();
      const paydayDay = Math.min(userSetting.payday, daysInMonth);
      expectedPayday = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(paydayDay).padStart(2, "0")}`;
      
      const paydayUTC = new Date(
        Date.UTC(targetYear, targetMonth - 1, paydayDay) -
          DUBAI_OFFSET_HOURS * 60 * 60 * 1000
      );
      const graceCutoffMs = paydayUTC.getTime() + 2 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();

      const isPastMonth = targetYear < today.year || (targetYear === today.year && targetMonth < today.month);
      const isCurrentMonthPastGrace = targetYear === today.year && targetMonth === today.month && nowMs > graceCutoffMs && today.day > paydayDay + 2;

      if (!salaryImport && (isPastMonth || isCurrentMonthPastGrace)) {
        isLate = true;
      }
    }

    if (!salaryImport) {
      salaryStatus = isLate ? "late" : "waiting";
    } else {
      salaryStatus = "received";
    }
  }

  // ── 7. Connected institution ─────────────────────────────────────────────────
  const senderAllowlist = importSetting?.senderAllowlist ?? [];
  const parserKeys = [
    ...new Set(
      todayImports.map((r) => r.parserKey).filter(Boolean) as string[]
    ),
  ];
  const supportedInstitution =
    parserKeys.find((k) => k.includes("emirates-nbd")) ? "Emirates NBD" :
    parserKeys.find((k) => k.includes("adcb"))         ? "ADCB" :
    senderAllowlist.length > 0                          ? `Bank (sender: ${getCanonicalDisplayName(senderAllowlist[0])})` :
    null;

  // ── 8. Import health ─────────────────────────────────────────────────────────
  let importHealth: ImportHealth;
  if (!importSetting?.enabled) {
    importHealth = "DISABLED";
  } else if (!hasActiveToken) {
    importHealth = "NO_TOKEN";
  } else if (pendingReview > 0 || needsSecondLookToday > 0 || recentFailures > 0 || isNearExpiry) {
    importHealth = "NEEDS_REVIEW";
  } else {
    importHealth = "HEALTHY";
  }

  // ── 9. Build response ─────────────────────────────────────────────────────────
  return NextResponse.json({
    data: {
      importEnabled: importSetting?.enabled ?? false,

      token: {
        hasToken,
        isActive: hasActiveToken,
        isRevoked,
        isExpired,
        isNearExpiry,
        lastUsedAt: importSetting?.tokenLastUsedAt ?? null,
        expiresAt: importSetting?.tokenExpiresAt ?? null,
      },

      connectedInstitution: {
        name: supportedInstitution,
        configuredSenders: senderAllowlist.map(getCanonicalDisplayName),
        parserKeys,
      },

      todayStats: {
        total: todayImports.length,
        processed: processedToday,
        failed: failedToday,
        importsWithDuplicateActivityToday,
        reviewRequired: todayImports.filter(
          (r) => r.status === ImportStatus.REVIEW_REQUIRED
        ).length,
        autoImported: autoImportedToday,
        needsSecondLook: needsSecondLookToday,
      },

      queueStats: {
        pendingReview,
        needsSecondLook: needsSecondLookToday,
      },

      latestImport: latestImport
        ? {
            id: latestImport.id,
            status: latestImport.status,
            amount: latestImport.parsedAmount?.toString() ?? null,
            currency: latestImport.parsedCurrency,
            institution: latestImport.institution,
            source: latestImport.source,
            receivedAt: latestImport.receivedAt,
            budgetMonth: latestImport.budgetMonth,
            transactionId: latestImport.transactionId,
          }
        : null,

      salaryStatus: {
        status: salaryStatus,
        month: monthStr,
        expectedPayday,
        latestImport: salaryImport
          ? {
              id: salaryImport.id,
              status: salaryImport.status,
              amount: salaryImport.parsedAmount?.toString() ?? null,
              currency: salaryImport.parsedCurrency,
              institution: salaryImport.institution,
              receivedAt: salaryImport.receivedAt,
              financialDate: salaryImport.financialDate,
              budgetMonth: salaryImport.budgetMonth,
              transactionId: salaryImport.transactionId,
              reference: salaryImport.parsedReference,
            }
          : null,
      },

      importHealth,
      rawPayloadRetentionDays: importSetting?.rawPayloadRetentionDays ?? 90,
    },
  });
}
