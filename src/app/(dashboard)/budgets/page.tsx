"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideEdit,
  LucideTrash2,
  LucideCopy,
  LucideLoader2,
  LucideX,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { budgetFormSchema } from "@/features/budgets/schemas/budget.schema";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { StatTile, type Tone } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";

interface BudgetOverviewItem {
  id?: string;
  categoryId: string;
  categoryName: string;
  categoryType: string;
  budgetGroupKey: string | null;
  planned: string;
  actual: string;
  remaining: string;
  progressPercent: string;
  status: "ON_TRACK" | "NEAR_LIMIT" | "OVER_BUDGET" | "COMPLETED";
}

const statusMeta: Record<BudgetOverviewItem["status"], { label: string; tone: Tone }> = {
  COMPLETED: { label: "Completed", tone: "indigo" },
  OVER_BUDGET: { label: "Over Budget", tone: "rose" },
  NEAR_LIMIT: { label: "Near Limit", tone: "amber" },
  ON_TRACK: { label: "On Track", tone: "emerald" },
};

export default function BudgetsPage() {
  const queryClient = useQueryClient();

  const getInitialMonth = () => {
    const d = new Date();
    const dubaiDate = new Date(d.getTime() + 4 * 60 * 60 * 1000);
    const y = dubaiDate.getUTCFullYear();
    const m = String(dubaiDate.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  };

  const [selectedMonth, setSelectedMonth] = useState(getInitialMonth());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetOverviewItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [isCopying, setIsCopying] = useState(false);
  const [copyStatusMsg, setCopyStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<BudgetOverviewItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: budgets = [], isLoading } = useQuery<BudgetOverviewItem[]>({
    queryKey: ["budgets", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/budgets?month=${selectedMonth}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  const allocationItems = budgets.filter((b) => b.categoryType !== "INCOME");
  const totalPlanned = allocationItems.reduce((sum, b) => sum + parseFloat(b.planned), 0);
  const totalActual = allocationItems.reduce((sum, b) => sum + parseFloat(b.actual), 0);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      categoryId: "",
      amount: "",
      month: selectedMonth,
    },
  });

  useEffect(() => {
    reset({
      categoryId: "",
      amount: "",
      month: selectedMonth,
    });
  }, [selectedMonth, reset]);

  const handleOpenEdit = (b: BudgetOverviewItem) => {
    setEditingBudget(b);
    setFormError(null);
    reset({
      categoryId: b.categoryId,
      amount: parseFloat(b.planned) > 0 ? b.planned : "",
      month: selectedMonth,
    });
    setIsFormOpen(true);
  };

  type FormValues = z.infer<typeof budgetFormSchema>;

  const upsertMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      setIsFormOpen(false);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      setIsDeleteConfirmOpen(false);
      setBudgetToDelete(null);
      setDeleteError(null);
    },
    onError: (err: Error) => {
      setDeleteError(err.message);
    },
  });

  const onSubmit = (data: FormValues) => {
    setFormError(null);
    upsertMutation.mutate(data);
  };

  const changeMonth = (offset: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    const nextY = date.getUTCFullYear();
    const nextM = String(date.getUTCMonth() + 1).padStart(2, "0");
    setSelectedMonth(`${nextY}-${nextM}`);
    setCopyStatusMsg(null);
  };

  const handleCopyBudgets = async () => {
    setIsCopying(true);
    setCopyStatusMsg(null);

    const [y, m] = selectedMonth.split("-").map(Number);
    const prevDate = new Date(Date.UTC(y, m - 2, 1));
    const prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;

    try {
      const res = await fetch("/api/budgets/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMonth: prevMonthStr,
          targetMonth: selectedMonth,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setCopyStatusMsg({ type: "error", text: json.error.message });
      } else {
        setCopyStatusMsg({
          type: "success",
          text: `Atomic copy complete. Duplicated ${json.data.copiedCount} budgets from ${prevMonthStr}.`,
        });
        queryClient.invalidateQueries({ queryKey: ["budgets", selectedMonth] });
      }
    } catch (err) {
      console.error(err);
      setCopyStatusMsg({ type: "error", text: "Failed to connect to copying service." });
    } finally {
      setIsCopying(false);
    }
  };

  const handleDeleteClick = (b: BudgetOverviewItem) => {
    setBudgetToDelete(b);
    setDeleteError(null);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (budgetToDelete?.id) {
      deleteMutation.mutate(budgetToDelete.id);
    }
  };

  const getMonthLabel = (monthStr: string) => {
    const [y, m] = monthStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    return date.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
  };

  const hasConfiguredBudgets = budgets.some((b) => parseFloat(b.planned) > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Monthly Budgets"
        description="Allocate planned caps and track your actual outlays by category."
        action={
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-1.5">
            <button onClick={() => changeMonth(-1)} className="rounded-lg p-1.5 transition-colors hover:bg-slate-800" aria-label="Previous month">
              <LucideChevronLeft className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
            <span className="min-w-32 text-center text-sm font-bold text-white">{getMonthLabel(selectedMonth)}</span>
            <button onClick={() => changeMonth(1)} className="rounded-lg p-1.5 transition-colors hover:bg-slate-800" aria-label="Next month">
              <LucideChevronRight className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          </div>
        }
      />

      {copyStatusMsg && (
        <div
          role="status"
          aria-live="polite"
          className={
            copyStatusMsg.type === "success"
              ? "rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400"
              : "rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400"
          }
        >
          {copyStatusMsg.text}
        </div>
      )}

      {!isLoading && !hasConfiguredBudgets && (
        <Card className="flex flex-col items-center justify-between gap-4 border-indigo-500/25 bg-indigo-500/5 p-6 sm:flex-row">
          <div>
            <h3 className="font-bold text-white">No budget allocations found for this month</h3>
            <p className="mt-1 text-sm text-slate-400">Set planned caps manually, or duplicate the previous month&apos;s plan atomically.</p>
          </div>
          <Button variant="primary" onClick={handleCopyBudgets} disabled={isCopying}>
            {isCopying ? <LucideLoader2 className="h-4.5 w-4.5 animate-spin" aria-hidden="true" /> : <LucideCopy className="h-4.5 w-4.5" aria-hidden="true" />}
            Copy Previous Plan
          </Button>
        </Card>
      )}

      {/* Summary totals */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <StatTile label="Total Planned Allocation" value={`AED ${totalPlanned.toFixed(2)}`} tone="slate" />
        <StatTile label="Total Actual Spending" value={`AED ${totalActual.toFixed(2)}`} tone="slate" />
        <StatTile
          className="sm:col-span-2 md:col-span-1"
          label="Month Budget Remaining"
          value={`AED ${(totalPlanned - totalActual).toFixed(2)}`}
          tone={totalPlanned - totalActual >= 0 ? "emerald" : "rose"}
        />
      </div>

      {/* Reconciled table */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
            <LucideLoader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden="true" />
            <p className="text-sm">Loading budget overview…</p>
          </div>
        ) : !budgets.length ? (
          <div className="py-20 text-center text-slate-500">
            <p className="text-sm">No categories available to budget.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/60 font-semibold text-slate-400">
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Group</th>
                  <th className="px-6 py-4 text-right">Planned (Budget)</th>
                  <th className="px-6 py-4 text-right">Actual spent</th>
                  <th className="px-6 py-4 text-right">Remaining</th>
                  <th className="px-6 py-4 text-center">Progress</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {budgets.map((b) => {
                  const progressVal = Math.min(100, parseFloat(b.progressPercent));
                  const showProgressBar = parseFloat(b.planned) > 0;
                  const meta = statusMeta[b.status];

                  return (
                    <tr key={b.categoryId} className="text-slate-300 transition-colors hover:bg-slate-900/30">
                      <td className="whitespace-nowrap px-6 py-4 font-semibold text-white">{b.categoryName}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold uppercase text-slate-500">
                        {b.budgetGroupKey || b.categoryType.replace("_EXPENSE", "")}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right font-bold tabular-nums text-slate-100">
                        AED {parseFloat(b.planned).toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right font-semibold tabular-nums text-slate-400">
                        AED {parseFloat(b.actual).toFixed(2)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-6 py-4 text-right font-bold tabular-nums " +
                          (parseFloat(b.remaining) >= 0 ? "text-emerald-400" : "text-rose-400")
                        }
                      >
                        AED {parseFloat(b.remaining).toFixed(2)}
                      </td>
                      <td className="min-w-32 px-6 py-4 text-center">
                        {showProgressBar ? (
                          <div className="flex items-center justify-center gap-3">
                            <ProgressBar
                              className="w-20"
                              value={progressVal}
                              tone={b.status === "OVER_BUDGET" ? "rose" : b.status === "NEAR_LIMIT" ? "amber" : "indigo"}
                            />
                            <span className="text-xs font-semibold tabular-nums text-slate-400">
                              {parseFloat(b.progressPercent).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-slate-500">No budget set</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(b)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-indigo-400"
                            aria-label={`Edit budget for ${b.categoryName}`}
                          >
                            <LucideEdit className="h-4.5 w-4.5" aria-hidden="true" />
                          </button>
                          {b.id && (
                            <button
                              onClick={() => handleDeleteClick(b)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                              aria-label={`Remove budget for ${b.categoryName}`}
                            >
                              <LucideTrash2 className="h-4.5 w-4.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit Budget overlay */}
      {isFormOpen && editingBudget && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-200">
          <Card className="relative w-full max-w-md animate-in zoom-in-95 border-slate-800 bg-slate-900 p-6 shadow-2xl duration-200">
            <button
              onClick={() => setIsFormOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close dialog"
            >
              <LucideX className="h-5 w-5" aria-hidden="true" />
            </button>
            <h3 className="mb-1 text-xl font-bold text-white">Configure Category Budget</h3>
            <p className="mb-6 text-xs text-slate-400">
              Category: <span className="font-semibold text-white">{editingBudget.categoryName}</span> ({getMonthLabel(selectedMonth)})
            </p>

            {formError && (
              <div role="alert" aria-live="polite" className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <input type="hidden" {...register("categoryId")} />
              <input type="hidden" {...register("month")} />

              <div className="space-y-1.5">
                <label htmlFor="budget-amount" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Planned Monthly Cap (AED)
                </label>
                <input
                  id="budget-amount"
                  type="number"
                  inputMode="decimal"
                  step="1"
                  placeholder="0.00"
                  autoComplete="off"
                  {...register("amount")}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                  autoFocus
                />
                {errors.amount && (
                  <span className="text-xs text-rose-400" role="alert">
                    {errors.amount.message}
                  </span>
                )}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
                <Button type="button" variant="secondary" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting && <LucideLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Save Cap
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && budgetToDelete && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-200">
          <Card className="w-full max-w-md animate-in zoom-in-95 border-slate-800 bg-slate-900 p-6 shadow-2xl duration-200">
            <h3 className="mb-2 text-lg font-bold text-white">Remove Budget Configuration</h3>

            <p className="mb-4 text-sm text-slate-400">
              Are you sure you want to remove the budget plan for{" "}
              <span className="font-semibold text-white">{budgetToDelete.categoryName}</span> in{" "}
              <span className="font-semibold text-white">{getMonthLabel(selectedMonth)}</span>?
            </p>

            {parseFloat(budgetToDelete.actual) > 0 && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400">
                <strong>Warning:</strong> This category has actual spending of{" "}
                <span className="font-bold tabular-nums">AED {parseFloat(budgetToDelete.actual).toFixed(2)}</span>. Deleting the budget plan will
                not delete the transactions.
              </div>
            )}

            {deleteError && (
              <div role="alert" aria-live="polite" className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending && <LucideLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Confirm Remove
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
