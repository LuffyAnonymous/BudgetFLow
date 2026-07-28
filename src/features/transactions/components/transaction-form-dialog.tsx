"use client";

/**
 * TransactionFormDialog
 *
 * Reusable dialog for creating and editing INCOME/EXPENSE transactions.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionFormSchema } from "@/features/transactions/schemas/transaction.schema";
import { z } from "zod";
import { LucideX, LucideLoader2 } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type FormValues = z.infer<typeof transactionFormSchema>;

interface CategoryOption {
  id: string;
  name: string;
  type: string;
}

export interface EditableTransaction {
  id: string;
  date: string;
  budgetMonth?: string | null;
  categoryId: string;
  description: string;
  amount: string;
  paymentMethod: string;
  notes: string | null;
  type: "INCOME" | "EXPENSE";
}

interface TransactionFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultType?: "INCOME" | "EXPENSE";
  editingTransaction?: EditableTransaction | null;
}

export function TransactionFormDialog({
  isOpen,
  onClose,
  onSuccess,
  defaultType = "EXPENSE",
  editingTransaction,
}: TransactionFormDialogProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen);

  const { data: categories = [] } = useQuery<CategoryOption[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.data || [];
    },
    enabled: isOpen,
  });

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<any>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      budgetMonth: "",
      categoryId: "",
      description: "",
      amount: "",
      paymentMethod: "",
      notes: "",
      type: defaultType,
    },
  });

  const selectedType = useWatch({ control, name: "type" });
  const watchedCategoryId = useWatch({ control, name: "categoryId" });

  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (selectedType === "INCOME") return cat.type === "INCOME";
      return cat.type === "FIXED_EXPENSE" || cat.type === "VARIABLE_EXPENSE";
    });
  }, [categories, selectedType]);

  useEffect(() => {
    if (watchedCategoryId) {
      const stillValid = filteredCategories.some((c) => c.id === watchedCategoryId);
      if (!stillValid) {
        setValue("categoryId", "");
      }
    }
  }, [selectedType, watchedCategoryId, filteredCategories, setValue]);

  useEffect(() => {
    if (!isOpen) return;
    if (editingTransaction) {
      reset({
        date: editingTransaction.date.split("T")[0],
        budgetMonth: editingTransaction.budgetMonth || "",
        categoryId: editingTransaction.categoryId,
        description: editingTransaction.description,
        amount: editingTransaction.amount,
        paymentMethod: editingTransaction.paymentMethod,
        notes: editingTransaction.notes || "",
        type: editingTransaction.type,
      });
    } else {
      reset({
        date: new Date().toISOString().split("T")[0],
        budgetMonth: "",
        categoryId: "",
        description: "",
        amount: "",
        paymentMethod: "",
        notes: "",
        type: defaultType,
      });
    }
  }, [isOpen, editingTransaction, defaultType, reset]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          budgetMonth: data.budgetMonth || null,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onSuccess?.();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<FormValues> }) => {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          budgetMonth: data.budgetMonth !== undefined ? (data.budgetMonth || null) : undefined,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onSuccess?.();
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const onSubmit = (data: FormValues) => {
    setFormError(null);
    if (editingTransaction) {
      updateMutation.mutate({ id: editingTransaction.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        ref={panelRef}
        className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LucideX className="h-5 w-5" />
        </button>

        <h2 id="tx-dialog-title" className="text-xl font-bold text-white mb-4">
          {editingTransaction ? "Edit Transaction" : "Record Transaction"}
        </h2>

        {formError && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
          >
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Type Select */}
          <div className="space-y-1.5">
            <label htmlFor="tx-type" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Type
            </label>
            <select
              id="tx-type"
              {...register("type")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="EXPENSE">Expense</option>
              <option value="INCOME">Income</option>
            </select>
            {errors.type && <span className="text-xs text-red-400" role="alert">{String(errors.type.message)}</span>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Date */}
            <div className="space-y-1.5">
              <label htmlFor="tx-date" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Bank Transaction Date
              </label>
              <input
                id="tx-date"
                type="date"
                {...register("date")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
              {errors.date && <span className="text-xs text-red-400" role="alert">{String(errors.date.message)}</span>}
            </div>

            {/* Applicable Budget Month */}
            <div className="space-y-1.5">
              <label htmlFor="tx-budgetMonth" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Applicable Budget Month
              </label>
              <input
                id="tx-budgetMonth"
                type="month"
                placeholder="YYYY-MM"
                {...register("budgetMonth")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
              {errors.budgetMonth && <span className="text-xs text-red-400" role="alert">{String(errors.budgetMonth.message)}</span>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Amount */}
            <div className="space-y-1.5">
              <label htmlFor="tx-amount" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Amount (AED)
              </label>
              <input
                id="tx-amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register("amount")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
              {errors.amount && <span className="text-xs text-red-400" role="alert">{String(errors.amount.message)}</span>}
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <label htmlFor="tx-category" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Category
              </label>
              <select
                id="tx-category"
                {...register("categoryId")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              >
                <option value="">Select Category</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              {errors.categoryId && <span className="text-xs text-red-400" role="alert">{String(errors.categoryId.message)}</span>}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="tx-description" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Description
            </label>
            <input
              id="tx-description"
              type="text"
              placeholder="e.g. Salary or Lunch"
              {...register("description")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            />
            {errors.description && <span className="text-xs text-red-400" role="alert">{String(errors.description.message)}</span>}
          </div>

          {/* Payment Method */}
          <div className="space-y-1.5">
            <label htmlFor="tx-method" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Payment Method
            </label>
            <input
              id="tx-method"
              type="text"
              placeholder="e.g. Card, Cash, Bank Transfer"
              {...register("paymentMethod")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            />
            {errors.paymentMethod && <span className="text-xs text-red-400" role="alert">{String(errors.paymentMethod.message)}</span>}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label htmlFor="tx-notes" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Notes (Optional)
            </label>
            <textarea
              id="tx-notes"
              rows={2}
              placeholder="Additional notes..."
              {...register("notes")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 resize-none"
            />
            {errors.notes && <span className="text-xs text-red-400" role="alert">{String(errors.notes.message)}</span>}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
              className="inline-flex items-center space-x-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              {(isSubmitting || createMutation.isPending || updateMutation.isPending) && (
                <LucideLoader2 className="h-4 w-4 animate-spin" />
              )}
              <span>{editingTransaction ? "Save Changes" : "Create Transaction"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
