"use client";

/**
 * /imports — SMS Import Review page
 *
 * Lists REVIEW_REQUIRED imports so the user can:
 *   - View redacted SMS details
 *   - Verify amount and date
 *   - Choose a category (optional override)
 *   - Confirm or Reject
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideCheckCircle,
  LucideXCircle,
  LucideAlertTriangle,
  LucideRefreshCw,
  LucideInbox,
} from "lucide-react";

interface ImportItem {
  id: string;
  institution: string;
  status: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  parsedReference: string | null;
  parsedDescription: string | null;
  receivedAt: string;
  financialDate: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  duplicateCount: number;
  lastDuplicateAt: string | null;
  transactionId: string | null;
}

interface ImportDetail extends ImportItem {
  redactedPayload: string | null; // null when payload cleared by retention job
  maskedSender: string | null;
  parserKey: string | null;
  parserVersion: string | null;
}

export function normalizeCategories<T = Record<string, unknown>>(json: unknown): T[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  if (obj.data && Array.isArray(obj.data)) {
    return obj.data as T[];
  }
  if (Array.isArray(json)) {
    return json as T[];
  }
  return [];
}

export function normalizeImportsList<T = Record<string, unknown>>(json: unknown): T[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  if (obj.data && typeof obj.data === "object" && obj.data !== null) {
    const dataObj = obj.data as Record<string, unknown>;
    if (dataObj.items && Array.isArray(dataObj.items)) {
      return dataObj.items as T[];
    }
    if (Array.isArray(obj.data)) {
      return obj.data as T[];
    }
  }
  if (Array.isArray(json)) {
    return json as T[];
  }
  return [];
}

export default function ImportsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("REVIEW_REQUIRED");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmCategoryId, setConfirmCategoryId] = useState<string>("");
  const [confirmDate, setConfirmDate] = useState<string>("");

  const { data: reviewItems = [], isLoading, error: listError } = useQuery<ImportItem[]>({
    queryKey: ["imports", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/imports/sms/list?status=${activeTab}&pageSize=50`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to load pending imports");
      }
      return normalizeImportsList<ImportItem>(json);
    },
  });

  const { data: detail, error: detailError } = useQuery<ImportDetail>({
    queryKey: ["import-detail", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/imports/sms/${selectedId}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to load import detail");
      }
      return json.data;
    },
    enabled: !!selectedId,
  });

  const { data: categories = [], error: categoriesError } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to load categories");
      }
      return normalizeCategories<{ id: string; name: string; type: string }>(json);
    },
  });

  const incomeCategories = Array.isArray(categories)
    ? categories.filter((c) => c.type === "INCOME")
    : [];

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      const body: Record<string, string> = {};
      if (confirmCategoryId) body.categoryId = confirmCategoryId;
      if (confirmDate) body.financialDate = new Date(confirmDate).toISOString();
      const res = await fetch(`/api/imports/sms/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Confirm failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imports"] });
      queryClient.invalidateQueries({ queryKey: ["salary-status"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setSelectedId(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/imports/sms/${id}/reject`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Reject failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imports"] });
      setSelectedId(null);
    },
  });

  const pageError = listError || categoriesError || detailError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Review"
        description="Review and confirm salary imports before they become transactions."
      />

      {pageError && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-400">
          <LucideAlertTriangle className="h-4 w-4 shrink-0" />
          <span>{pageError.message}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 py-8">
          <LucideRefreshCw className="h-4 w-4 animate-spin" />
          Loading pending imports...
        </div>
      )}

      {!isLoading && (!Array.isArray(reviewItems) || reviewItems.length === 0) && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-500">
          <LucideInbox className="h-10 w-10" />
          <p className="text-sm">No imports found for this tab.</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-800 pb-2 overflow-x-auto">
        {[
          { id: "REVIEW_REQUIRED", label: "Review Required" },
          { id: "PROCESSED", label: "Processed" },
          { id: "REJECTED,FAILED", label: "Rejected" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedId(null);
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-indigo-500/20 text-indigo-400"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* List */}
        <div className="space-y-3">
          {Array.isArray(reviewItems) && reviewItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setConfirmCategoryId("");
                setConfirmDate(
                  item.financialDate
                    ? item.financialDate.slice(0, 10)
                    : new Date(item.receivedAt).toISOString().slice(0, 10)
                );
              }}
              className={`w-full text-left rounded-xl border p-4 transition-all ${
                selectedId === item.id
                  ? "border-indigo-500/50 bg-indigo-500/10"
                  : "border-slate-800 bg-slate-900/30 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <p className="text-sm font-semibold text-white">{item.institution}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Status badge */}
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                    item.status === "REVIEW_REQUIRED" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                    item.status === "PROCESSED"       ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                    item.status === "FAILED"          ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
                    "bg-slate-500/10 border-slate-700 text-slate-400"
                  }`}>
                    {item.status.replace("_", " ")}
                  </span>
                  {/* Confidence badge */}
                  {item.confidence && (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                      item.confidence === "HIGH"   ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                      item.confidence === "MEDIUM" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                      "bg-rose-500/10 border-rose-500/20 text-rose-400"
                    }`}>
                      {item.confidence}
                    </span>
                  )}
                  {/* Duplicate activity badge (correction #17) */}
                  {item.duplicateCount > 0 && (
                    <span
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400"
                      title={item.lastDuplicateAt
                        ? `Last duplicate: ${new Date(item.lastDuplicateAt).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "medium" })}`
                        : "Delivered multiple times"}
                    >
                      Delivered {item.duplicateCount + 1} times
                    </span>
                  )}
                </div>
              </div>
              {item.parsedAmount && (
                <p className="text-xl font-bold text-emerald-400">
                  {item.parsedCurrency ?? "AED"}{" "}
                  {parseFloat(item.parsedAmount).toLocaleString("en-AE", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {new Date(item.receivedAt).toLocaleString("en-AE", {
                  timeZone: "Asia/Dubai",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {item.parsedReference && (
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  {item.parsedReference}
                </p>
              )}
              {item.transactionId && (
                <p className="flex items-center gap-1 text-xs text-indigo-400 mt-0.5">
                  <LucideCheckCircle className="h-3 w-3" aria-hidden="true" /> Transaction created
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Detail / Actions */}
        {selectedId && detail && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 space-y-5">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Import Detail
              </p>
              <p className="text-lg font-bold text-white">{detail.institution}</p>
              <p className="text-xs text-slate-500">Parser: {detail.parserKey ?? "—"}</p>
            </div>

            {detail.parsedAmount && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                <p className="text-xs text-emerald-400 font-semibold mb-1">Parsed Amount</p>
                <p className="text-3xl font-bold text-white">
                  {detail.parsedCurrency ?? "AED"}{" "}
                  {parseFloat(detail.parsedAmount).toLocaleString("en-AE", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                {detail.parsedReference && (
                  <p className="text-xs text-slate-400 mt-1">
                    Reference: {detail.parsedReference}
                  </p>
                )}
              </div>
            )}

            {/* Redacted payload — shown only in review (correction #11) */}
            {detail.redactedPayload !== null ? (
              <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4">
                <p className="text-xs text-slate-400 font-semibold mb-2">
                  Redacted SMS (account numbers masked)
                </p>
                <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-all">
                  {detail.redactedPayload}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-4">
                <p className="text-xs text-slate-500 italic">
                  Message content removed according to retention settings.
                </p>
              </div>
            )}

            {/* Transaction link (correction #11) */}
            {detail.transactionId && (
              <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-3">
                <p className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold">
                  <LucideCheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Transaction created
                </p>
              </div>
            )}

            {/* Financial date override */}
            <div>
              <label
                htmlFor="confirm-date"
                className="block text-xs font-semibold text-slate-400 mb-1"
              >
                Financial Date
              </label>
              <input
                id="confirm-date"
                type="date"
                value={confirmDate}
                onChange={(e) => setConfirmDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Category override */}
            {incomeCategories.length > 0 && (
              <div>
                <label
                  htmlFor="confirm-category"
                  className="block text-xs font-semibold text-slate-400 mb-1"
                >
                  Income Category{" "}
                  <span className="text-slate-600">(leave blank to use configured default)</span>
                </label>
                <select
                  id="confirm-category"
                  value={confirmCategoryId}
                  onChange={(e) => setConfirmCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Use configured Salary category</option>
                  {Array.isArray(incomeCategories) && incomeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Error display */}
            {(confirmMutation.error || rejectMutation.error) && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                <LucideAlertTriangle className="h-4 w-4 shrink-0" />
                {(confirmMutation.error as Error)?.message ??
                  (rejectMutation.error as Error)?.message}
              </div>
            )}

            {/* Actions */}
            {detail.status === "REVIEW_REQUIRED" && (
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => confirmMutation.mutate(selectedId)}
                  disabled={confirmMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-4 py-3 text-sm font-bold transition-all disabled:opacity-50"
                >
                  <LucideCheckCircle className="h-4 w-4" />
                  Confirm Import
                </button>
                <button
                  onClick={() => rejectMutation.mutate(selectedId)}
                  disabled={rejectMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-4 py-3 text-sm font-bold transition-all disabled:opacity-50"
                >
                  <LucideXCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
