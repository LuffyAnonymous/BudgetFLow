"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  LucidePlus,
  LucideX,
  LucideCalendarClock,
  LucideCircleAlert,
  LucideInfo,
  LucideCheck,
  LucideArchive,
  LucideCalculator,
  LucideLandmark,
  LucideLoader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import type { Tone } from "@/components/ui/stat-tile";

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

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "emerald" },
  PAID: { label: "Paid Off", tone: "indigo" },
  ARCHIVED: { label: "Archived", tone: "slate" },
  PAUSED: { label: "Paused", tone: "amber" },
};

export default function DebtsClient() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [showPaymentDialog, setShowPaymentDialog] = useState<string | null>(null);
  const [showProjection, setShowProjection] = useState<string | null>(null);
  const [showPaymentHistory, setShowPaymentHistory] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectionMonths, setProjectionMonths] = useState(12);

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

  const { data: debts = [], isLoading } = useQuery<Debt[]>({
    queryKey: ["debts", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/debts?status=${statusFilter}`);
      const json = await res.json();
      return json.data || [];
    },
  });

  const { data: debtDetail } = useQuery<DebtDetail>({
    queryKey: ["debtDetail", showProjection],
    queryFn: async () => {
      const res = await fetch(`/api/debts/${showProjection}`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!showProjection,
  });

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

  const paymentMutation = useMutation({
    mutationFn: async ({ debtId, amount, notes, sync }: { debtId: string; amount: string; notes: string; sync: boolean }) => {
      const parsedVal = parseFloat(amount);
      const res = await fetch(`/api/debts/${debtId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: isNaN(parsedVal) ? 0 : parsedVal,
          paymentDate: new Date().toISOString(),
          notes: notes || null,
          syncLedger: sync,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        const errorMsg = json.error?.message || json.error?.code || `HTTP ${res.status}: Failed to record payment`;
        throw new Error(errorMsg);
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debts"] });
      queryClient.invalidateQueries({ queryKey: ["debtPayments"] });
      queryClient.invalidateQueries({ queryKey: ["debtDetail"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setShowPaymentDialog(null);
      setPaymentAmount("");
      setPaymentNotes("");
    },
  });

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

  const projection = debtDetail?.projection;
  const visibleProjections = projection?.projections.slice(0, projectionMonths) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Debt Tracker"
        description="Monitor outstanding debt balances, record payments, and view payoff projections."
        action={
          <Button variant="primary" onClick={() => setShowCreateDialog(true)}>
            <LucidePlus className="h-4 w-4" aria-hidden="true" /> Add Debt
          </Button>
        }
      />

      {/* Status filter */}
      <div className="flex gap-2" role="tablist" aria-label="Filter by debt status">
        {["ACTIVE", "PAID", "ARCHIVED", "PAUSED"].map((s) => (
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

      {/* Debts List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
          <LucideLoader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
          <p className="text-sm">Loading debts…</p>
        </div>
      ) : debts.length === 0 ? (
        <EmptyState
          icon={LucideLandmark}
          title={`No ${statusFilter.toLowerCase()} debts`}
          description="Add a debt to track its balance, monthly payments, and payoff timeline."
          action={{
            label: "Add Debt",
            onClick: () => setShowCreateDialog(true),
            icon: LucidePlus,
            className: "bg-indigo-600 hover:bg-indigo-500 text-white",
          }}
        />
      ) : (
        <div className="space-y-4">
          {debts.map((debt) => {
            const meta = statusMeta[debt.status] || statusMeta.ACTIVE;
            return (
              <Card key={debt.id} className="space-y-4 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">{debt.name}</h3>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Due day: {debt.dueDay} of each month</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold tabular-nums text-white">AED {parseFloat(debt.currentBalance).toFixed(2)}</p>
                    <p className="text-xs tabular-nums text-slate-500">of AED {parseFloat(debt.originalBalance).toFixed(2)}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-slate-400">Payment Progress</span>
                    <span className="font-bold tabular-nums text-emerald-400">{getProgressPct(debt)}%</span>
                  </div>
                  <ProgressBar value={getProgressPct(debt)} tone="emerald" />
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-slate-950/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Monthly Payment</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">AED {parseFloat(debt.monthlyPayment).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-950/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Due Day</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">{debt.dueDay}</p>
                  </div>
                  <div className="rounded-xl bg-slate-950/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Fee Rate</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">{parseFloat(debt.rolloverFeeRate).toFixed(2)}%</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {(debt.status === "ACTIVE" || debt.status === "PAUSED") && (
                    <button
                      onClick={() => {
                        setShowPaymentDialog(debt.id);
                        setPaymentAmount(Math.min(parseFloat(debt.currentBalance), parseFloat(debt.monthlyPayment)).toFixed(2));
                      }}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                    >
                      <LucideCheck className="h-3.5 w-3.5" aria-hidden="true" /> Record Payment
                    </button>
                  )}
                  <button
                    onClick={() => setShowPaymentHistory(showPaymentHistory === debt.id ? null : debt.id)}
                    className="flex items-center gap-1 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700/60"
                    aria-expanded={showPaymentHistory === debt.id}
                  >
                    <LucideCalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {showPaymentHistory === debt.id ? "Hide History" : "Payment History"}
                  </button>
                  <button
                    onClick={() => setShowProjection(showProjection === debt.id ? null : debt.id)}
                    className="flex items-center gap-1 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-400 transition-colors hover:bg-indigo-500/20"
                    aria-expanded={showProjection === debt.id}
                  >
                    <LucideCalculator className="h-3.5 w-3.5" aria-hidden="true" />
                    {showProjection === debt.id ? "Hide Projection" : "Payoff Projection"}
                  </button>
                  {debt.status === "ACTIVE" && (
                    <button
                      onClick={() => archiveMutation.mutate(debt.id)}
                      className="ml-auto flex items-center gap-1 rounded-lg bg-slate-800/40 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-700/40 hover:text-slate-300"
                    >
                      <LucideArchive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
                    </button>
                  )}
                </div>

                {showPaymentHistory === debt.id && paymentsData && (
                  <div className="mt-2 border-t border-slate-800 pt-4">
                    <h4 className="mb-3 text-sm font-bold text-slate-300">Payment History</h4>
                    {paymentsData.items.length === 0 ? (
                      <p className="text-xs italic text-slate-500">No payments recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-500">
                              <th className="pb-2 text-left font-semibold">Date</th>
                              <th className="pb-2 text-right font-semibold">Amount</th>
                              <th className="pb-2 text-right font-semibold">Before</th>
                              <th className="pb-2 text-right font-semibold">After</th>
                              <th className="pb-2 text-center font-semibold">Ledger</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentsData.items.map((p) => (
                              <tr key={p.id} className="border-b border-slate-800/50">
                                <td className="py-2.5 text-slate-300">
                                  {new Date(p.paymentDate).toLocaleDateString("en-AE", {
                                    timeZone: "Asia/Dubai",
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </td>
                                <td className="py-2.5 text-right font-bold tabular-nums text-emerald-400">AED {parseFloat(p.amount).toFixed(2)}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-400">AED {parseFloat(p.balanceBefore).toFixed(2)}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-300">AED {parseFloat(p.balanceAfter).toFixed(2)}</td>
                                <td className="py-2.5 text-center">
                                  {p.transactionStatus === "LINKED" ? (
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

                {showProjection === debt.id && projection && (
                  <div className="mt-2 space-y-3 border-t border-slate-800 pt-4">
                    <div className="flex items-start justify-between">
                      <h4 className="text-sm font-bold text-slate-300">Payoff Projection</h4>
                      <div className="flex items-center gap-2">
                        <label htmlFor="projection-months" className="text-[10px] uppercase tracking-wide text-slate-500">
                          Months:
                        </label>
                        <input
                          id="projection-months"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={36}
                          value={projectionMonths}
                          onChange={(e) => setProjectionMonths(Math.min(36, Math.max(1, parseInt(e.target.value) || 1)))}
                          className="w-14 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-center text-xs text-white outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl bg-slate-950/40 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Starting Balance</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-white">AED {parseFloat(projection.startingBalance).toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-950/40 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Payoff In</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-indigo-400">
                          {projection.payoffMonthIndex ? `${projection.payoffMonthIndex} months` : "> 36 months"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-950/40 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Total Payments</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-emerald-400">
                          AED {parseFloat(projection.totalProjectedPayments).toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-950/40 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Est. Total Fees</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-rose-400">
                          AED {parseFloat(projection.totalProjectedFees).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-500">
                            <th className="pb-2 text-left font-semibold">Month</th>
                            <th className="pb-2 text-right font-semibold">Start</th>
                            <th className="pb-2 text-right font-semibold">Payment</th>
                            <th className="pb-2 text-right font-semibold">Est. Fee</th>
                            <th className="pb-2 text-right font-semibold">End</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleProjections.map((p) => (
                            <tr key={p.monthIndex} className="border-b border-slate-800/50">
                              <td className="py-2 text-slate-400">Month {p.monthIndex}</td>
                              <td className="py-2 text-right tabular-nums text-slate-300">AED {parseFloat(p.startingBalance).toFixed(2)}</td>
                              <td className="py-2 text-right tabular-nums text-emerald-400">AED {parseFloat(p.payment).toFixed(2)}</td>
                              <td className="py-2 text-right tabular-nums text-rose-400">AED {parseFloat(p.estimatedRolloverFee).toFixed(2)}</td>
                              <td className="py-2 text-right font-bold tabular-nums text-slate-200">
                                AED {parseFloat(p.projectedEndingBalance).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/10 bg-amber-500/5 p-3">
                      <LucideCircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                      <p className="text-[11px] leading-relaxed text-amber-300/80">{projection.disclaimer}</p>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Record Payment Dialog */}
      {showPaymentDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowPaymentDialog(null)}
        >
          <Card className="w-full max-w-md space-y-4 border-slate-700 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Record Payment</h3>
              <button onClick={() => setShowPaymentDialog(null)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                <LucideX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="payment-amount" className="mb-1 block text-xs font-semibold text-slate-400">
                  Payment Amount (AED)
                </label>
                <input
                  id="payment-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="payment-notes" className="mb-1 block text-xs font-semibold text-slate-400">
                  Notes (optional)
                </label>
                <input
                  id="payment-notes"
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="e.g. Monthly installment"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={syncLedger} onChange={(e) => setSyncLedger(e.target.checked)} className="rounded" />
                <span className="text-xs text-slate-300">Add to ledger (cash-flow tracking)</span>
              </label>
              {!syncLedger && (
                <p className="flex items-center gap-1 text-[10px] text-amber-400">
                  <LucideInfo className="h-3 w-3" aria-hidden="true" /> This payment will not appear in cash-flow totals.
                </p>
              )}
            </div>
            {paymentMutation.error && (
              <p role="alert" aria-live="polite" className="text-xs text-rose-400">
                {(paymentMutation.error as Error).message}
              </p>
            )}
            <button
              onClick={() => paymentMutation.mutate({ debtId: showPaymentDialog, amount: paymentAmount, notes: paymentNotes, sync: syncLedger })}
              disabled={paymentMutation.isPending}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {paymentMutation.isPending ? "Processing…" : "Confirm Payment"}
            </button>
          </Card>
        </div>
      )}

      {/* Create Debt Dialog */}
      {showCreateDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowCreateDialog(false)}
        >
          <Card className="w-full max-w-md space-y-4 border-slate-700 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add New Debt</h3>
              <button onClick={() => setShowCreateDialog(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                <LucideX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="debt-name" className="mb-1 block text-xs font-semibold text-slate-400">
                  Debt Name
                </label>
                <input
                  id="debt-name"
                  type="text"
                  value={newDebt.name}
                  onChange={(e) => setNewDebt({ ...newDebt, name: e.target.value })}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  placeholder="e.g. Tabby"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="debt-original" className="mb-1 block text-xs font-semibold text-slate-400">
                    Original Balance
                  </label>
                  <input
                    id="debt-original"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={newDebt.originalBalance}
                    onChange={(e) => setNewDebt({ ...newDebt, originalBalance: e.target.value })}
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label htmlFor="debt-monthly" className="mb-1 block text-xs font-semibold text-slate-400">
                    Monthly Payment
                  </label>
                  <input
                    id="debt-monthly"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={newDebt.monthlyPayment}
                    onChange={(e) => setNewDebt({ ...newDebt, monthlyPayment: e.target.value })}
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="debt-due-day" className="mb-1 block text-xs font-semibold text-slate-400">
                    Due Day (1-31)
                  </label>
                  <input
                    id="debt-due-day"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="31"
                    value={newDebt.dueDay}
                    onChange={(e) => setNewDebt({ ...newDebt, dueDay: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="debt-fee-rate" className="mb-1 block text-xs font-semibold text-slate-400">
                    Rollover Fee Rate (%)
                  </label>
                  <input
                    id="debt-fee-rate"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={newDebt.rolloverFeeRate}
                    onChange={(e) => setNewDebt({ ...newDebt, rolloverFeeRate: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="debt-notes" className="mb-1 block text-xs font-semibold text-slate-400">
                  Notes (optional)
                </label>
                <input
                  id="debt-notes"
                  type="text"
                  value={newDebt.notes}
                  onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })}
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
            <Button variant="primary" className="w-full" onClick={() => createMutation.mutate(newDebt)} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Debt"}
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
