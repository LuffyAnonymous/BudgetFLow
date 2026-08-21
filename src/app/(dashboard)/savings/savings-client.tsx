"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  LucidePlus,
  LucideX,
  LucideArrowUpCircle,
  LucideArrowDownCircle,
  LucideCalendarClock,
  LucideInfo,
  LucideArchive,
  LucideTarget,
  LucideLoader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import type { Tone } from "@/components/ui/stat-tile";

interface SavingGoal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  targetDate: string | null;
  status: string;
  notes: string | null;
  categoryId: string | null;
  categoryName: string | null;
  version: number;
  createdAt: string;
}

interface SavingTx {
  id: string;
  savingGoalId: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  type: string;
  transactionDate: string;
  notes: string | null;
  transactionId: string | null;
  transactionStatus: string;
  createdAt: string;
}

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "emerald" },
  COMPLETED: { label: "Completed", tone: "indigo" },
  ARCHIVED: { label: "Archived", tone: "slate" },
  PAUSED: { label: "Paused", tone: "amber" },
};

export default function SavingsClient() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [showTxDialog, setShowTxDialog] = useState<{ goalId: string; type: "DEPOSIT" | "WITHDRAWAL" } | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const [txAmount, setTxAmount] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [syncLedger, setSyncLedger] = useState(true);

  const [newGoal, setNewGoal] = useState({
    name: "",
    targetAmount: "",
    targetDate: "",
    notes: "",
  });

  const { data: goals = [], isLoading } = useQuery<SavingGoal[]>({
    queryKey: ["savings", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/savings?status=${statusFilter}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: txData } = useQuery<{
    items: SavingTx[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  }>({
    queryKey: ["savingTxs", showHistory],
    queryFn: async () => {
      const res = await fetch(`/api/savings/${showHistory}/transactions?pageSize=50`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!showHistory,
  });

  const txMutation = useMutation({
    mutationFn: async ({ goalId, amount, type, notes, sync }: { goalId: string; amount: string; type: string; notes: string; sync: boolean }) => {
      const res = await fetch(`/api/savings/${goalId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(amount),
          type,
          transactionDate: new Date().toISOString(),
          notes: notes || null,
          syncLedger: sync,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["savings"] });
      queryClient.invalidateQueries({ queryKey: ["savingTxs"] });
      setShowTxDialog(null);
      setTxAmount("");
      setTxNotes("");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newGoal) => {
      const res = await fetch("/api/savings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          targetAmount: parseFloat(data.targetAmount),
          targetDate: data.targetDate || null,
          notes: data.notes || null,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["savings"] });
      setShowCreateDialog(false);
      setNewGoal({ name: "", targetAmount: "", targetDate: "", notes: "" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const res = await fetch(`/api/savings/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["savings"] });
    },
  });

  const getProgressPct = (goal: SavingGoal) => {
    const target = parseFloat(goal.targetAmount);
    const current = parseFloat(goal.currentAmount);
    if (target <= 0) return 0;
    return Math.min(100, Math.round((current / target) * 100));
  };

  const formatTargetDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString("en-AE", {
      timeZone: "Asia/Dubai",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Savings Goals"
        description="Track your savings progress, make deposits, and record withdrawals."
        action={
          <Button variant="primary" onClick={() => setShowCreateDialog(true)}>
            <LucidePlus className="h-4 w-4" aria-hidden="true" /> New Goal
          </Button>
        }
      />

      {/* Status filter */}
      <div className="flex gap-2" role="tablist" aria-label="Filter by goal status">
        {["ACTIVE", "COMPLETED", "ARCHIVED", "PAUSED"].map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors " +
              (statusFilter === s ? "bg-indigo-600 text-white" : "bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300")
            }
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Goals List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
          <LucideLoader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
          <p className="text-sm">Loading savings goals…</p>
        </div>
      ) : goals.length === 0 ? (
        <EmptyState
          icon={LucideTarget}
          title={`No ${statusFilter.toLowerCase()} savings goals`}
          description="Set a target amount and track your progress toward it."
          action={{
            label: "New Goal",
            onClick: () => setShowCreateDialog(true),
            icon: LucidePlus,
            className: "bg-indigo-600 hover:bg-indigo-500 text-white",
          }}
        />
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => {
            const meta = statusMeta[goal.status] || statusMeta.ACTIVE;
            return (
              <Card key={goal.id} className="space-y-4 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">{goal.name}</h3>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    {goal.targetDate && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <LucideTarget className="h-3 w-3" aria-hidden="true" /> Target: {formatTargetDate(goal.targetDate)}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold tabular-nums text-indigo-400">AED {parseFloat(goal.currentAmount).toFixed(2)}</p>
                    <p className="text-xs tabular-nums text-slate-500">of AED {parseFloat(goal.targetAmount).toFixed(2)}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-slate-400">Progress</span>
                    <span className="font-bold tabular-nums text-indigo-400">{getProgressPct(goal)}%</span>
                  </div>
                  <ProgressBar value={getProgressPct(goal)} tone="indigo" />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {(goal.status === "ACTIVE" || goal.status === "COMPLETED") && (
                    <>
                      <button
                        onClick={() => {
                          setShowTxDialog({ goalId: goal.id, type: "DEPOSIT" });
                          setTxAmount("");
                        }}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                      >
                        <LucideArrowDownCircle className="h-3.5 w-3.5" aria-hidden="true" /> Deposit
                      </button>
                      <button
                        onClick={() => {
                          setShowTxDialog({ goalId: goal.id, type: "WITHDRAWAL" });
                          setTxAmount("");
                        }}
                        className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/20"
                      >
                        <LucideArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" /> Withdraw
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setShowHistory(showHistory === goal.id ? null : goal.id)}
                    className="flex items-center gap-1 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/60"
                    aria-expanded={showHistory === goal.id}
                  >
                    <LucideCalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {showHistory === goal.id ? "Hide History" : "Transaction History"}
                  </button>
                  {goal.status === "ACTIVE" && (
                    <button
                      onClick={() => archiveMutation.mutate(goal.id)}
                      className="ml-auto flex items-center gap-1 rounded-lg bg-slate-800/40 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-700/40 hover:text-slate-300"
                    >
                      <LucideArchive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
                    </button>
                  )}
                </div>

                {showHistory === goal.id && txData && (
                  <div className="mt-2 border-t border-slate-800 pt-4">
                    <h4 className="mb-3 text-sm font-bold text-slate-300">Transaction History</h4>
                    {txData.items.length === 0 ? (
                      <p className="text-xs italic text-slate-500">No transactions recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-500">
                              <th className="pb-2 text-left font-semibold">Date</th>
                              <th className="pb-2 text-center font-semibold">Type</th>
                              <th className="pb-2 text-right font-semibold">Amount</th>
                              <th className="pb-2 text-right font-semibold">Before</th>
                              <th className="pb-2 text-right font-semibold">After</th>
                              <th className="pb-2 text-center font-semibold">Ledger</th>
                            </tr>
                          </thead>
                          <tbody>
                            {txData.items.map((tx) => (
                              <tr key={tx.id} className="border-b border-slate-800/50">
                                <td className="py-2.5 text-slate-300">
                                  {new Date(tx.transactionDate).toLocaleDateString("en-AE", {
                                    timeZone: "Asia/Dubai",
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </td>
                                <td className="py-2.5 text-center">
                                  <Badge tone={tx.type === "DEPOSIT" ? "emerald" : "amber"}>{tx.type}</Badge>
                                </td>
                                <td
                                  className={
                                    "py-2.5 text-right font-bold tabular-nums " + (tx.type === "DEPOSIT" ? "text-emerald-400" : "text-amber-400")
                                  }
                                >
                                  AED {parseFloat(tx.amount).toFixed(2)}
                                </td>
                                <td className="py-2.5 text-right tabular-nums text-slate-400">AED {parseFloat(tx.balanceBefore).toFixed(2)}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-300">AED {parseFloat(tx.balanceAfter).toFixed(2)}</td>
                                <td className="py-2.5 text-center">
                                  {tx.transactionStatus === "LINKED" ? (
                                    <span className="text-[10px] font-bold text-emerald-400">Linked</span>
                                  ) : (
                                    <span
                                      className="flex items-center justify-center gap-0.5 text-[10px] text-slate-500"
                                      title="Not included in cash flow"
                                    >
                                      <LucideInfo className="h-3 w-3" aria-hidden="true" /> Unlinked
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Deposit / Withdrawal Dialog */}
      {showTxDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowTxDialog(null)}
        >
          <Card className="w-full max-w-md space-y-4 border-slate-700 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{showTxDialog.type === "DEPOSIT" ? "Make a Deposit" : "Record Withdrawal"}</h3>
              <button onClick={() => setShowTxDialog(null)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                <LucideX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="tx-amount" className="mb-1 block text-xs font-semibold text-slate-400">
                  Amount (AED)
                </label>
                <input
                  id="tx-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="tx-notes" className="mb-1 block text-xs font-semibold text-slate-400">
                  Notes (optional)
                </label>
                <input
                  id="tx-notes"
                  type="text"
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="e.g. Monthly deposit"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={syncLedger} onChange={(e) => setSyncLedger(e.target.checked)} className="rounded" />
                <span className="text-xs text-slate-300">Add to ledger (cash-flow tracking)</span>
              </label>
              {!syncLedger && (
                <p className="flex items-center gap-1 text-[10px] text-amber-400">
                  <LucideInfo className="h-3 w-3" aria-hidden="true" /> This transaction will not appear in cash-flow totals.
                </p>
              )}
            </div>
            {txMutation.error && (
              <p role="alert" aria-live="polite" className="text-xs text-rose-400">
                {(txMutation.error as Error).message}
              </p>
            )}
            <button
              onClick={() => txMutation.mutate({ goalId: showTxDialog.goalId, amount: txAmount, type: showTxDialog.type, notes: txNotes, sync: syncLedger })}
              disabled={txMutation.isPending}
              className={
                "w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 " +
                (showTxDialog.type === "DEPOSIT" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500")
              }
            >
              {txMutation.isPending ? "Processing…" : showTxDialog.type === "DEPOSIT" ? "Confirm Deposit" : "Confirm Withdrawal"}
            </button>
          </Card>
        </div>
      )}

      {/* Create Goal Dialog */}
      {showCreateDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowCreateDialog(false)}
        >
          <Card className="w-full max-w-md space-y-4 border-slate-700 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Create Savings Goal</h3>
              <button onClick={() => setShowCreateDialog(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                <LucideX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="goal-name" className="mb-1 block text-xs font-semibold text-slate-400">
                  Goal Name
                </label>
                <input
                  id="goal-name"
                  type="text"
                  value={newGoal.name}
                  onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="e.g. Emergency Fund"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="goal-target" className="mb-1 block text-xs font-semibold text-slate-400">
                    Target Amount
                  </label>
                  <input
                    id="goal-target"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={newGoal.targetAmount}
                    onChange={(e) => setNewGoal({ ...newGoal, targetAmount: e.target.value })}
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label htmlFor="goal-date" className="mb-1 block text-xs font-semibold text-slate-400">
                    Target Date
                  </label>
                  <input
                    id="goal-date"
                    type="date"
                    value={newGoal.targetDate}
                    onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="goal-notes" className="mb-1 block text-xs font-semibold text-slate-400">
                  Notes (optional)
                </label>
                <input
                  id="goal-notes"
                  type="text"
                  value={newGoal.notes}
                  onChange={(e) => setNewGoal({ ...newGoal, notes: e.target.value })}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="Optional notes"
                />
              </div>
            </div>
            {createMutation.error && (
              <p role="alert" aria-live="polite" className="text-xs text-rose-400">
                {(createMutation.error as Error).message}
              </p>
            )}
            <Button variant="primary" className="w-full" onClick={() => createMutation.mutate(newGoal)} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Goal"}
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
