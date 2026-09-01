"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideSearch,
  LucidePlus,
  LucideTrash2,
  LucideEdit,
} from "lucide-react";
import { DataTable, DataTablePagination } from "@/components/data-table";
import type { ColumnDef } from "@/components/data-table";
import {
  TransactionFormDialog,
  type EditableTransaction,
} from "@/features/transactions/components/transaction-form-dialog";

interface CategoryOption {
  id: string;
  name: string;
  type: string;
}

interface TransactionItem {
  id: string;
  date: string;
  occurredAt: string;
  budgetMonth: string | null;
  categoryId: string;
  categoryName: string;
  categoryType: string;
  description: string;
  amount: string;
  paymentMethod: string;
  accountId: string | null;
  notes: string | null;
  type: "INCOME" | "EXPENSE";
  importSource: string | null;
  adjustedAt: string | null;
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();

  // Filter state
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // When filters change, reset to page 1 by tracking the last filter combination
  const [lastFilterKey, setLastFilterKey] = useState(`${search}:${categoryId}:${typeFilter}`);
  const filterKey = `${search}:${categoryId}:${typeFilter}`;
  const effectivePage = filterKey !== lastFilterKey ? 1 : page;
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  // Dialog state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<EditableTransaction | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<TransactionItem | null>(null);

  // Categories (for filter dropdown — form categories are loaded inside the dialog)
  const { data: categories = [] } = useQuery<CategoryOption[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: txData, isLoading } = useQuery<{
    items: TransactionItem[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  }>({
    queryKey: ["transactions", search, categoryId, typeFilter, effectivePage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(effectivePage),
        pageSize: String(pageSize),
      });
      if (search) params.append("search", search);
      if (categoryId) params.append("categoryId", categoryId);
      if (typeFilter) params.append("type", typeFilter);
      const res = await fetch(`/api/transactions?${params.toString()}`);
      const json = await res.json();
      return json.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setIsDeleteConfirmOpen(false);
      setTransactionToDelete(null);
    },
  });

  const handleOpenAdd = () => {
    setEditingTransaction(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (tx: TransactionItem) => {
    setEditingTransaction({
      id: tx.id,
      date: tx.date,
      categoryId: tx.categoryId,
      description: tx.description,
      amount: tx.amount,
      paymentMethod: tx.paymentMethod,
      accountId: tx.accountId,
      notes: tx.notes,
      type: tx.type,
    });
    setIsFormOpen(true);
  };

  const handleDeleteClick = (tx: TransactionItem) => {
    setTransactionToDelete(tx);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (transactionToDelete) deleteMutation.mutate(transactionToDelete.id);
  };

  // Column definitions for the DataTable primitive
  const columns: ColumnDef<TransactionItem>[] = [
    {
      key: "date",
      header: "Date",
      cell: (tx) => (
        <span className="whitespace-nowrap">
          <span className="block font-medium text-slate-400">
            {new Date(tx.date).toLocaleDateString("en-AE", {
              timeZone: "Asia/Dubai",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="block text-[11px] text-slate-600">
            {new Date(tx.occurredAt).toLocaleTimeString("en-AE", {
              timeZone: "Asia/Dubai",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (tx) => (
        <span className="font-semibold text-white max-w-xs truncate block">
          {tx.description}
          {tx.importSource && (
            <span
              className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                tx.adjustedAt
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
              }`}
            >
              {tx.adjustedAt ? "Imported & Adjusted" : `Imported via ${tx.importSource}`}
            </span>
          )}
          {!tx.importSource && (
            <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              Manual
            </span>
          )}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (tx) => (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 border border-slate-700">
          {tx.categoryName}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideable: true,
      defaultVisible: true,
      cell: (tx) => (
        <span className="text-xs font-semibold text-slate-400">{tx.paymentMethod}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (tx) => (
        <span
          className={`whitespace-nowrap font-bold text-base ${
            tx.type === "INCOME" ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {tx.type === "INCOME" ? "+" : "-"}AED {parseFloat(tx.amount).toFixed(2)}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      hideable: true,
      defaultVisible: true,
      cell: (tx) => (
        <span className="text-slate-500 italic max-w-xs truncate block">
          {tx.notes || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "center",
      cell: (tx) => (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => handleOpenEdit(tx)}
            aria-label={`Edit ${tx.description}`}
            className="rounded-lg p-1.5 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors"
          >
            <LucideEdit className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => handleDeleteClick(tx)}
            aria-label={`Delete ${tx.description}`}
            className="rounded-lg p-1.5 hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
          >
            <LucideTrash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Transactions Ledger"
        description="Review and record details of your cash inflows and outflows."
        action={
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95 shadow-md shadow-indigo-600/10"
          >
            <LucidePlus className="h-4 w-4" aria-hidden="true" />
            Add Transaction
          </button>
        }
      />

      {/* Filters Toolbar */}
      <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm sm:grid-cols-2 lg:grid-cols-4">
        {/* Search */}
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
            <LucideSearch className="h-4 w-4" aria-hidden="true" />
          </span>
          <input
            type="search"
            placeholder="Search description, notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search transactions"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 py-2.5 pl-9 pr-4 text-sm text-slate-200 outline-none transition-colors focus:border-indigo-500"
          />
        </div>

        {/* Category Filter */}
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Filter by category"
          className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-sm text-slate-300 outline-none transition-colors focus:border-indigo-500"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
          className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-sm text-slate-300 outline-none transition-colors focus:border-indigo-500"
        >
          <option value="">All Types</option>
          <option value="INCOME">Income</option>
          <option value="EXPENSE">Expense</option>
        </select>

        {/* Clear Filters */}
        <button
          onClick={() => { setSearch(""); setCategoryId(""); setTypeFilter(""); }}
          className="rounded-xl border border-slate-800 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          Clear Filters
        </button>
      </div>

      {/* Ledger Table */}
      <div className="space-y-3">
        <DataTable
          columns={columns}
          rows={txData?.items ?? []}
          rowKey={(tx) => tx.id}
          isLoading={isLoading}
          emptyState={
            <p className="text-slate-500 text-sm font-medium">
              No transactions found matching the filters.
            </p>
          }
        />
        {txData && (
          <DataTablePagination
            itemLabel="transactions"
            pagination={{
              page: txData.page,
              pageSize: txData.pageSize ?? 10,
              totalItems: txData.totalItems,
              totalPages: txData.totalPages,
            }}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Transaction Form Dialog (shared component — no duplicate form logic) */}
      <TransactionFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        editingTransaction={editingTransaction}
      />

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete Transaction"
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <h2 className="text-lg font-bold text-white mb-2">Delete Transaction</h2>
            <p className="text-sm text-slate-400 mb-6">
              Are you sure you want to delete the transaction{" "}
              <span className="font-semibold text-white">
                &ldquo;{transactionToDelete?.description}&rdquo;
              </span>{" "}
              for{" "}
              <span className="font-semibold text-white">
                AED {transactionToDelete ? parseFloat(transactionToDelete.amount).toFixed(2) : "0.00"}
              </span>
              ? This action is permanent.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="rounded-xl border border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-red-500 active:scale-95"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
