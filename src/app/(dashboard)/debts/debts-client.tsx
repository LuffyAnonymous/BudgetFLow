"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucidePlus,
  LucideX,
  LucideCalendarClock,
  LucideCircleAlert,
  LucideInfo,
  LucideCheck,
  LucideArchive,
  LucideCalculator,
} from "lucide-react";

interface Debt {
  id: string;
  name: string;
  originalBalance: string;
  currentBalance: string;
  monthlyPayment: string;
  dueDay: number;
  rolloverFeeRate: string;
  status: string;
  notes: string | null;
  categoryId: string | null;
  categoryName: string | null;
  version: number;
  createdAt: string;
}

interface Payment {
  id: string;
  debtId: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  paymentDate: string;
  notes: string | null;
  transactionId: string | null;
  transactionStatus: string;
  createdAt: string;
}

interface ProjectionMonth {
  monthIndex: number;
  startingBalance: string;
  payment: string;
  remainingAfterPayment: string;
  estimatedRolloverFee: string;
  projectedEndingBalance: string;
}

interface Projection {
  debtId: string;
  debtName: string;
  startingBalance: string;
  monthlyPayment: string;
  rolloverFeeRate: string;
  payoffMonthIndex: number | null;
  totalProjectedPayments: string;
  totalProjectedFees: string;
  projections: ProjectionMonth[];
  disclaimer: string;
}

interface DebtDetail extends Debt {
  projection: Projection;
}

export default function DebtsClient() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [showPaymentDialog, setShowPaymentDialog] = useState<string | null>(null);
  const [showProjection, setShowProjection] = useState<string | null>(null);
  const [showPaymentHistory, setShowPaymentHistory] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectionMonths, setProjectionMonths] = useState(12);

  // Form state
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [syncLedger, setSyncLedger] = useState(true);

  const [newDebt, setNewDebt] = useState({
    name: "",
    originalBalance: "",
    monthlyPayment: "",
    dueDay: "25",
    rolloverFeeRate: "0",
    notes: "",
  });

  // Fetch debts
  const { data: debts = [], isLoading } = useQuery<Debt[]>({
    queryKey: ["debts", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/debts?status=${statusFilter}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  // Fetch debt detail (with projection)
  const { data: debtDetail } = useQuery<DebtDetail>({
    queryKey: ["debtDetail", showProjection],
    queryFn: async () => {
      const res = await fetch(`/api/debts/${showProjection}`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!showProjection,
  });

  // Fetch payments
  const { data: paymentsData } = useQuery<{
    items: Payment[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  }>({
    queryKey: ["debtPayments", showPaymentHistory],
    queryFn: async () => {
      const res = await fetch(`/api/debts/${showPaymentHistory}/payments?pageSize=50`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!showPaymentHistory,
  });

  // Record payment mutation
  const paymentMutation = useMutation({
    mutationFn: async ({ debtId, amount, notes, sync }: { debtId: string; amount: string; notes: string; sync: boolean }) => {
      const res = await fetch(`/api/debts/${debtId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(amount),
          paymentDate: new Date().toISOString(),
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
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      queryClient.invalidateQueries({ queryKey: ["debtPayments"] });
      queryClient.invalidateQueries({ queryKey: ["debtDetail"] });
      setShowPaymentDialog(null);
      setPaymentAmount("");
      setPaymentNotes("");
    },
  });

  // Create debt mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof newDebt) => {
      const res = await fetch("/api/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          originalBalance: parseFloat(data.originalBalance),
          monthlyPayment: parseFloat(data.monthlyPayment),
          dueDay: parseInt(data.dueDay),
          rolloverFeeRate: parseFloat(data.rolloverFeeRate),
          notes: data.notes || null,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      setShowCreateDialog(false);
      setNewDebt({ name: "", originalBalance: "", monthlyPayment: "", dueDay: "25", rolloverFeeRate: "0", notes: "" });
    },
  });

  // Archive debt mutation
  const archiveMutation = useMutation({
    mutationFn: async (debtId: string) => {
      const res = await fetch(`/api/debts/${debtId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });

  const getProgressPct = (debt: Debt) => {
    const orig = parseFloat(debt.originalBalance);
    const cur = parseFloat(debt.currentBalance);
    if (orig <= 0) return 100;
    return Math.min(100, Math.round(((orig - cur) / orig) * 100));
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      ACTIVE: { label: "Active", cls: "bg-emerald-500/10 text-emerald-400" },
      PAID: { label: "Paid Off", cls: "bg-indigo-500/10 text-indigo-400" },
      ARCHIVED: { label: "Archived", cls: "bg-slate-700/50 text-slate-400" },
      PAUSED: { label: "Paused", cls: "bg-amber-500/10 text-amber-400" },
    };
    const s = map[status] || map.ACTIVE;
    return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
  };

  const projection = debtDetail?.projection;
  const visibleProjections = projection?.projections.slice(0, projectionMonths) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Debt Tracker"
        description="Monitor outstanding debt balances, record payments, and view payoff projections."
        action={
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white px-4 py-2 text-sm font-semibold transition-colors"
          >
            <LucidePlus className="h-4 w-4" /> Add Debt
          </button>
        }
      />

      {/* Status filter */}
      <div className="flex gap-2">
        {["ACTIVE", "PAID", "ARCHIVED", "PAUSED"].map((s) => (
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

      {/* Debts List */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading debts...</div>
      ) : debts.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
          <p className="text-slate-400">No {statusFilter.toLowerCase()} debts found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {debts.map((debt) => (
            <div key={debt.id} className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">{debt.name}</h3>
                    {getStatusBadge(debt.status)}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Due day: {debt.dueDay} of each month</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white">AED {parseFloat(debt.currentBalance).toFixed(2)}</p>
                  <p className="text-xs text-slate-500">of AED {parseFloat(debt.originalBalance).toFixed(2)}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Payment Progress</span>
                  <span className="font-bold text-emerald-400">{getProgressPct(debt)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${getProgressPct(debt)}%` }}
                  />
                </div>
              </div>

              {/* Details row */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-950/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Monthly Payment</p>
                  <p className="font-bold text-sm text-slate-200 mt-1">AED {parseFloat(debt.monthlyPayment).toFixed(2)}</p>
                </div>
                <div className="bg-slate-950/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Due Day</p>
                  <p className="font-bold text-sm text-slate-200 mt-1">{debt.dueDay}</p>
                </div>
                <div className="bg-slate-950/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Fee Rate</p>
                  <p className="font-bold text-sm text-slate-200 mt-1">{parseFloat(debt.rolloverFeeRate).toFixed(2)}%</p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {(debt.status === "ACTIVE" || debt.status === "PAUSED") && (
                  <button
                    onClick={() => { setShowPaymentDialog(debt.id); setPaymentAmount(Math.min(parseFloat(debt.currentBalance), parseFloat(debt.monthlyPayment)).toFixed(2)); }}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <LucideCheck className="h-3.5 w-3.5" /> Record Payment
                  </button>
                )}
                <button
                  onClick={() => setShowPaymentHistory(showPaymentHistory === debt.id ? null : debt.id)}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 transition-colors"
                >
                  <LucideCalendarClock className="h-3.5 w-3.5" />
                  {showPaymentHistory === debt.id ? "Hide History" : "Payment History"}
                </button>
                <button
                  onClick={() => setShowProjection(showProjection === debt.id ? null : debt.id)}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                >
                  <LucideCalculator className="h-3.5 w-3.5" />
                  {showProjection === debt.id ? "Hide Projection" : "Payoff Projection"}
                </button>
                {debt.status === "ACTIVE" && (
                  <button
                    onClick={() => archiveMutation.mutate(debt.id)}
                    className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800/40 text-slate-500 hover:text-slate-300 hover:bg-slate-700/40 transition-colors ml-auto"
                  >
                    <LucideArchive className="h-3.5 w-3.5" /> Archive
                  </button>
                )}
              </div>

              {/* Payment History */}
              {showPaymentHistory === debt.id && paymentsData && (
                <div className="border-t border-slate-800 pt-4 mt-2">
                  <h4 className="text-sm font-bold text-slate-300 mb-3">Payment History</h4>
                  {paymentsData.items.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No payments recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-800">
                            <th className="text-left pb-2 font-semibold">Date</th>
                            <th className="text-right pb-2 font-semibold">Amount</th>
                            <th className="text-right pb-2 font-semibold">Before</th>
                            <th className="text-right pb-2 font-semibold">After</th>
                            <th className="text-center pb-2 font-semibold">Ledger</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentsData.items.map((p) => (
                            <tr key={p.id} className="border-b border-slate-800/50">
                              <td className="py-2.5 text-slate-300">
                                {new Date(p.paymentDate).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", month: "short", day: "numeric", year: "numeric" })}
                              </td>
                              <td className="py-2.5 text-right font-bold text-emerald-400">AED {parseFloat(p.amount).toFixed(2)}</td>
                              <td className="py-2.5 text-right text-slate-400">AED {parseFloat(p.balanceBefore).toFixed(2)}</td>
                              <td className="py-2.5 text-right text-slate-300">AED {parseFloat(p.balanceAfter).toFixed(2)}</td>
                              <td className="py-2.5 text-center">
                                {p.transactionStatus === "LINKED" ? (
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

              {/* Projection */}
              {showProjection === debt.id && projection && (
                <div className="border-t border-slate-800 pt-4 mt-2 space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="text-sm font-bold text-slate-300">Payoff Projection</h4>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-slate-500 uppercase tracking-wide">Months:</label>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={projectionMonths}
                        onChange={(e) => setProjectionMonths(Math.min(36, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="w-14 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-center"
                      />
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Starting Balance</p>
                      <p className="font-bold text-sm text-white mt-1">AED {parseFloat(projection.startingBalance).toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Payoff In</p>
                      <p className="font-bold text-sm text-indigo-400 mt-1">{projection.payoffMonthIndex ? `${projection.payoffMonthIndex} months` : "> 36 months"}</p>
                    </div>
                    <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Total Payments</p>
                      <p className="font-bold text-sm text-emerald-400 mt-1">AED {parseFloat(projection.totalProjectedPayments).toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-950/40 rounded-xl p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Est. Total Fees</p>
                      <p className="font-bold text-sm text-rose-400 mt-1">AED {parseFloat(projection.totalProjectedFees).toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Projection table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-800">
                          <th className="text-left pb-2 font-semibold">Month</th>
                          <th className="text-right pb-2 font-semibold">Start</th>
                          <th className="text-right pb-2 font-semibold">Payment</th>
                          <th className="text-right pb-2 font-semibold">Est. Fee</th>
                          <th className="text-right pb-2 font-semibold">End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleProjections.map((p) => (
                          <tr key={p.monthIndex} className="border-b border-slate-800/50">
                            <td className="py-2 text-slate-400">Month {p.monthIndex}</td>
                            <td className="py-2 text-right text-slate-300">AED {parseFloat(p.startingBalance).toFixed(2)}</td>
                            <td className="py-2 text-right text-emerald-400">AED {parseFloat(p.payment).toFixed(2)}</td>
                            <td className="py-2 text-right text-rose-400">AED {parseFloat(p.estimatedRolloverFee).toFixed(2)}</td>
                            <td className="py-2 text-right font-bold text-slate-200">AED {parseFloat(p.projectedEndingBalance).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Disclaimer */}
                  <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                    <LucideCircleAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-300/80 leading-relaxed">{projection.disclaimer}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Record Payment Dialog */}
      {showPaymentDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPaymentDialog(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Record Payment</h3>
              <button onClick={() => setShowPaymentDialog(null)} className="text-slate-400 hover:text-white"><LucideX className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Payment Amount (AED)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="e.g. Monthly installment"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={syncLedger} onChange={(e) => setSyncLedger(e.target.checked)} className="rounded" />
                <span className="text-xs text-slate-300">Add to ledger (cash-flow tracking)</span>
              </label>
              {!syncLedger && (
                <p className="text-[10px] text-amber-400 flex items-center gap-1"><LucideInfo className="h-3 w-3" /> This payment will not appear in cash-flow totals.</p>
              )}
            </div>
            {paymentMutation.error && (
              <p className="text-xs text-rose-400">{(paymentMutation.error as Error).message}</p>
            )}
            <button
              onClick={() => paymentMutation.mutate({ debtId: showPaymentDialog, amount: paymentAmount, notes: paymentNotes, sync: syncLedger })}
              disabled={paymentMutation.isPending}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {paymentMutation.isPending ? "Processing..." : "Confirm Payment"}
            </button>
          </div>
        </div>
      )}

      {/* Create Debt Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateDialog(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Add New Debt</h3>
              <button onClick={() => setShowCreateDialog(false)} className="text-slate-400 hover:text-white"><LucideX className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Debt Name</label>
                <input type="text" value={newDebt.name} onChange={(e) => setNewDebt({ ...newDebt, name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Tabby" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Original Balance</label>
                  <input type="number" step="0.01" value={newDebt.originalBalance} onChange={(e) => setNewDebt({ ...newDebt, originalBalance: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Monthly Payment</label>
                  <input type="number" step="0.01" value={newDebt.monthlyPayment} onChange={(e) => setNewDebt({ ...newDebt, monthlyPayment: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Due Day (1-31)</label>
                  <input type="number" min="1" max="31" value={newDebt.dueDay} onChange={(e) => setNewDebt({ ...newDebt, dueDay: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Rollover Fee Rate (%)</label>
                  <input type="number" step="0.01" min="0" value={newDebt.rolloverFeeRate} onChange={(e) => setNewDebt({ ...newDebt, rolloverFeeRate: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Notes (optional)</label>
                <input type="text" value={newDebt.notes} onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="Optional notes" />
              </div>
            </div>
            {createMutation.error && (
              <p className="text-xs text-rose-400">{(createMutation.error as Error).message}</p>
            )}
            <button
              onClick={() => createMutation.mutate(newDebt)}
              disabled={createMutation.isPending}
              className="w-full bg-rose-500 hover:bg-rose-400 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create Debt"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
