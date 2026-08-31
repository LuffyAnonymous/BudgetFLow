"use client";

/**
 * /imports — Import Activity page
 *
 * SMS imports post automatically (no review step) — this page shows recent
 * activity, badged by confidence, so anything auto-posted at MEDIUM/LOW
 * confidence or flagged with an ambiguous direction can be corrected after
 * the fact. Uploaded receipts still go through manual review here (there's
 * no bank balance to trust their amount against), with the same
 * confirm/reject flow as before.
 */

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideCheckCircle,
  LucideXCircle,
  LucideAlertTriangle,
  LucideRefreshCw,
  LucideInbox,
  LucideUpload,
  LucideFileText,
  LucideReceipt,
  LucideTrash2,
} from "lucide-react";

interface ImportItem {
  id: string;
  source: string;
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
  attachments: { id: string; mimeType: string }[];
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
  const [activeTab, setActiveTab] = useState<string>("PROCESSED");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmCategoryId, setConfirmCategoryId] = useState<string>("");
  const [confirmDate, setConfirmDate] = useState<string>("");
  const [confirmAmount, setConfirmAmount] = useState<string>("");
  const [confirmDescription, setConfirmDescription] = useState<string>("");
  const receiptInputRef = useRef<HTMLInputElement>(null);

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
      if (confirmAmount.trim()) body.amount = confirmAmount.trim();
      if (confirmDescription.trim()) body.description = confirmDescription.trim();
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

  const uploadReceiptMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/imports/receipt", { method: "POST", body: formData });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error ?? "Receipt upload failed");
      }
      return json;
    },
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ["imports"] });
      setActiveTab("REVIEW_REQUIRED");
      if (json?.importedTransactionId) setSelectedId(json.importedTransactionId);
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

  const clearFailedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/imports/failed", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to clear failed imports");
      }
      return json.data as { deletedCount: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imports"] });
      setSelectedId(null);
    },
  });

  const pageError = listError || categoriesError || detailError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Import Activity"
          description="SMS imports post automatically. Review anything flagged with MEDIUM/LOW confidence, or confirm an uploaded receipt."
        />
        <div>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadReceiptMutation.mutate(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => receiptInputRef.current?.click()}
            disabled={uploadReceiptMutation.isPending}
            className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-50"
          >
            {uploadReceiptMutation.isPending ? (
              <LucideRefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <LucideUpload className="h-4 w-4" />
            )}
            Upload Receipt
          </button>
          {uploadReceiptMutation.error && (
            <p className="mt-2 max-w-xs text-right text-xs text-rose-400">
              {(uploadReceiptMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>

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
      <div className="flex items-center justify-between gap-2 mb-6 border-b border-slate-800 pb-2 flex-wrap">
        <div className="flex gap-2 overflow-x-auto">
          {[
            { id: "PROCESSED", label: "Recent Imports" },
            { id: "REVIEW_REQUIRED", label: "Pending Receipts" },
            { id: "REJECTED,FAILED", label: "Failed" },
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
        {activeTab === "REJECTED,FAILED" && Array.isArray(reviewItems) && reviewItems.some((i) => i.status === "FAILED") && (
          <button
            onClick={() => {
              if (window.confirm("Permanently delete all failed imports? This can't be undone.")) {
                clearFailedMutation.mutate();
              }
            }}
            disabled={clearFailedMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
          >
            {clearFailedMutation.isPending ? (
              <LucideRefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LucideTrash2 className="h-3.5 w-3.5" />
            )}
            Clear All Failed
          </button>
        )}
      </div>
      {clearFailedMutation.error && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-sm text-rose-400 -mt-3">
          <LucideAlertTriangle className="h-4 w-4 shrink-0" />
          <span>{(clearFailedMutation.error as Error).message}</span>
        </div>
      )}

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
                setConfirmAmount(item.parsedAmount ?? "");
                setConfirmDescription(item.parsedDescription ?? "");
              }}
              className={`w-full text-left rounded-xl border p-4 transition-all ${
                selectedId === item.id
                  ? "border-indigo-500/50 bg-indigo-500/10"
                  : "border-slate-800 bg-slate-900/30 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                  {item.source === "DOCUMENT" && <LucideReceipt className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />}
                  {item.institution}
                </p>
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

            {detail.failureMessage && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-400">
                <LucideAlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{detail.failureMessage}</span>
              </div>
            )}

            {detail.source === "DOCUMENT" && detail.attachments.length > 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <p className="mb-2 text-xs font-semibold text-slate-400">Uploaded document</p>
                {detail.attachments[0].mimeType === "application/pdf" ? (
                  <a
                    href={`/api/attachments/${detail.attachments[0].id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                  >
                    <LucideFileText className="h-4 w-4" /> View PDF
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/attachments/${detail.attachments[0].id}`}
                    alt="Uploaded receipt"
                    className="max-h-64 w-full rounded-lg object-contain"
                  />
                )}
              </div>
            )}

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

            {/* Redacted payload — SMS-sourced imports only (correction #11) */}
            {detail.source !== "DOCUMENT" && (
              detail.redactedPayload !== null ? (
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
              )
            )}

            {/* Transaction link (correction #11) */}
            {detail.transactionId && (
              <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-3">
                <p className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold">
                  <LucideCheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Transaction created
                </p>
              </div>
            )}

            {/* Amount override — required when extraction left parsedAmount empty */}
            <div>
              <label
                htmlFor="confirm-amount"
                className="block text-xs font-semibold text-slate-400 mb-1"
              >
                Amount ({detail.parsedCurrency ?? "AED"})
                {!detail.parsedAmount && <span className="text-amber-400"> — required</span>}
              </label>
              <input
                id="confirm-amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={confirmAmount}
                onChange={(e) => setConfirmAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Description override */}
            <div>
              <label
                htmlFor="confirm-description"
                className="block text-xs font-semibold text-slate-400 mb-1"
              >
                Description
              </label>
              <input
                id="confirm-description"
                type="text"
                maxLength={200}
                value={confirmDescription}
                onChange={(e) => setConfirmDescription(e.target.value)}
                placeholder="e.g. vendor or purpose"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

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
                  disabled={confirmMutation.isPending || !confirmAmount.trim()}
                  title={!confirmAmount.trim() ? "Enter an amount before confirming" : undefined}
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
