"use client";

/**
 * SalaryStatusCard
 *
 * Dashboard card showing salary import status for a selected active budget month.
 */

import { useQuery } from "@tanstack/react-query";
import {
  LucideCheckCircle,
  LucideAlertTriangle,
  LucideClock,
  LucideSettings,
} from "lucide-react";
import Link from "next/link";

interface SalaryStatusData {
  status: "waiting" | "received" | "late" | "disabled";
  month?: string;
  latestImport: {
    id: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    source: string;
    receivedAt: string;
    budgetMonth?: string | null;
    transactionId: string | null;
  } | null;
  expectedPayday: string | null;
  importEnabled: boolean;
}

interface SalaryStatusCardProps {
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

function useReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SalaryStatusCard({ activeMonth }: SalaryStatusCardProps) {
  const { data, isLoading } = useQuery<SalaryStatusData>({
    queryKey: ["salary-status", activeMonth],
    queryFn: async () => {
      const url = activeMonth
        ? `/api/imports/salary-status?month=${activeMonth}`
        : "/api/imports/salary-status";
      const res = await fetch(url);
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 60_000,
  });

  const reducedMotion = useReducedMotion();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 animate-pulse">
        <div className="h-3 w-24 rounded bg-slate-700 mb-3" />
        <div className="h-6 w-32 rounded bg-slate-700" />
      </div>
    );
  }

  if (!data || data.status === "disabled") {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Salary Import
        </p>
        <p className="text-sm text-slate-500 mb-3">
          Import is not enabled.{" "}
          <Link href="/settings" className="text-indigo-400 hover:text-indigo-300 underline">
            Configure in Settings
          </Link>
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-slate-600 text-xs">
          <LucideSettings className="h-3.5 w-3.5" aria-hidden="true" />
          Import Disabled
        </div>
      </div>
    );
  }

  const selectedMonthStr = data.month || activeMonth || "";
  const monthShortName = getMonthNameOnly(selectedMonthStr);

  const statusMeta: Record<
    string,
    { label: string; color: string; bg: string; border: string; Icon: React.ElementType }
  > = {
    waiting: {
      label: "Waiting for Salary",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      Icon: LucideClock,
    },
    received: {
      label: data.latestImport?.amount
        ? `Received — AED ${parseFloat(data.latestImport.amount).toLocaleString("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
        : "Salary Received",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      Icon: LucideCheckCircle,
    },
    late: {
      label: "Salary Late",
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/20",
      Icon: LucideAlertTriangle,
    },
  };

  const meta = statusMeta[data.status] ?? statusMeta.waiting;
  const { Icon } = meta;
  const shouldPulse = data.status === "waiting" && !reducedMotion;

  const targetBudgetMonth = data.latestImport?.budgetMonth || selectedMonthStr;
  const targetMonthLabel = getMonthLongLabel(targetBudgetMonth);
  const isEarly = data.latestImport ? isEarlySalary(data.latestImport.receivedAt, targetBudgetMonth) : false;

  return (
    <div
      className={`rounded-2xl border p-6 ${meta.bg} ${meta.border}`}
      aria-label={`Salary status: ${meta.label}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Salary Import
        </p>
        <div
          className={`rounded-full p-1.5 border ${meta.bg} ${meta.border}`}
          aria-hidden="true"
        >
          <Icon
            className={`h-4 w-4 ${meta.color} ${shouldPulse ? "animate-pulse" : ""}`}
          />
        </div>
      </div>

      <p className={`text-lg font-bold ${meta.color}`}>{meta.label}</p>

      {data.latestImport ? (
        <div className="mt-3 space-y-1">
          {data.latestImport.amount && (
            <p className="text-2xl font-bold text-white">
              {data.latestImport.currency ?? "AED"}{" "}
              {parseFloat(data.latestImport.amount).toLocaleString("en-AE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          )}
          {targetMonthLabel && (
            <p className="text-xs font-medium text-emerald-300">
              {targetMonthLabel} salary
            </p>
          )}
          {isEarly ? (
            <p className="text-xs text-amber-300 font-semibold">
              Received early on {formatReceivedDate(data.latestImport.receivedAt)}
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              {data.latestImport.institution} · {formatReceivedDate(data.latestImport.receivedAt)}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Source:{" "}
            <span className="text-slate-400 font-medium">{data.latestImport.source}</span>
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-slate-400">
            {monthShortName ? `No salary recorded for ${monthShortName}` : "No salary recorded for selected month"}
          </p>
          {data.expectedPayday && (
            <p className="text-xs text-slate-500">
              Expected:{" "}
              <span className="text-slate-300 font-medium">
                {new Date(data.expectedPayday + "T00:00:00").toLocaleDateString("en-AE", {
                  day: "numeric",
                  month: "long",
                })}
              </span>
            </p>
          )}
        </div>
      )}

      {data.status === "late" && (
        <p className="mt-3 text-xs text-rose-400">
          Salary not detected past expected payday for {monthShortName || "selected month"}.
        </p>
      )}
    </div>
  );
}
