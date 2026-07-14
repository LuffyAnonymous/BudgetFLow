"use client";

/**
 * TransactionFormDialog
 *
 * Reusable dialog for creating and editing INCOME/EXPENSE transactions.
 *
 * Can be mounted from:
 *   - /transactions page (as the primary add/edit form)
 *   - Dashboard quick actions (Add Income, Add Expense)
 *
 * All form validation, category compatibility enforcement, and mutation
 * logic are encapsulated here. The transactions page replaces its own
 * form with this component; it does NOT maintain two versions.
 *
 * Props:
 *   isOpen            Whether the dialog is visible.
 *   onClose           Called when the dialog is closed (cancel or success).
 *   onSuccess         Called after a successful create or update. Callers
 *                     use this to invalidate their own queries.
 *   defaultType       Pre-select "INCOME" or "EXPENSE" (for quick actions).
 *   editingTransaction If set, the form renders in edit mode.
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
  /** Called after a successful create or update. Invalidate queries here. */
  onSuccess?: () => void;
  /** For quick actions: pre-select the transaction type */
  defaultType?: "INCOME" | "EXPENSE";
  /** If provided, the dialog renders in edit mode */
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

  // Load categories (shared cache via queryClient)
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
      categoryId: "",
      description: "",
      amount: "",
      paymentMethod: "",
      notes: "",
      type: defaultType,
    },
  });

  // useWatch() is the React Compiler-compatible alternative to watch() —
  // it uses the same subscription model but is declared as a React hook,
  // which React Compiler can safely analyze.
  const selectedType = useWatch({ control, name: "type" });
  const watchedCategoryId = useWatch({ control, name: "categoryId" });

  // Category compatibility filtering
  const filteredCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (selectedType === "INCOME") return cat.type === "INCOME";
      return cat.type === "FIXED_EXPENSE" || cat.type === "VARIABLE_EXPENSE";
    });
  }, [categories, selectedType]);

  // Reset category when type changes and current selection becomes incompatible
  useEffect(() => {
    if (watchedCategoryId) {
      const stillValid = filteredCategories.some((c) => c.id === watchedCategoryId);
      if (!stillValid) {
        setValue("categoryId", "");
      }
    }
  }, [selectedType, watchedCategoryId, filteredCategories, setValue]);

  // Populate form when editingTransaction or defaultType changes
  useEffect(() => {
    if (!isOpen) return;
    if (editingTransaction) {
      reset({
        date: editingTransaction.date.split("T")[0],
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
        categoryId: "",
        description: "",
        amount: "",
        paymentMethod: "",
        notes: "",
        type: defaultType,
      });
    }
    // Note: formError is cleared by mutation onSuccess handlers, not here.
    // Clearing state inside an effect triggers cascading renders (react-hooks/set-state-in-effect).
  }, [isOpen, editingTransaction, defaultType, reset]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      // Invalidate transactions + dashboard (quick action on dashboard must refresh cards)
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
        body: JSON.stringify(data),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = { ...data };
    if (editingTransaction) {
      updateMutation.mutate({ id: editingTransaction.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  // Focus trap: close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      aria-hidden={!isOpen}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={editingTransaction ? "Edit Transaction" : "Record Transaction"}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          onClick={handleClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 rounded-lg p-1 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <LucideX className="h-5 w-5" aria-hidden="true" />
        </button>

        <h2 className="text-xl font-bold text-white mb-4">
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
                Date
              </label>
              <input
                id="tx-date"
                type="date"
                {...register("date")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
              />
              {errors.date && <span className="text-xs text-red-400" role="alert">{String(errors.date.message)}</span>}
            </div>

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
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label htmlFor="tx-category" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Category
            </label>
            <select
              id="tx-category"
              {...register("categoryId")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            >
              <option value="">Select Category</option>
              {filteredCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            {errors.categoryId && <span className="text-xs text-red-400" role="alert">{String(errors.categoryId.message)}</span>}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="tx-description" className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Description
            </label>
            <input
              id="tx-description"
              type="text"
              placeholder="e.g. Lunch at Dubai Mall"
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
              placeholder="e.g. Emirates NBD Credit Card, Cash"
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
              placeholder="Add additional notes here..."
              {...register("notes")}
              rows={2}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500 resize-none"
            />
            {errors.notes && <span className="text-xs text-red-400" role="alert">{String(errors.notes.message)}</span>}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95 disabled:opacity-50"
            >
              {isSubmitting && <LucideLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editingTransaction ? "Save Changes" : "Record Transaction"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
