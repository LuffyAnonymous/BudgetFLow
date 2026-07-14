"use client";

/**
 * SalaryStatusCard
 *
 * Dashboard card showing the current month's salary import status.
 *
 * States:
 *   disabled         — import engine not enabled (links to settings)
 *   waiting          — no salary yet this month (within grace period)
 *   review_required  — salary SMS received, awaiting user review
 *   received         — salary confirmed for this month
 *   late             — past payday + 2 grace days, no salary
 *
 * Accessibility:
 *   - No pulsing animations when prefers-reduced-motion is set
 *   - status color coded in text, not color alone (label always present)
 */

import { useQuery } from "@tanstack/react-query";
import {
  LucideCheckCircle,
  LucideAlertTriangle,
  LucideClock,
  LucideSettings,
  LucideExternalLink,
} from "lucide-react";
import Link from "next/link";

interface SalaryStatusData {
  status: "waiting" | "review_required" | "received" | "late" | "disabled";
  latestImport: {
    id: string;
    amount: string | null;
    currency: string | null;
    institution: string;
    source: string;
    receivedAt: string;
    transactionId: string | null;
  } | null;
  expectedPayday: string | null;
  importEnabled: boolean;
  autoImportEnabled: boolean;
}

function useReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SalaryStatusCard() {
  const { data, isLoading } = useQuery<SalaryStatusData>({
    queryKey: ["salary-status"],
    queryFn: async () => {
      const res = await fetch("/api/imports/salary-status");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 60_000, // refresh every minute
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
    review_required: {
      label: "Review Required",
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
      border: "border-indigo-500/20",
      Icon: LucideAlertTriangle,
    },
    received: {
      label: "Salary Received",
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

  // Only pulse when motion is acceptable and status is "waiting"
  const shouldPulse = data.status === "waiting" && !reducedMotion;

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

      {data.latestImport && (
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
          <p className="text-xs text-slate-400">
            {data.latestImport.institution} ·{" "}
            {new Date(data.latestImport.receivedAt).toLocaleDateString("en-AE", {
              day: "numeric",
              month: "short",
            })}
          </p>
          <p className="text-xs text-slate-500">
            Source:{" "}
            <span className="text-slate-400 font-medium">{data.latestImport.source}</span>
          </p>
        </div>
      )}

      {!data.latestImport && data.expectedPayday && (
        <p className="mt-3 text-xs text-slate-400">
          Expected:{" "}
          <span className="text-slate-300 font-medium">
            {new Date(data.expectedPayday + "T00:00:00").toLocaleDateString("en-AE", {
              day: "numeric",
              month: "long",
            })}
          </span>
        </p>
      )}

      {data.status === "review_required" && (
        <Link
          href="/imports"
          className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <LucideExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Review Import
        </Link>
      )}

      {data.status === "late" && (
        <p className="mt-3 text-xs text-rose-400">
          Salary not detected past expected payday. Check your bank SMS settings.
        </p>
      )}

      {!data.autoImportEnabled && (
        <p className="mt-3 text-xs text-slate-600">
          Auto-import is off — imports require manual review.
        </p>
      )}
    </div>
  );
}
