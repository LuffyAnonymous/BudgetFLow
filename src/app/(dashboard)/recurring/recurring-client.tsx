"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucidePlus,
  LucideCalendar,
  LucideCheckCircle2,
  LucidePlay,
  LucidePause,
  LucideTrash,
  LucideClock,
  LucideAlertTriangle,
} from "lucide-react";
import { clsx } from "clsx";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface RecurringTemplate {
  id: string;
  name: string;
  transactionType: "INCOME" | "EXPENSE" | "SAVINGS" | "DEBT_PAYMENT" | "TRANSFER" | "REMITTANCE";
  amount: string;
  frequency: "MONTHLY" | "WEEKLY" | "YEARLY";
  startDate: string;
  endDate: string | null;
  dueDay: number | null;
  autoCreate: boolean;
  reminderEnabled: boolean;
  notes: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  sourceType: string;
  sourceEntityId: string | null;
  categoryId: string | null;
}

export function RecurringClient() {
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form states
  const [nameInput, setNameInput] = useState("");
  const [typeInput, setTypeInput] = useState<RecurringTemplate["transactionType"]>("EXPENSE");
  const [amountInput, setAmountInput] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [dueDayInput, setDueDayInput] = useState("");
  const [autoCreateInput, setAutoCreateInput] = useState(false);
  const [reminderEnabledInput, setReminderEnabledInput] = useState(true);
  const [notesInput, setNotesInput] = useState("");
  const [categoryIdInput, setCategoryIdInput] = useState("");
  const [sourceTypeInput, setSourceTypeInput] = useState("GENERAL");
  const [sourceEntityIdInput, setSourceEntityIdInput] = useState("");

  const [formError, setFormError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Queries
  const { data: templates = [], isLoading } = useQuery<RecurringTemplate[]>({
    queryKey: ["recurring-templates"],
    queryFn: async () => {
      const res = await fetch("/api/recurring");
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.data || [];
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to create template.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-payments"] });
      setIsCreateOpen(false);
      resetForm();
      setActionSuccess("Recurring template created successfully!");
      setTimeout(() => setActionSuccess(""), 4000);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const res = await fetch(`/api/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to update template.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-payments"] });
      resetForm();
      setActionSuccess("Template status updated successfully!");
      setTimeout(() => setActionSuccess(""), 4000);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/recurring/evaluate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to run evaluation.");
      }
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-payments"] });
      setActionSuccess(`Evaluation complete: Created ${data.created}, Completed ${data.completed}, Failed ${data.failed} occurrences.`);
      setTimeout(() => setActionSuccess(""), 6000);
    },
    onError: (err: Error) => {
      setActionSuccess(`Evaluation failed: ${err.message}`);
    },
  });

  const resetForm = () => {
    setNameInput("");
    setTypeInput("EXPENSE");
    setAmountInput("");
    setStartDateInput("");
    setEndDateInput("");
    setDueDayInput("");
    setAutoCreateInput(false);
    setReminderEnabledInput(true);
    setNotesInput("");
    setCategoryIdInput("");
    setSourceTypeInput("GENERAL");
    setSourceEntityIdInput("");
    setFormError("");
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: nameInput,
      transactionType: typeInput,
      amount: amountInput,
      frequency: "MONTHLY",
      startDate: startDateInput,
      endDate: endDateInput || null,
      dueDay: dueDayInput ? parseInt(dueDayInput, 10) : null,
      autoCreate: autoCreateInput,
      reminderEnabled: reminderEnabledInput,
      notes: notesInput,
      categoryId: categoryIdInput || null,
      sourceType: sourceTypeInput,
      sourceEntityId: sourceEntityIdInput || null,
    });
  };

  const handleStatusChange = (id: string, newStatus: "ACTIVE" | "PAUSED" | "ARCHIVED") => {
    updateMutation.mutate({ id, payload: { status: newStatus } });
  };

  const isSpecialType =
    typeInput === "DEBT_PAYMENT" || typeInput === "SAVINGS" || typeInput === "REMITTANCE";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Recurring Entries"
          description="Manage automated ledger generation rules and reminder templates."
        />
        <div className="flex gap-2">
          <button
            onClick={() => evaluateMutation.mutate()}
            disabled={evaluateMutation.isPending}
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-all disabled:opacity-50"
          >
            <LucideClock className="h-4 w-4" />
            {evaluateMutation.isPending ? "Evaluating..." : "Run Evaluation"}
          </button>
          <button
            onClick={() => {
              resetForm();
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
          >
            <LucidePlus className="h-4 w-4" />
            Add Rule
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20 animate-in slide-in-from-top duration-300">
          <LucideCheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {actionSuccess}
        </div>
      )}

      {/* Grid List */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-900 border border-slate-800" />
          <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-900 border border-slate-800" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center backdrop-blur-xs">
          <LucideCalendar className="mx-auto h-8 w-8 text-slate-650 mb-3" />
          <p className="text-sm font-medium text-slate-400">No active recurring template rules found.</p>
          <p className="text-xs text-slate-550 mt-1">Create one to automatically record expenses/income or generate due notifications.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className={clsx(
                "group relative rounded-2xl border bg-slate-900/40 p-5 backdrop-blur-xs flex flex-col justify-between transition-all hover:border-slate-700",
                tpl.status === "PAUSED" ? "border-slate-850 opacity-60" : "border-slate-800"
              )}
            >
              <div>
                {/* Header Tag and Badge */}
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={clsx(
                      "rounded-lg px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      tpl.transactionType === "INCOME"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-red-500/10 text-red-400"
                    )}
                  >
                    {tpl.transactionType}
                  </span>
                  <span
                    className={clsx(
                      "rounded-lg px-2.5 py-0.5 text-[10px] font-bold",
                      tpl.status === "ACTIVE"
                        ? "bg-indigo-500/10 text-indigo-400"
                        : tpl.status === "PAUSED"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-slate-800 text-slate-400"
                    )}
                  >
                    {tpl.status}
                  </span>
                </div>

                <h3 className="font-bold text-white text-base leading-tight truncate">{tpl.name}</h3>
                <p className="text-2xl font-black text-white mt-2">
                  AED {parseFloat(tpl.amount).toFixed(2)}
                  <span className="text-xs font-semibold text-slate-400 block mt-0.5">
                    every month (Due day: {tpl.dueDay || "N/A"})
                  </span>
                </p>

                {tpl.notes && <p className="text-xs text-slate-450 mt-3 italic line-clamp-2">{tpl.notes}</p>}

                <div className="mt-4 flex flex-col gap-1 border-t border-slate-850 pt-3 text-[10px] text-slate-450">
                  <p>
                    <span className="font-semibold text-slate-400">Ledger Sync:</span>{" "}
                    {tpl.autoCreate ? "Automatic generation" : "Reminder only"}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-400">Start Date:</span>{" "}
                    {new Date(tpl.startDate).toLocaleDateString()}
                  </p>
                  {tpl.endDate && (
                    <p>
                      <span className="font-semibold text-slate-400">End Date:</span>{" "}
                      {new Date(tpl.endDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 mt-5 border-t border-slate-850 pt-3">
                {tpl.status === "ACTIVE" ? (
                  <button
                    onClick={() => handleStatusChange(tpl.id, "PAUSED")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-350 hover:bg-slate-700 transition-colors"
                  >
                    <LucidePause className="h-3 w-3" />
                    Pause
                  </button>
                ) : tpl.status === "PAUSED" ? (
                  <button
                    onClick={() => handleStatusChange(tpl.id, "ACTIVE")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-900/50 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-900 transition-colors"
                  >
                    <LucidePlay className="h-3 w-3" />
                    Resume
                  </button>
                ) : null}
                <button
                  onClick={() => handleStatusChange(tpl.id, "ARCHIVED")}
                  className="flex items-center justify-center rounded-lg bg-red-950/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/40 transition-colors"
                  title="Archive"
                >
                  <LucideTrash className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Creation Modal Dialog */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleCreateSubmit}
            className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md space-y-5"
          >
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Create Recurring Rule</h3>
              <p className="text-xs text-slate-400">Configure scheduling parameters. MVP supports MONTHLY evaluation only.</p>
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
                <LucideAlertTriangle className="h-4 w-4" />
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monthly Rent Payment"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Transaction Type
                </label>
                <select
                  value={typeInput}
                  onChange={(e) => {
                    const val = e.target.value as RecurringTemplate["transactionType"];
                    setTypeInput(val);
                    if (val === "DEBT_PAYMENT" || val === "SAVINGS" || val === "REMITTANCE") {
                      setAutoCreateInput(false); // forced reminder-only
                    }
                  }}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                  <option value="DEBT_PAYMENT">Debt Payment Reminder</option>
                  <option value="SAVINGS">Savings Deposit Reminder</option>
                  <option value="REMITTANCE">Philippines Remittance Reminder</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Amount (AED)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={startDateInput}
                  onChange={(e) => setStartDateInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-855 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  End Date (Optional)
                </label>
                <input
                  type="date"
                  value={endDateInput}
                  onChange={(e) => setEndDateInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-855 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Preferred Due Day (1-31)
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Defaults to start date day"
                  value={dueDayInput}
                  onChange={(e) => setDueDayInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Ledger Sync Category
                </label>
                <select
                  value={categoryIdInput}
                  onChange={(e) => setCategoryIdInput(e.target.value)}
                  required={autoCreateInput}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">No category (Reminder only)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Notes
                </label>
                <textarea
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  rows={2}
                />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4 flex flex-col gap-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCreateInput}
                  disabled={isSpecialType}
                  onChange={(e) => {
                    setAutoCreateInput(e.target.checked);
                    if (e.target.checked && isSpecialType) {
                      setAutoCreateInput(false);
                    }
                  }}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                />
                <div>
                  <span className="text-sm font-semibold text-white">Auto-create ledger transaction</span>
                  <p className="text-[10px] text-slate-400">
                    Automatically record transaction on due day. Only available for EXPENSE and INCOME.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reminderEnabledInput}
                  onChange={(e) => setReminderEnabledInput(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="text-sm font-semibold text-white">Enable notifications alert</span>
                  <p className="text-[10px] text-slate-400">
                    Trigger alert warnings in in-app notification center when payment is due/overdue.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-800 px-5 py-2 text-sm text-slate-300 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating..." : "Save Template"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
