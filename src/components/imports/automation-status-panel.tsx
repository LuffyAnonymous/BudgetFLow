"use client";

/**
 * AutomationStatusPanel
 *
 * Compact monitoring panel for the SMS import automation system.
 * Replaces the Quick Actions section on the dashboard.
 */

import { useQuery } from "@tanstack/react-query";
import {
  LucideCheckCircle2,
  LucideAlertTriangle,
  LucideXCircle,
  LucideCircleDashed,
  LucideArrowRight,
  LucideDownload,
} from "lucide-react";
import Link from "next/link";

interface SalaryStatusData {
  status: "waiting" | "received" | "late" | "disabled";
  month?: string;
  expectedPayday: string | null;
  latestImport: {
    id: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    receivedAt: string;
    financialDate: string | null;
    budgetMonth?: string | null;
    transactionId: string | null;
    reference: string | null;
  } | null;
}

interface AutomationMetrics {
  importEnabled: boolean;
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
    needsSecondLook: number;
  };
  queueStats: { pendingReview: number; needsSecondLook: number };
  latestImport: {
    id: string;
    status: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    source: string;
    receivedAt: string;
    budgetMonth?: string | null;
    transactionId: string | null;
  } | null;
  salaryStatus: SalaryStatusData;
  importHealth: "HEALTHY" | "NEEDS_REVIEW" | "NO_TOKEN" | "DISABLED";
  rawPayloadRetentionDays: number;
}

interface AutomationStatusPanelProps {
  activeMonth?: string;
}

function getMonthLongLabel(monthStr?: string): string {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return "";
  const [y, m] = monthStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

function getMonthNameOnly(monthStr?: string): string {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return "";
  const [y, m] = monthStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
  });
}

function formatReceivedDate(receivedAtIso: string): string {
  const d = new Date(receivedAtIso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}

function isEarlySalary(receivedAtIso: string, budgetMonthStr?: string | null): boolean {
  if (!receivedAtIso || !budgetMonthStr) return false;
  const recDate = new Date(receivedAtIso);
  const recY = recDate.getUTCFullYear();
  const recM = String(recDate.getUTCMonth() + 1).padStart(2, "0");
  const recMonthStr = `${recY}-${recM}`;
  return recMonthStr < budgetMonthStr;
}

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

function salaryStatusDisplay(s: SalaryStatusData["status"], amount?: string | null) {
  const map: Record<
    SalaryStatusData["status"],
    { label: string; color: "green" | "amber" | "red" | "slate" }
  > = {
    received: {
      label: amount
        ? `Received — AED ${parseFloat(amount).toLocaleString("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
        : "Received",
      color: "green",
    },
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

export function AutomationStatusPanel({ activeMonth }: AutomationStatusPanelProps) {
  const { data, isLoading } = useQuery<AutomationMetrics>({
    queryKey: ["automation-metrics", activeMonth],
    queryFn: async () => {
      const url = activeMonth
        ? `/api/imports/automation-metrics?month=${activeMonth}`
        : "/api/imports/automation-metrics";
      const res = await fetch(url);
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 2 * 60 * 1000,
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

  const { importHealth, token, connectedInstitution, queueStats, latestImport, salaryStatus } = data;
  const salary = salaryStatusDisplay(salaryStatus.status, salaryStatus.latestImport?.amount);

  const showReviewAlert = queueStats.pendingReview > 0 || queueStats.needsSecondLook > 0;

  const activeMonthStr = salaryStatus.month || activeMonth || "";
  const monthShortName = getMonthNameOnly(activeMonthStr);
  const salaryTargetMonthLabel = getMonthLongLabel(salaryStatus.latestImport?.budgetMonth || activeMonthStr);
  const isSalaryEarly = salaryStatus.latestImport
    ? isEarlySalary(salaryStatus.latestImport.receivedAt, salaryStatus.latestImport.budgetMonth || activeMonthStr)
    : false;

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
          aria-label={[
            queueStats.pendingReview > 0 ? `${queueStats.pendingReview} receipt${queueStats.pendingReview === 1 ? "" : "s"} pending review` : null,
            queueStats.needsSecondLook > 0 ? `${queueStats.needsSecondLook} import${queueStats.needsSecondLook === 1 ? "" : "s"} need a second look` : null,
          ].filter(Boolean).join(", ")}
        >
          <div className="flex items-center gap-2">
            <LucideAlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-semibold">
              {[
                queueStats.pendingReview > 0 ? `${queueStats.pendingReview} receipt${queueStats.pendingReview === 1 ? "" : "s"} pending review` : null,
                queueStats.needsSecondLook > 0 ? `${queueStats.needsSecondLook} import${queueStats.needsSecondLook === 1 ? "" : "s"} need a second look` : null,
              ].filter(Boolean).join(" · ")}
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

        {/* Salary Status (Scoped to activeMonth) */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Salary Status ({monthShortName || "Active Month"})
          </p>
          <div className="space-y-1 text-xs text-slate-300">
            <StatusDot color={salary.color} label={salary.label} />
            {salaryStatus.latestImport ? (
              <>
                {salaryTargetMonthLabel && (
                  <p className="text-[11px] font-semibold text-emerald-300">
                    {salaryTargetMonthLabel} salary
                  </p>
                )}
                {isSalaryEarly ? (
                  <p className="text-amber-300 font-semibold text-[10px]">
                    Received early on {formatReceivedDate(salaryStatus.latestImport.receivedAt)}
                  </p>
                ) : (
                  <p className="text-slate-400 text-[10px]">
                    Received {formatReceivedDate(salaryStatus.latestImport.receivedAt)}
                    {salaryStatus.latestImport.institution ? ` · ${salaryStatus.latestImport.institution}` : ""}
                  </p>
                )}
              </>
            ) : (
              <p className="text-slate-400 text-[11px]">
                {monthShortName ? `No salary recorded for ${monthShortName}` : "No salary recorded for selected month"}
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
                className={`font-semibold ${
                  queueStats.pendingReview > 0 ? "text-amber-400 font-bold" : "text-slate-300"
                }`}
              >
                {queueStats.pendingReview}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Needs a second look</span>
              <span
                className={`font-semibold ${
                  queueStats.needsSecondLook > 0 ? "text-amber-400 font-bold" : "text-slate-300"
                }`}
              >
                {queueStats.needsSecondLook}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Processed today</span>
              <span className="font-semibold text-slate-300">{data.todayStats.processed}</span>
            </div>
            {data.todayStats.failed > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-rose-400">Failed today</span>
                <span className="font-bold text-rose-400">{data.todayStats.failed}</span>
              </div>
            )}
          </div>
        </div>

        {/* Global Latest Bank Import */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Latest Bank Import
          </p>
          {latestImport ? (
            <div className="space-y-1 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${importStatusBadge(
                    latestImport.status
                  )}`}
                >
                  {latestImport.status === "PROCESSED"
                    ? "Imported"
                    : latestImport.status === "REVIEW_REQUIRED"
                    ? "Pending"
                    : latestImport.status}
                </span>
                {latestImport.amount && (
                  <span className="font-bold text-white">
                    {latestImport.currency ?? "AED"}{" "}
                    {parseFloat(latestImport.amount).toLocaleString("en-AE", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-[10px]">
                {latestImport.institution} ·{" "}
                {new Date(latestImport.receivedAt).toLocaleDateString("en-AE", {
                  timeZone: "Asia/Dubai",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              {latestImport.budgetMonth && (
                <p className="text-indigo-300 font-semibold text-[10px]">
                  Applicable to {getMonthLongLabel(latestImport.budgetMonth)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No imports received yet</p>
          )}
        </div>

      </div>
    </section>
  );
}
