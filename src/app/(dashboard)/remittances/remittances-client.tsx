"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideRefreshCw,
  LucideSearch,
  LucideFileSpreadsheet,
  LucidePlus,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideArchive,
  LucideInfo,
} from "lucide-react";
import { DataTable, DataTablePagination } from "@/components/data-table";
import type { ColumnDef } from "@/components/data-table";

interface RemittanceItem {
  id: string;
  recipient: string | null;
  amountSentAed: string;
  cashOutflowAed?: string;
  exchangeRate: string | null;
  amountReceivedPhp: string | null;
  transferFeeAed: string | null;
  transferProvider: string;
  transferDate: string;
  referenceNumber: string | null;
  notes: string | null;
  status: "COMPLETED" | "REVERSED";
  archivedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  transactionId: string | null;
  reversalTransactionId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  version: number;
}

interface Category {
  id: string;
  name: string;
  type: string;
}

export function RemittancesClient() {
  const queryClient = useQueryClient();

  // Search & filter states
  const [page, setPage] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [transferProvider, setTransferProvider] = useState("");
  const [status, setStatus] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Create remittance form states
  const [recipientInput, setRecipientInput] = useState("");
  const [amountSentInput, setAmountSentInput] = useState("");
  const [exchangeRateInput, setExchangeRateInput] = useState("");
  const [transferFeeInput, setTransferFeeInput] = useState("");
  const [transferProviderInput, setTransferProviderInput] = useState("");
  const [transferDateInput, setTransferDateInput] = useState(new Date().toISOString().split("T")[0]);
  const [referenceNumberInput, setReferenceNumberInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [syncLedger, setSyncLedger] = useState(true);
  const [categoryIdInput, setCategoryIdInput] = useState("");

  // Error & UI states
  const [formError, setFormError] = useState("");
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);

  // Reversal dialog states
  const [reversalTarget, setReversalTarget] = useState<RemittanceItem | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState("");

  // Queries
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.data;
    },
  });

  const remittanceCategories = categories.filter((c) => c.type === "REMITTANCE");

  // Fetch remittances
  const fetchUrl = `/api/remittances?page=${page}&pageSize=8` +
    (recipient ? `&recipient=${encodeURIComponent(recipient)}` : "") +
    (transferProvider ? `&transferProvider=${encodeURIComponent(transferProvider)}` : "") +
    (status ? `&status=${status}` : "") +
    (includeArchived ? `&includeArchived=true` : "") +
    (startDate ? `&startDate=${startDate}` : "") +
    (endDate ? `&endDate=${endDate}` : "");

  const { data, isLoading } = useQuery<{
    items: RemittanceItem[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  }>({
    queryKey: ["remittances", page, recipient, transferProvider, status, includeArchived, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(fetchUrl);
      const json = await res.json();
      return json.data;
    },
  });

  // Preview math
  const amtSent = parseFloat(amountSentInput) || 0;
  const rate = parseFloat(exchangeRateInput) || 0;
  const fee = parseFloat(transferFeeInput) || 0;
  const previewPhp = (amtSent * rate).toFixed(2);
  const previewOutflow = (amtSent + fee).toFixed(2);

  // Mutations
  const createRemittanceMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to create remittance.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remittances"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Clear form
      setRecipientInput("");
      setAmountSentInput("");
      setExchangeRateInput("");
      setTransferFeeInput("");
      setTransferProviderInput("");
      setReferenceNumberInput("");
      setNotesInput("");
      setCategoryIdInput("");
      setFormError("");
      setIsSubmitOpen(false);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async ({ id, reason, version }: { id: string; reason: string; version: number }) => {
      const res = await fetch(`/api/remittances/${id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reversalReason: reason,
          expectedVersion: version,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to reverse remittance.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remittances"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReversalTarget(null);
      setReversalReason("");
      setReversalError("");
    },
    onError: (err: Error) => {
      setReversalError(err.message);
    },
  });

  const toggleArchiveMutation = useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const res = await fetch(`/api/remittances/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to update remittance.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["remittances"] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientInput.trim()) return setFormError("Recipient is required.");
    if (amtSent <= 0) return setFormError("Amount sent must be greater than zero.");
    if (rate <= 0) return setFormError("Exchange rate must be greater than zero.");
    if (fee < 0) return setFormError("Transfer fee cannot be negative.");
    if (!transferProviderInput.trim()) return setFormError("Transfer provider is required.");
    if (syncLedger && !categoryIdInput) return setFormError("Category is required for ledger sync.");

    createRemittanceMutation.mutate({
      recipient: recipientInput,
      amountSentAed: amtSent,
      exchangeRate: rate,
      transferFeeAed: fee,
      transferProvider: transferProviderInput,
      transferDate: new Date(transferDateInput).toISOString(),
      referenceNumber: referenceNumberInput || null,
      notes: notesInput || null,
      syncLedger,
      categoryId: syncLedger ? categoryIdInput : null,
    });
  };

  const handleExport = () => {
    let exportUrl = `/api/exports?type=remittances`;
    if (startDate) exportUrl += `&startDate=${startDate}`;
    if (endDate) exportUrl += `&endDate=${endDate}`;
    window.open(exportUrl, "_blank");
  };

  return (
    <div className="space-y-8 text-slate-100 animate-in fade-in duration-300">
      <PageHeader
        title="Remittance Management"
        description="Track, send, and reverse remittances sent to the Philippines."
        action={
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 hover:text-white transition-colors"
            >
              <LucideFileSpreadsheet className="h-4.5 w-4.5 text-emerald-400" />
              Export CSV
            </button>
            <button
              onClick={() => setIsSubmitOpen(!isSubmitOpen)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 transition-colors"
            >
              <LucidePlus className="h-4.5 w-4.5" />
              Record Remittance
            </button>
          </div>
        }
      />

      {/* Record Form Modal/Collapse */}
      {isSubmitOpen && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-6">
          <h3 className="text-lg font-bold text-white">Record New Remittance</h3>
          {formError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
              <LucideAlertCircle className="h-4 w-4" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleCreate} className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Recipient Name</label>
              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="e.g. Maria Clara"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Amount Sent (AED)</label>
              <input
                type="number"
                step="0.01"
                value={amountSentInput}
                onChange={(e) => setAmountSentInput(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Exchange Rate (AED to PHP)</label>
              <input
                type="number"
                step="0.000001"
                value={exchangeRateInput}
                onChange={(e) => setExchangeRateInput(e.target.value)}
                placeholder="15.200000"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Transfer Fee (AED)</label>
              <input
                type="number"
                step="0.01"
                value={transferFeeInput}
                onChange={(e) => setTransferFeeInput(e.target.value)}
                placeholder="15.00"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Provider / Channel</label>
              <input
                type="text"
                value={transferProviderInput}
                onChange={(e) => setTransferProviderInput(e.target.value)}
                placeholder="e.g. GCash, Metrobank"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Transfer Date</label>
              <input
                type="date"
                value={transferDateInput}
                onChange={(e) => setTransferDateInput(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Reference Number</label>
              <input
                type="text"
                value={referenceNumberInput}
                onChange={(e) => setReferenceNumberInput(e.target.value)}
                placeholder="e.g. Ref # / Tx ID"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Notes</label>
              <input
                type="text"
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Optional notes"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>

            <div className="space-y-4 flex flex-col justify-end">
              <label className="flex items-center gap-3 cursor-pointer select-none pb-3">
                <input
                  type="checkbox"
                  checked={syncLedger}
                  onChange={(e) => setSyncLedger(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span className="text-xs font-semibold text-slate-300">Sync with Account Ledger</span>
              </label>
            </div>

            {syncLedger && (
              <div className="space-y-2 md:col-span-3">
                <label className="text-xs font-semibold text-slate-400 uppercase">Remittance Ledger Category</label>
                <select
                  value={categoryIdInput}
                  onChange={(e) => setCategoryIdInput(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white"
                >
                  <option value="">Select a category...</option>
                  {remittanceCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Calculations Preview Glass Box */}
            <div className="md:col-span-3 rounded-xl bg-slate-950/60 border border-slate-850 p-5 space-y-4">
              <h4 className="text-sm font-bold text-indigo-400 flex items-center gap-2">
                <LucideInfo className="h-4 w-4" /> Submission Preview Calculations
              </h4>
              <div className="grid gap-4 sm:grid-cols-2 text-sm">
                <div className="flex justify-between items-center bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                  <span className="text-slate-400">Total Outflow Impact (AED)</span>
                  <span className="font-extrabold text-white">AED {previewOutflow}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                  <span className="text-slate-400">PHP Received (Est.)</span>
                  <span className="font-extrabold text-emerald-400">PHP {previewPhp}</span>
                </div>
              </div>
              {!syncLedger && (
                <p className="text-xs text-amber-400/90 leading-normal">
                  ⚠️ Note: Ledger sync is disabled. This remittance record will be created for tracking and report history, but will not affect ledger cash-flow calculations.
                </p>
              )}
            </div>

            <div className="md:col-span-3 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsSubmitOpen(false)}
                className="rounded-xl bg-slate-900 border border-slate-800 px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createRemittanceMutation.isPending}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {createRemittanceMutation.isPending ? "Submitting..." : "Confirm & Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Options Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5 text-sm">
          <div className="relative">
            <LucideSearch className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-500" />
            <input
              type="text"
              placeholder="Recipient name..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
            />
          </div>

          <input
            type="text"
            placeholder="Provider (e.g. GCash)..."
            value={transferProvider}
            onChange={(e) => setTransferProvider(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
          >
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="REVERSED">Reversed</option>
          </select>

          <input
            type="date"
            placeholder="Start Date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
          />

          <input
            type="date"
            placeholder="End Date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2.5 cursor-pointer text-sm select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-slate-400 font-medium">Show Archived Remittances</span>
          </label>
        </div>
      </div>

      {/* Main Table Card */}
      {(() => {
        const columns: ColumnDef<RemittanceItem>[] = [
          {
            key: "date",
            header: "Transfer Date",
            cell: (r) => (
              <span className="whitespace-nowrap">
                {new Date(r.transferDate).toLocaleDateString("en-AE", {
                  timeZone: "Asia/Dubai", year: "numeric", month: "short", day: "numeric",
                })}
              </span>
            ),
          },
          {
            key: "recipient",
            header: "Recipient",
            cell: (r) => (
              <div>
                <div className="font-bold text-white">{r.recipient || "Not available"}</div>
                {r.referenceNumber && (
                  <div className="text-[10px] text-slate-500 font-semibold">Ref: {r.referenceNumber}</div>
                )}
              </div>
            ),
          },
          {
            key: "amountSent",
            header: "Amount Sent",
            align: "right",
            cell: (r) => {
              const totalOutflow = parseFloat(r.amountSentAed) + (r.transferFeeAed ? parseFloat(r.transferFeeAed) : 0);
              return (
                <div>
                  <div className="font-extrabold text-slate-100">AED {parseFloat(r.amountSentAed).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500">
                    Fee: {r.transferFeeAed ? `AED ${parseFloat(r.transferFeeAed).toFixed(2)}` : "Not available"} | Total: AED {totalOutflow.toFixed(2)}
                  </div>
                </div>
              );
            },
          },
          {
            key: "phpReceived",
            header: "PHP Received",
            align: "right",
            cell: (r) => (
              <div className="text-emerald-400 font-extrabold">
                {r.amountReceivedPhp ? `PHP ${parseFloat(r.amountReceivedPhp).toFixed(2)}` : "Not available"}
                <div className="text-[10px] text-slate-500 font-normal">
                  Rate: {r.exchangeRate ? parseFloat(r.exchangeRate).toFixed(4) : "Not available"}
                </div>
              </div>
            ),
          },
          {
            key: "provider",
            header: "Provider",
            hideable: true,
            cell: (r) => <span className="whitespace-nowrap">{r.transferProvider}</span>,
          },
          {
            key: "ledger",
            header: "Ledger Category",
            hideable: true,
            cell: (r) => r.transactionId ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/20">
                <LucideCheckCircle2 className="h-3 w-3" aria-hidden="true" /> {r.categoryName || "Linked"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full font-semibold border border-amber-500/20">
                <LucideAlertCircle className="h-3 w-3" aria-hidden="true" /> Unlinked
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            align: "center",
            cell: (r) => {
              const isReversed = r.status === "REVERSED";
              return (
                <span className={`text-[10px] font-extrabold tracking-wide px-2 py-1 rounded-full uppercase ${
                  isReversed
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}>
                  {r.status}
                </span>
              );
            },
          },
          {
            key: "actions",
            header: "Actions",
            align: "center",
            cell: (r) => {
              const isReversed = r.status === "REVERSED";
              return (
                <div className="flex items-center justify-center gap-3.5">
                  {!isReversed ? (
                    <button
                      onClick={() => { setReversalTarget(r); setReversalReason(""); setReversalError(""); }}
                      aria-label={`Reverse remittance to ${r.recipient}`}
                      className="text-xs font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors"
                    >
                      <LucideRefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reverse
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 italic" title={r.reversalReason || ""}>
                      Reversed
                    </span>
                  )}
                  <button
                    onClick={() => toggleArchiveMutation.mutate({ id: r.id, archive: !r.archivedAt })}
                    aria-label={r.archivedAt ? `Unarchive remittance to ${r.recipient}` : `Archive remittance to ${r.recipient}`}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <LucideArchive className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            },
          },
        ];

        return (
          <div className="space-y-3">
            <DataTable
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(r) => r.id}
              isLoading={isLoading}
              emptyState={<p className="text-slate-500 italic text-sm">No remittances match the active filters.</p>}
            />
            {data && (
              <DataTablePagination
                itemLabel="remittances"
                pagination={{
                  page: data.page ?? page,
                  pageSize: data.pageSize ?? 10,
                  totalItems: data.totalItems,
                  totalPages: data.totalPages,
                }}
                onPageChange={setPage}
              />
            )}
          </div>
        );
      })()}

      {/* Reversal Confirmation Modal */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Confirm Remittance Reversal</h3>
              <p className="text-sm text-slate-400 mt-2">
                This will mark the remittance as reversed and record an offsetting ledger inflow transaction of{" "}
                <span className="text-white font-bold">
                  AED {reversalTarget.cashOutflowAed ? parseFloat(reversalTarget.cashOutflowAed).toFixed(2) : (parseFloat(reversalTarget.amountSentAed) + (reversalTarget.transferFeeAed ? parseFloat(reversalTarget.transferFeeAed) : 0)).toFixed(2)}
                </span>{" "}
                to balance your accounts. This action is immutable.
              </p>
            </div>

            {reversalError && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
                <LucideAlertCircle className="h-4 w-4" />
                <span>{reversalError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Reason for Reversal</label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="e.g. Sent via wrong channel, incorrect amount..."
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-sm focus:border-indigo-500 focus:outline-none text-white h-24 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReversalTarget(null)}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reversalReason.trim() || reverseMutation.isPending}
                onClick={() =>
                  reverseMutation.mutate({
                    id: reversalTarget.id,
                    reason: reversalReason,
                    version: reversalTarget.version,
                  })
                }
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
              >
                {reverseMutation.isPending ? "Reversing..." : "Confirm Reversal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
