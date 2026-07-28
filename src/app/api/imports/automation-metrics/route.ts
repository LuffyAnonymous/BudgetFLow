/**
 * GET /api/imports/automation-metrics
 *
 * Consolidated automation dashboard endpoint.
 * Returns salary status, token status, import counts, and system health
 * in ONE response to avoid duplicate queries from separate components.
 *
 * importHealth deterministic rules (correction #13):
 *   DISABLED:       ImportSetting.enabled === false
 *   NO_TOKEN:       enabled but no active token (missing, revoked, or expired)
 *   NEEDS_REVIEW:   pending REVIEW_REQUIRED imports OR recent failures
 *   HEALTHY:        enabled + active non-expired token + no pending review + no recent failures
 *
 * duplicateActivity (correction #3):
 *   Calculated from records where duplicateCount > 0 AND lastDuplicateAt >= start-of-today-dubai.
 *   This shows "imports with duplicate activity today" (not "duplicate requests today").
 *   Labeled clearly in the response to match UI copy.
 *
 * Connected bank (correction #14):
 *   Derived from ImportSetting configuration (senderAllowlist + parserKey inference).
 *   Never hard-coded.
 *
 * Dubai timezone:
 *   "Today" is calculated in Asia/Dubai (UTC+4) local time.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportStatus } from "@prisma/client";
import { getDubaiCurrentDate, getDubaiMonthRange } from "@/lib/dates";

const DUBAI_OFFSET_HOURS = 4;
const RECENT_FAILURE_WINDOW_HOURS = 24;

/** Token expiry warning threshold: 30 days */
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

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // ── 1. Load settings ─────────────────────────────────────────────────────────
  const [importSetting, userSetting] = await Promise.all([
    db.importSetting.findUnique({
      where: { userId },
      select: {
        enabled: true,
        autoImportSalary: true,
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
      },
    }),
    db.importedTransaction.count({
      where: { userId, status: ImportStatus.REVIEW_REQUIRED },
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
  ).length; // auto-imported = PROCESSED without manual confirm

  // Imports with duplicate activity today (correction #3)
  const importsWithDuplicateActivityToday = todayImports.filter(
    (r) =>
      r.duplicateCount > 0 &&
      r.lastDuplicateAt !== null &&
      r.lastDuplicateAt >= todayStart
  ).length;

  // ── 5. Latest import (any time) ──────────────────────────────────────────────
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
      transactionId: true,
      parserKey: true,
    },
  });

  // ── 6. Salary status (current month) ─────────────────────────────────────────
  const monthStr = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const { start: monthStart, nextMonthStart } = getDubaiMonthRange(monthStr);

  const salaryImport = await db.importedTransaction.findFirst({
    where: {
      userId,
      status: { in: [ImportStatus.PROCESSED, ImportStatus.REVIEW_REQUIRED] },
      receivedAt: { gte: monthStart, lt: nextMonthStart },
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
      transactionId: true,
      parsedReference: true,
    },
  });

  // Compute salary status and expected payday
  let salaryStatus: "waiting" | "review_required" | "received" | "late" | "disabled";
  let expectedPayday: string | null = null;
  let isLate = false;

  if (!importSetting?.enabled) {
    salaryStatus = "disabled";
  } else {
    if (userSetting?.payday) {
      const daysInMonth = new Date(
        Date.UTC(today.year, today.month, 0)
      ).getUTCDate();
      const paydayDay = Math.min(userSetting.payday, daysInMonth);
      expectedPayday = `${today.year}-${String(today.month).padStart(2, "0")}-${String(paydayDay).padStart(2, "0")}`;
      if (!salaryImport && today.day > paydayDay + 2) isLate = true;
    }

    if (!salaryImport) {
      salaryStatus = isLate ? "late" : "waiting";
    } else if (salaryImport.status === ImportStatus.REVIEW_REQUIRED) {
      salaryStatus = "review_required";
    } else {
      salaryStatus = "received";
    }
  }

  // ── 7. Connected institution (from parser key / sender allowlist) ─────────────
  // Correction #14: derive from configuration, never hard-code
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

  // ── 8. Import health (deterministic — correction #13) ────────────────────────
  let importHealth: ImportHealth;
  if (!importSetting?.enabled) {
    importHealth = "DISABLED";
  } else if (!hasActiveToken) {
    importHealth = "NO_TOKEN";
  } else if (pendingReview > 0 || recentFailures > 0 || isNearExpiry) {
    importHealth = "NEEDS_REVIEW";
  } else {
    importHealth = "HEALTHY";
  }

  // ── 9. Build response ─────────────────────────────────────────────────────────
  return NextResponse.json({
    data: {
      // Import system status
      importEnabled: importSetting?.enabled ?? false,
      autoImportEnabled: importSetting?.autoImportSalary ?? false,

      // Token status
      token: {
        hasToken,
        isActive: hasActiveToken,
        isRevoked,
        isExpired,
        isNearExpiry,
        lastUsedAt: importSetting?.tokenLastUsedAt ?? null,
        expiresAt: importSetting?.tokenExpiresAt ?? null,
      },

      // Institution (correction #14)
      connectedInstitution: {
        name: supportedInstitution,
        configuredSenders: senderAllowlist.map(getCanonicalDisplayName),
        parserKeys,
      },

      // Today's stats
      todayStats: {
        total: todayImports.length,
        processed: processedToday,
        failed: failedToday,
        importsWithDuplicateActivityToday,
        reviewRequired: todayImports.filter(
          (r) => r.status === ImportStatus.REVIEW_REQUIRED
        ).length,
        autoImported: autoImportedToday,
      },

      // Queue
      queueStats: {
        pendingReview,
      },

      // Latest import
      latestImport: latestImport
        ? {
            id: latestImport.id,
            status: latestImport.status,
            amount: latestImport.parsedAmount?.toString() ?? null,
            currency: latestImport.parsedCurrency,
            institution: latestImport.institution,
            source: latestImport.source,
            receivedAt: latestImport.receivedAt,
            transactionId: latestImport.transactionId,
          }
        : null,

      // Salary status (consolidated — avoids second endpoint call)
      salaryStatus: {
        status: salaryStatus,
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
              transactionId: salaryImport.transactionId,
              reference: salaryImport.parsedReference,
            }
          : null,
      },

      // System health
      importHealth,

      // Retention
      rawPayloadRetentionDays: importSetting?.rawPayloadRetentionDays ?? 30,
    },
  });
}
