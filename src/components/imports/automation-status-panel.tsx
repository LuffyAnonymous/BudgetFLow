"use client";

/**
 * AutomationStatusPanel
 *
 * Compact monitoring panel for the SMS import automation system.
 * Replaces the Quick Actions section on the dashboard.
 *
 * Sections (correction #2, #16):
 *   - Salary Status (compact, review alert at top if needed)
 *   - Bank Import status (enabled/disabled/setup required/token expired/revoked)
 *   - Import Queue (pending review, processed today, failed today)
 *   - Latest Import (amount, bank, date, status)
 *   - Quick Links (text links, no large buttons)
 *
 * importHealth labels (correction #13):
 *   HEALTHY       → "Operating normally"
 *   NEEDS_REVIEW  → "Review needed"
 *   NO_TOKEN      → "Setup required"
 *   DISABLED      → "Disabled"
 *
 * Accessibility:
 *   - All status indicators have text labels (not color alone)
 *   - aria-label on the panel section
 *   - Reduced motion: no animations that convey state
 */

import { useQuery } from "@tanstack/react-query";
import {
  LucideCheckCircle2,
  LucideAlertTriangle,
  LucideXCircle,
  LucideCircleDashed,
  LucideArrowRight,
  LucideRefreshCw,
  LucideClock,
  LucideDownload,
} from "lucide-react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalaryStatusData {
  status: "waiting" | "review_required" | "received" | "late" | "disabled";
  expectedPayday: string | null;
  latestImport: {
    id: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    receivedAt: string;
    financialDate: string | null;
    transactionId: string | null;
    reference: string | null;
  } | null;
}

interface AutomationMetrics {
  importEnabled: boolean;
  autoImportEnabled: boolean;
  token: {
    hasToken: boolean;
    isActive: boolean;
    isRevoked: boolean;
    isExpired: boolean;
    isNearExpiry: boolean;
    lastUsedAt: string | null;
    expiresAt: string | null;
  };
  connectedInstitution: {
    name: string | null;
    configuredSenders: string[];
    parserKeys: string[];
  };
  todayStats: {
    total: number;
    processed: number;
    failed: number;
    importsWithDuplicateActivityToday: number;
    reviewRequired: number;
    autoImported: number;
  };
  queueStats: { pendingReview: number };
  latestImport: {
    id: string;
    status: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    source: string;
    receivedAt: string;
    transactionId: string | null;
  } | null;
  salaryStatus: SalaryStatusData;
  importHealth: "HEALTHY" | "NEEDS_REVIEW" | "NO_TOKEN" | "DISABLED";
  rawPayloadRetentionDays: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({
  color,
  label,
}: {
  color: "green" | "amber" | "red" | "slate";
  label: string;
}) {
  const colors: Record<string, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    slate: "bg-slate-600",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${colors[color]}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

function HealthIcon({
  health,
}: {
  health: AutomationMetrics["importHealth"];
}) {
  if (health === "HEALTHY")
    return <LucideCheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />;
  if (health === "NEEDS_REVIEW")
    return <LucideAlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />;
  if (health === "NO_TOKEN")
    return <LucideCircleDashed className="h-4 w-4 text-slate-400" aria-hidden="true" />;
  return <LucideXCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />;
}

function healthLabel(health: AutomationMetrics["importHealth"]): string {
  if (health === "HEALTHY") return "Operating normally";
  if (health === "NEEDS_REVIEW") return "Review needed";
  if (health === "NO_TOKEN") return "Setup required";
  return "Disabled";
}

function healthColor(health: AutomationMetrics["importHealth"]): string {
  if (health === "HEALTHY") return "text-emerald-400";
  if (health === "NEEDS_REVIEW") return "text-amber-400";
  return "text-slate-400";
}

function salaryStatusDisplay(s: SalaryStatusData["status"]) {
  const map: Record<
    SalaryStatusData["status"],
    { label: string; color: "green" | "amber" | "red" | "slate" }
  > = {
    received: { label: "Received", color: "green" },
    review_required: { label: "Review Required", color: "amber" },
    waiting: { label: "Waiting", color: "slate" },
    late: { label: "Late", color: "red" },
    disabled: { label: "Disabled", color: "slate" },
  };
  return map[s] ?? { label: s, color: "slate" as const };
}

function importStatusBadge(status: string): string {
  const map: Record<string, string> = {
    PROCESSED: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    REVIEW_REQUIRED: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    FAILED: "bg-rose-500/10 border-rose-500/20 text-rose-400",
    RECEIVED: "bg-slate-500/10 border-slate-500/20 text-slate-400",
    REJECTED: "bg-slate-700/50 border-slate-700 text-slate-500",
  };
  return (
    map[status] ?? "bg-slate-500/10 border-slate-500/20 text-slate-400"
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AutomationStatusPanel() {
  const { data, isLoading } = useQuery<AutomationMetrics>({
    queryKey: ["automation-metrics"],
    queryFn: async () => {
      const res = await fetch("/api/imports/automation-metrics");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 2 * 60 * 1000, // refresh every 2 minutes
  });

  if (isLoading || !data) {
    return (
      <div
        className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 animate-pulse"
        aria-label="Import system status loading"
      >
        <div className="h-3 w-36 rounded bg-slate-700 mb-4" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  const { importHealth, token, connectedInstitution, todayStats, queueStats, latestImport, salaryStatus } = data;
  const salary = salaryStatusDisplay(salaryStatus.status);

  // ── Review alert: compact warning shown near top
  const showReviewAlert =
    salaryStatus.status === "review_required" || queueStats.pendingReview > 0;

  return (
    <section
      aria-label="Import system status"
      className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LucideDownload className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Import System Status
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <HealthIcon health={importHealth} />
          <span className={`font-semibold ${healthColor(importHealth)}`}>
            {healthLabel(importHealth)}
          </span>
        </div>
      </div>

      {/* Review alert */}
      {showReviewAlert && (
        <Link
          href="/imports"
          className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 hover:bg-amber-500/15 transition-colors"
          aria-label={`${queueStats.pendingReview} import${queueStats.pendingReview === 1 ? "" : "s"} pending review`}
        >
          <div className="flex items-center gap-2">
            <LucideAlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-semibold">
              {queueStats.pendingReview > 0
                ? `${queueStats.pendingReview} import${queueStats.pendingReview === 1 ? "" : "s"} pending review`
                : "Salary import requires review"}
            </span>
          </div>
          <LucideArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}

      {/* Main grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

        {/* Bank Import */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Bank Import
          </p>
          <div className="space-y-1 text-xs text-slate-300">
            <div>
              {data.importEnabled ? (
                <StatusDot color="green" label="Enabled" />
              ) : (
                <StatusDot color="slate" label="Disabled" />
              )}
            </div>
            <div>
              {token.isActive ? (
                <StatusDot color="green" label={token.isNearExpiry ? "Token (expiring soon)" : "Token active"} />
              ) : token.isExpired ? (
                <StatusDot color="red" label="Token expired" />
              ) : token.isRevoked ? (
                <StatusDot color="red" label="Token revoked" />
              ) : (
                <StatusDot color="slate" label="No token" />
              )}
            </div>
            {connectedInstitution.name && (
              <p className="text-slate-400 truncate">{connectedInstitution.name}</p>
            )}
            {token.lastUsedAt && (
              <p className="text-slate-500 text-[10px]">
                Last used{" "}
                {new Date(token.lastUsedAt).toLocaleDateString("en-AE", {
                  timeZone: "Asia/Dubai",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
        </div>

        {/* Salary Status */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Salary
          </p>
          <div className="space-y-1 text-xs text-slate-300">
            <StatusDot color={salary.color} label={salary.label} />
            {salaryStatus.latestImport?.amount && (
              <p className="font-bold text-white text-sm">
                {salaryStatus.latestImport.currency ?? "AED"}{" "}
                {parseFloat(salaryStatus.latestImport.amount).toLocaleString("en-AE", {
                  minimumFractionDigits: 2,
                })}
              </p>
            )}
            {salaryStatus.latestImport?.receivedAt && (
              <p className="text-slate-400 text-[10px]">
                {new Date(salaryStatus.latestImport.receivedAt).toLocaleDateString("en-AE", {
                  timeZone: "Asia/Dubai",
                  month: "short",
                  day: "numeric",
                })}
                {salaryStatus.latestImport.institution
                  ? ` · ${salaryStatus.latestImport.institution}`
                  : ""}
              </p>
            )}
            {salaryStatus.latestImport?.reference && (
              <p className="text-slate-500 text-[10px] font-mono truncate">
                {salaryStatus.latestImport.reference}
              </p>
            )}
            {!salaryStatus.latestImport && salaryStatus.expectedPayday && (
              <p className="text-slate-500 text-[10px]">
                Expected:{" "}
                {new Date(salaryStatus.expectedPayday + "T00:00:00").toLocaleDateString(
                  "en-AE",
                  { day: "numeric", month: "short" }
                )}
              </p>
            )}
          </div>
        </div>

        {/* Import Queue */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Import Queue
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Pending review</span>
              <span
                className={`font-bold tabular-nums ${
                  queueStats.pendingReview > 0 ? "text-amber-400" : "text-slate-500"
                }`}
                aria-label={`${queueStats.pendingReview} pending review`}
              >
                {queueStats.pendingReview}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Processed today</span>
              <span className="font-bold tabular-nums text-emerald-400">
                {todayStats.processed}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Failed today</span>
              <span
                className={`font-bold tabular-nums ${
                  todayStats.failed > 0 ? "text-rose-400" : "text-slate-500"
                }`}
              >
                {todayStats.failed}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400" title="Imports where the same message was delivered more than once">
                Duplicate activity
              </span>
              <span className="font-bold tabular-nums text-slate-500">
                {todayStats.importsWithDuplicateActivityToday}
              </span>
            </div>
          </div>
        </div>

        {/* Latest Import */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Latest Import
          </p>
          {latestImport ? (
            <div className="space-y-1 text-xs">
              {latestImport.amount && (
                <p className="font-bold text-white text-sm">
                  {latestImport.currency ?? "AED"}{" "}
                  {parseFloat(latestImport.amount).toLocaleString("en-AE", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              )}
              <p className="text-slate-400">{latestImport.institution}</p>
              <p className="text-slate-500 text-[10px]">
                {new Date(latestImport.receivedAt).toLocaleDateString("en-AE", {
                  timeZone: "Asia/Dubai",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${importStatusBadge(latestImport.status)}`}
              >
                {latestImport.status.replace("_", " ")}
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-600">No imports yet</p>
          )}
        </div>
      </div>

      {/* Quick links — text only, no large buttons (correction #2) */}
      <div
        className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-800 pt-3"
        role="navigation"
        aria-label="Import navigation"
      >
        <Link
          href="/imports"
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <LucideRefreshCw className="h-3 w-3" aria-hidden="true" />
          Review imports
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          <LucideClock className="h-3 w-3" aria-hidden="true" />
          Import settings
        </Link>
        <Link
          href="/imports?status=all"
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          <LucideArrowRight className="h-3 w-3" aria-hidden="true" />
          Import history
        </Link>
      </div>
    </section>
  );
}
