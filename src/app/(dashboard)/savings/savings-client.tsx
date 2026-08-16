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
} from "lucide-react";

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

export default function SavingsClient() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [showTxDialog, setShowTxDialog] = useState<{ goalId: string; type: "DEPOSIT" | "WITHDRAWAL" } | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Form state
  const [txAmount, setTxAmount] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [syncLedger, setSyncLedger] = useState(true);

  const [newGoal, setNewGoal] = useState({
    name: "",
    targetAmount: "",
    targetDate: "",
    notes: "",
  });

  // Fetch goals
  const { data: goals = [], isLoading } = useQuery<SavingGoal[]>({
    queryKey: ["savings", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/savings?status=${statusFilter}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  // Fetch transactions
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

  // Record transaction mutation
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

  // Create goal mutation
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

  // Archive goal mutation
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

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      ACTIVE: { label: "Active", cls: "bg-emerald-500/10 text-emerald-400" },
      COMPLETED: { label: "Completed", cls: "bg-indigo-500/10 text-indigo-400" },
      ARCHIVED: { label: "Archived", cls: "bg-slate-700/50 text-slate-400" },
      PAUSED: { label: "Paused", cls: "bg-amber-500/10 text-amber-400" },
    };
    const s = map[status] || map.ACTIVE;
    return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
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
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 text-sm font-semibold transition-colors"
          >
            <LucidePlus className="h-4 w-4" /> New Goal
          </button>
        }
      />

      {/* Status filter */}
      <div className="flex gap-2">
        {["ACTIVE", "COMPLETED", "ARCHIVED", "PAUSED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === s
                ? "bg-slate-700 text-white"
                : "bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Goals List */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading savings goals...</div>
      ) : goals.length === 0 ? (
        <EmptyState
          icon={LucideTarget}
          title={`No ${statusFilter.toLowerCase()} savings goals`}
          description="Set a target amount and track your progress toward it."
          action={{
            label: "New Goal",
            onClick: () => setShowCreateDialog(true),
            icon: LucidePlus,
            className: "bg-indigo-500 hover:bg-indigo-400 text-white",
          }}
        />
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <div key={goal.id} className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">{goal.name}</h3>
                    {getStatusBadge(goal.status)}
                  </div>
                  {goal.targetDate && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <LucideTarget className="h-3 w-3" /> Target: {formatTargetDate(goal.targetDate)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-indigo-400">AED {parseFloat(goal.currentAmount).toFixed(2)}</p>
                  <p className="text-xs text-slate-500">of AED {parseFloat(goal.targetAmount).toFixed(2)}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Progress</span>
                  <span className="font-bold text-indigo-400">{getProgressPct(goal)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-violet-400 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${getProgressPct(goal)}%` }}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {(goal.status === "ACTIVE" || goal.status === "COMPLETED") && (
                  <>
                    <button
                      onClick={() => { setShowTxDialog({ goalId: goal.id, type: "DEPOSIT" }); setTxAmount(""); }}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <LucideArrowDownCircle className="h-3.5 w-3.5" /> Deposit
                    </button>
                    <button
                      onClick={() => { setShowTxDialog({ goalId: goal.id, type: "WITHDRAWAL" }); setTxAmount(""); }}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      <LucideArrowUpCircle className="h-3.5 w-3.5" /> Withdraw
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowHistory(showHistory === goal.id ? null : goal.id)}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 transition-colors"
                >
                  <LucideCalendarClock className="h-3.5 w-3.5" />
                  {showHistory === goal.id ? "Hide History" : "Transaction History"}
                </button>
                {goal.status === "ACTIVE" && (
                  <button
                    onClick={() => archiveMutation.mutate(goal.id)}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800/40 text-slate-500 hover:text-slate-300 hover:bg-slate-700/40 transition-colors ml-auto"
                  >
                    <LucideArchive className="h-3.5 w-3.5" /> Archive
                  </button>
                )}
              </div>

              {/* Transaction History */}
              {showHistory === goal.id && txData && (
                <div className="border-t border-slate-800 pt-4 mt-2">
                  <h4 className="text-sm font-bold text-slate-300 mb-3">Transaction History</h4>
                  {txData.items.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No transactions recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-800">
                            <th className="text-left pb-2 font-semibold">Date</th>
                            <th className="text-center pb-2 font-semibold">Type</th>
                            <th className="text-right pb-2 font-semibold">Amount</th>
                            <th className="text-right pb-2 font-semibold">Before</th>
                            <th className="text-right pb-2 font-semibold">After</th>
                            <th className="text-center pb-2 font-semibold">Ledger</th>
                          </tr>
                        </thead>
                        <tbody>
                          {txData.items.map((tx) => (
                            <tr key={tx.id} className="border-b border-slate-800/50">
                              <td className="py-2.5 text-slate-300">
                                {new Date(tx.transactionDate).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", month: "short", day: "numeric", year: "numeric" })}
                              </td>
                              <td className="py-2.5 text-center">
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                  tx.type === "DEPOSIT" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                                }`}>
                                  {tx.type}
                                </span>
                              </td>
                              <td className={`py-2.5 text-right font-bold ${tx.type === "DEPOSIT" ? "text-emerald-400" : "text-amber-400"}`}>
                                AED {parseFloat(tx.amount).toFixed(2)}
                              </td>
                              <td className="py-2.5 text-right text-slate-400">AED {parseFloat(tx.balanceBefore).toFixed(2)}</td>
                              <td className="py-2.5 text-right text-slate-300">AED {parseFloat(tx.balanceAfter).toFixed(2)}</td>
                              <td className="py-2.5 text-center">
                                {tx.transactionStatus === "LINKED" ? (
                                  <span className="text-emerald-400 text-[10px] font-bold">Linked</span>
                                ) : (
                                  <span className="text-slate-500 text-[10px] flex items-center justify-center gap-0.5" title="Not included in cash flow">
                                    <LucideInfo className="h-3 w-3" /> Unlinked
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
            </div>
          ))}
        </div>
      )}

      {/* Deposit / Withdrawal Dialog */}
      {showTxDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowTxDialog(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                {showTxDialog.type === "DEPOSIT" ? "Make a Deposit" : "Record Withdrawal"}
              </h3>
              <button onClick={() => setShowTxDialog(null)} className="text-slate-400 hover:text-white"><LucideX className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Amount (AED)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="e.g. Monthly deposit"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={syncLedger} onChange={(e) => setSyncLedger(e.target.checked)} className="rounded" />
                <span className="text-xs text-slate-300">Add to ledger (cash-flow tracking)</span>
              </label>
              {!syncLedger && (
                <p className="text-[10px] text-amber-400 flex items-center gap-1"><LucideInfo className="h-3 w-3" /> This transaction will not appear in cash-flow totals.</p>
              )}
            </div>
            {txMutation.error && (
              <p className="text-xs text-rose-400">{(txMutation.error as Error).message}</p>
            )}
            <button
              onClick={() => txMutation.mutate({ goalId: showTxDialog.goalId, amount: txAmount, type: showTxDialog.type, notes: txNotes, sync: syncLedger })}
              disabled={txMutation.isPending}
              className={`w-full font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50 ${
                showTxDialog.type === "DEPOSIT"
                  ? "bg-emerald-500 hover:bg-emerald-400 text-white"
                  : "bg-amber-500 hover:bg-amber-400 text-white"
              }`}
            >
              {txMutation.isPending ? "Processing..." : showTxDialog.type === "DEPOSIT" ? "Confirm Deposit" : "Confirm Withdrawal"}
            </button>
          </div>
        </div>
      )}

      {/* Create Goal Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateDialog(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Create Savings Goal</h3>
              <button onClick={() => setShowCreateDialog(false)} className="text-slate-400 hover:text-white"><LucideX className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Goal Name</label>
                <input type="text" value={newGoal.name} onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Emergency Fund" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Target Amount</label>
                  <input type="number" step="0.01" value={newGoal.targetAmount} onChange={(e) => setNewGoal({ ...newGoal, targetAmount: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Target Date</label>
                  <input type="date" value={newGoal.targetDate} onChange={(e) => setNewGoal({ ...newGoal, targetDate: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Notes (optional)</label>
                <input type="text" value={newGoal.notes} onChange={(e) => setNewGoal({ ...newGoal, notes: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="Optional notes" />
              </div>
            </div>
            {createMutation.error && (
              <p className="text-xs text-rose-400">{(createMutation.error as Error).message}</p>
            )}
            <button
              onClick={() => createMutation.mutate(newGoal)}
              disabled={createMutation.isPending}
              className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create Goal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
