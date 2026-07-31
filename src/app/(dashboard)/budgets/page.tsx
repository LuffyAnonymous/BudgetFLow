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
  LucideX 
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { budgetFormSchema } from "@/features/budgets/schemas/budget.schema";
import { z } from "zod";

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

export default function BudgetsPage() {
  const queryClient = useQueryClient();

  // Current Month State (YYYY-MM in Dubai)
  const getInitialMonth = () => {
    const d = new Date();
    // Adjust by +4 hours for Dubai
    const dubaiDate = new Date(d.getTime() + 4 * 60 * 60 * 1000);
    const y = dubaiDate.getUTCFullYear();
    const m = String(dubaiDate.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  };

  const [selectedMonth, setSelectedMonth] = useState(getInitialMonth());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetOverviewItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Copy Budgets state
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatusMsg, setCopyStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Delete configuration state
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<BudgetOverviewItem | null>(null);

  // Fetch Budget Overview
  const { data: budgets = [], isLoading } = useQuery<BudgetOverviewItem[]>({
    queryKey: ["budgets", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/budgets?month=${selectedMonth}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  // Income (Salary) is money coming in, not an allocation of money out - excluded
  // from these totals so they represent actual planned/actual spending, not
  // spending-plus-income double-counted together.
  const allocationItems = budgets.filter((b) => b.categoryType !== "INCOME");
  const totalPlanned = allocationItems.reduce((sum, b) => sum + parseFloat(b.planned), 0);
  const totalActual = allocationItems.reduce((sum, b) => sum + parseFloat(b.actual), 0);

  // Form Setup
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

  // Keep month inside form synchronized
  useEffect(() => {
    reset({
      categoryId: "",
      amount: "",
      month: selectedMonth,
    });
  }, [selectedMonth, reset]);

  // Open edit planned amount modal
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

  // Upsert Mutation
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

  // Deletion Mutation
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
    },
    onError: (err: Error) => {
      alert(`Error deleting budget: ${err.message}`);
    },
  });

  const onSubmit = (data: FormValues) => {
    setFormError(null);
    upsertMutation.mutate(data);
  };

  // Adjust active month
  const changeMonth = (offset: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    const nextY = date.getUTCFullYear();
    const nextM = String(date.getUTCMonth() + 1).padStart(2, "0");
    setSelectedMonth(`${nextY}-${nextM}`);
    setCopyStatusMsg(null);
  };

  // Copy budgets function
  const handleCopyBudgets = async () => {
    setIsCopying(true);
    setCopyStatusMsg(null);
    
    // Determine previous month
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
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (budgetToDelete?.id) {
      deleteMutation.mutate(budgetToDelete.id);
    }
  };

  // Helper to parse nice month label (e.g. July 2026)
  const getMonthLabel = (monthStr: string) => {
    const [y, m] = monthStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    return date.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: BudgetOverviewItem["status"]) => {
    switch (status) {
      case "COMPLETED":
        return <span className="inline-flex items-center rounded-full bg-indigo-500/10 border border-indigo-500/35 px-2.5 py-0.5 text-xs font-semibold text-indigo-400">Completed</span>;
      case "OVER_BUDGET":
        return <span className="inline-flex items-center rounded-full bg-red-500/10 border border-red-500/35 px-2.5 py-0.5 text-xs font-semibold text-red-400">Over Budget</span>;
      case "NEAR_LIMIT":
        return <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/35 px-2.5 py-0.5 text-xs font-semibold text-amber-400">Near Limit</span>;
      case "ON_TRACK":
      default:
        return <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/35 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">On Track</span>;
    }
  };

  const hasConfiguredBudgets = budgets.some((b) => parseFloat(b.planned) > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Monthly Budgets"
        description="Allocate planned caps and track your actual outlays by category."
        action={
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1.5 gap-2">
            <button
              onClick={() => changeMonth(-1)}
              className="rounded-lg p-1.5 hover:bg-slate-800 transition-colors"
            >
              <LucideChevronLeft className="h-4.5 w-4.5" />
            </button>
            <span className="text-sm font-bold min-w-32 text-center text-white">
              {getMonthLabel(selectedMonth)}
            </span>
            <button
              onClick={() => changeMonth(1)}
              className="rounded-lg p-1.5 hover:bg-slate-800 transition-colors"
            >
              <LucideChevronRight className="h-4.5 w-4.5" />
            </button>
          </div>
        }
      />

      {copyStatusMsg && (
        <div className={`rounded-xl border p-4 text-sm ${
          copyStatusMsg.type === "success" 
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/20 bg-red-500/10 text-red-400"
        }`}>
          {copyStatusMsg.text}
        </div>
      )}

      {/* Copy plan notification when empty */}
      {!isLoading && !hasConfiguredBudgets && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-6 backdrop-blur-sm animate-pulse">
          <div>
            <h4 className="font-bold text-white">No budget allocations found for this month</h4>
            <p className="text-sm text-slate-400 mt-1">
              Set planned caps manually, or duplicate the previous month&apos;s plan atomically.
            </p>
          </div>
          <button
            onClick={handleCopyBudgets}
            disabled={isCopying}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 disabled:opacity-40"
          >
            {isCopying ? <LucideLoader2 className="h-4.5 w-4.5 animate-spin" /> : <LucideCopy className="h-4.5 w-4.5" />}
            Copy Previous Plan
          </button>
        </div>
      )}

      {/* Summary totals */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Planned Allocation</p>
          <p className="mt-2 text-2xl font-bold text-white">AED {totalPlanned.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Actual Spending</p>
          <p className="mt-2 text-2xl font-bold text-white">AED {totalActual.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 sm:col-span-2 md:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Month Budget Remaining</p>
          <p className={`mt-2 text-2xl font-bold ${
            totalPlanned - totalActual >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            AED {(totalPlanned - totalActual).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Reconciled table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/20 backdrop-blur-sm">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <LucideLoader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-sm">Loading budget overview...</p>
          </div>
        ) : !budgets.length ? (
          <div className="py-20 text-center text-slate-500">
            <p className="text-sm">No categories available to budget.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-850 bg-slate-900/60 font-semibold text-slate-400">
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
              <tbody className="divide-y divide-slate-850">
                {budgets.map((b) => {
                  const progressVal = Math.min(100, parseFloat(b.progressPercent));
                  const showProgressBar = parseFloat(b.planned) > 0;
                  
                  return (
                    <tr key={b.categoryId} className="hover:bg-slate-900/30 transition-colors text-slate-300">
                      <td className="px-6 py-4 font-semibold text-white whitespace-nowrap">
                        {b.categoryName}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-500 whitespace-nowrap uppercase">
                        {b.budgetGroupKey || b.categoryType.replace("_EXPENSE", "")}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-slate-100 whitespace-nowrap">
                        AED {parseFloat(b.planned).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-350 whitespace-nowrap">
                        AED {parseFloat(b.actual).toFixed(2)}
                      </td>
                      <td className={`px-6 py-4 text-right font-bold whitespace-nowrap ${
                        parseFloat(b.remaining) >= 0 ? "text-emerald-500/90" : "text-rose-500/90"
                      }`}>
                        AED {parseFloat(b.remaining).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-center min-w-32">
                        {showProgressBar ? (
                          <div className="flex items-center justify-center gap-3">
                            <div className="w-20 bg-slate-850 h-2 rounded-full overflow-hidden">
                              <div
                                style={{ width: `${progressVal}%` }}
                                className={`h-full rounded-full ${
                                  b.status === "OVER_BUDGET"
                                    ? "bg-red-500"
                                    : b.status === "NEAR_LIMIT"
                                    ? "bg-amber-500"
                                    : "bg-indigo-500"
                                }`}
                              />
                            </div>
                            <span className="text-xs font-semibold text-slate-400">
                              {parseFloat(b.progressPercent).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">No budget set</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(b.status)}
                      </td>
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEdit(b)}
                            className="rounded-lg p-1.5 hover:bg-slate-800 text-slate-400 hover:text-indigo-400"
                          >
                            <LucideEdit className="h-4.5 w-4.5" />
                          </button>
                          {b.id && (
                            <button
                              onClick={() => handleDeleteClick(b)}
                              className="rounded-lg p-1.5 hover:bg-slate-800 text-slate-400 hover:text-red-400"
                            >
                              <LucideTrash2 className="h-4.5 w-4.5" />
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
      </div>

      {/* Edit Budget overlay */}
      {isFormOpen && editingBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setIsFormOpen(false)}
              className="absolute top-4 right-4 rounded-lg p-1 hover:bg-slate-800 text-slate-400 hover:text-white"
            >
              <LucideX className="h-5 w-5" />
            </button>
            <h3 className="text-xl font-bold text-white mb-1">
              Configure Category Budget
            </h3>
            <p className="text-xs text-slate-400 mb-6">
              Category: <span className="font-semibold text-white">{editingBudget.categoryName}</span> ({getMonthLabel(selectedMonth)})
            </p>

            {formError && (
              <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <input type="hidden" {...register("categoryId")} />
              <input type="hidden" {...register("month")} />

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Planned Monthly Cap (AED)
                </label>
                <input
                  type="number"
                  step="1"
                  placeholder="0.00"
                  {...register("amount")}
                  className="w-full rounded-xl border border-slate-850 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                  autoFocus
                />
                {errors.amount && <span className="text-xs text-red-400">{errors.amount.message}</span>}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-855">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="rounded-xl border border-slate-850 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-850 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95"
                >
                  {isSubmitting && <LucideLoader2 className="h-4 w-4 animate-spin" />}
                  Save Cap
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && budgetToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-white mb-2">Remove Budget Configuration</h3>
            
            <p className="text-sm text-slate-400 mb-4">
              Are you sure you want to remove the budget plan for{" "}
              <span className="font-semibold text-white">{budgetToDelete.categoryName}</span> in{" "}
              <span className="font-semibold text-white">{getMonthLabel(selectedMonth)}</span>?
            </p>

            {parseFloat(budgetToDelete.actual) > 0 && (
              <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-400">
                <strong>Warning:</strong> This category has actual spending of{" "}
                <span className="font-bold">AED {parseFloat(budgetToDelete.actual).toFixed(2)}</span>. 
                Deleting the budget plan will not delete the transactions.
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="rounded-xl border border-slate-850 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-850 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-red-500 active:scale-95"
              >
                Confirm Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
