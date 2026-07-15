"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  LucideTrendingUp,
  LucideCalendar,
  LucideChevronLeft,
  LucideChevronRight,
  LucideReceipt,
  LucideBadgeAlert,
  LucideUtensilsCrossed,
  LucidePiggyBank,
  LucideFlame,
  LucideCircleAlert,
  LucideInfo,
  LucideClock,
  LucideAlertTriangle,
  LucideBuilding,
  LucideCoins,
  LucideWallet,
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";
import type { UpcomingPaymentItem } from "@/server/services/upcoming-payment.service";
import { AutomationStatusPanel } from "@/components/imports/automation-status-panel";
import { SalarySafetyAlert } from "@/components/dashboard/salary-safety-alert";

interface TransactionSummary {
  id: string;
  date: string;
  categoryName: string;
  description: string;
  amount: string;
  type: string;
}

interface DashboardData {
  month: string;
  actual: {
    income: string;
    expenses: string;
    savings: string;
    savingsDeposits: string;
    savingsWithdrawals: string;
    remittances: string;
    debtPayments: string;
    remaining: string;
  };
  planned: {
    salary: string;
    expenses: string;
    savings: string;
    remittances: string;
    debtPayments: string;
    unallocated: string;
  };
  food: {
    planned: string;
    spent: string;
    remaining: string;
    dailyAllowance: string;
    remainingDays: number;
  };
  remittanceOperations: {
    amountSent: string;
    fees: string;
    phpReceived: string;
    reversedAmount: string;
    latestRemittance: {
      id: string;
      recipient: string;
      amountSentAed: string;
      exchangeRate: string;
      amountReceivedPhp: string;
      transferProvider: string;
      transferDate: string;
      status: string;
    } | null;
  };
  outstandingDebt: string;
  totalSavings: string;
  recentTransactions: TransactionSummary[];
  nearestPayment: {
    debtId: string;
    debtName: string;
    amount: string;
    dueDate: string;
    isOverdue: boolean;
  } | null;
  accounts: {
    id: string;
    type: string;
    name: string;
    currentBalance: string;
    latestImportedBalance: string | null;
    lastSMSImported: string | null;
    lastSuccessfulSync: string | null;
    reconciliationStatus?: string;
    cacheDifference?: string;
    bankDifference?: string | null;
  }[];
  totalAvailableMoney: string;
}

interface DashboardClientProps {
  initialData: DashboardData;
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [selectedMonth, setSelectedMonth] = useState(initialData.month);

  const queryClient = useQueryClient();
  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [rolloverError, setRolloverError] = useState("");

  // Quick Actions state removed — dashboard is now monitoring-only
  // Manual forms remain available in /transactions, /debts, /savings, /remittances

  const { data = initialData } = useQuery<DashboardData>({
    queryKey: ["dashboard", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?month=${selectedMonth}`);
      const json = await res.json();
      return json.data;
    },
    initialData: selectedMonth === initialData.month ? initialData : undefined,
  });

  // Calculate previous month relative to selected month
  const [y, monthNum] = selectedMonth.split("-").map(Number);
  const prevDate = new Date(Date.UTC(y, monthNum - 2, 1));
  const prevY = prevDate.getUTCFullYear();
  const prevM = String(prevDate.getUTCMonth() + 1).padStart(2, "0");
  const previousMonth = `${prevY}-${prevM}`;

  // Query rollover preview
  const { data: rolloverPreview, refetch: refetchRolloverPreview } = useQuery({
    queryKey: ["rollover-preview", previousMonth, selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/monthly-rollover/preview?from=${previousMonth}&to=${selectedMonth}`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!selectedMonth,
  });

  // Query upcoming payments feed
  const { data: upcomingPayments = [] } = useQuery<UpcomingPaymentItem[]>({
    queryKey: ["upcoming-payments"],
    queryFn: async () => {
      const res = await fetch("/api/upcoming-payments");
      const json = await res.json();
      return json.data || [];
    },
  });

  // Mutations
  const handlePaymentMutation = useMutation({
    mutationFn: async ({ id, action, createTransaction }: { id: string; action: "COMPLETED" | "SKIPPED"; createTransaction?: boolean }) => {
      const res = await fetch(`/api/upcoming-payments/${id}/handle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, createTransaction }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to process reminder.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcoming-payments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      refetchRolloverPreview();
    },
  });

  const confirmRolloverMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/monthly-rollover/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: previousMonth, to: selectedMonth }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to complete rollover.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", selectedMonth] });
      queryClient.invalidateQueries({ queryKey: ["rollover-preview"] });
      setIsRolloverModalOpen(false);
      setRolloverError("");
    },
    onError: (err: Error) => {
      setRolloverError(err.message);
    },
  });

  const changeMonth = (offset: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    const nextY = date.getUTCFullYear();
    const nextM = String(date.getUTCMonth() + 1).padStart(2, "0");
    setSelectedMonth(`${nextY}-${nextM}`);
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

  return (
    <div className="space-y-8 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Financial Overview"
        description="Here is your financial status for the selected month."
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
      {/* Salary Safety & Webhook Health Alert */}
      <SalarySafetyAlert />
      
      {/* Automation Status Panel — replaces quick actions */}
      <AutomationStatusPanel />

      {/* Accounts & Available Money Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Accounts & Available Money
        </h3>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const enbd = data.accounts?.find((a) => a.type === "EMIRATES_NBD");
            const mashreq = data.accounts?.find((a) => a.type === "MASHREQ");
            const cash = data.accounts?.find((a) => a.type === "CASH");

            return (
              <>
                {/* Emirates NBD */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400">Emirates NBD</span>
                      <div className="flex items-center gap-1.5">
                        {enbd?.reconciliationStatus && enbd.reconciliationStatus !== "MATCHED" && (
                          <span className="inline-flex items-center rounded-sm bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 text-[8px] font-extrabold text-rose-400" title={`Cache vs Ledger Difference: AED ${enbd.cacheDifference}`}>
                            Balance needs review
                          </span>
                        )}
                        <LucideBuilding className="h-4 w-4 text-indigo-400" />
                      </div>
                    </div>
                    <p className="mt-3 text-xl font-bold text-white tabular-nums">
                      AED {parseFloat(enbd?.currentBalance || "0").toLocaleString("en-AE", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="mt-4 border-t border-slate-800/60 pt-2 text-[10px] text-slate-500 space-y-0.5">
                    {enbd?.latestImportedBalance && (
                      <p>SMS Balance: AED {parseFloat(enbd.latestImportedBalance).toFixed(2)}</p>
                    )}
                    <p>
                      Sync:{" "}
                      {enbd?.lastSMSImported
                        ? new Date(enbd.lastSMSImported).toLocaleDateString("en-AE", {
                            timeZone: "Asia/Dubai",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Never"}
                    </p>
                  </div>
                </div>

                {/* Mashreq */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400">Mashreq</span>
                      <div className="flex items-center gap-1.5">
                        {mashreq?.reconciliationStatus && mashreq.reconciliationStatus !== "MATCHED" && (
                          <span className="inline-flex items-center rounded-sm bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 text-[8px] font-extrabold text-rose-400" title={`Cache vs Ledger Difference: AED ${mashreq.cacheDifference}`}>
                            Balance needs review
                          </span>
                        )}
                        <LucideBuilding className="h-4 w-4 text-emerald-400" />
                      </div>
                    </div>
                    <p className="mt-3 text-xl font-bold text-white tabular-nums">
                      AED {parseFloat(mashreq?.currentBalance || "0").toLocaleString("en-AE", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="mt-4 border-t border-slate-800/60 pt-2 text-[10px] text-slate-500 space-y-0.5">
                    {mashreq?.latestImportedBalance && (
                      <p>SMS Balance: AED {parseFloat(mashreq.latestImportedBalance).toFixed(2)}</p>
                    )}
                    <p>
                      Sync:{" "}
                      {mashreq?.lastSMSImported
                        ? new Date(mashreq.lastSMSImported).toLocaleDateString("en-AE", {
                            timeZone: "Asia/Dubai",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Never"}
                    </p>
                  </div>
                </div>

                {/* Cash */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400">Physical Cash</span>
                      <div className="flex items-center gap-1.5">
                        {cash?.reconciliationStatus && cash.reconciliationStatus !== "MATCHED" && (
                          <span className="inline-flex items-center rounded-sm bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 text-[8px] font-extrabold text-rose-400" title={`Cache vs Ledger Difference: AED ${cash.cacheDifference}`}>
                            Balance needs review
                          </span>
                        )}
                        <LucideCoins className="h-4 w-4 text-amber-400" />
                      </div>
                    </div>
                    <p className="mt-3 text-xl font-bold text-white tabular-nums">
                      AED {parseFloat(cash?.currentBalance || "0").toLocaleString("en-AE", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="mt-4 border-t border-slate-800/60 pt-2 text-[10px] text-slate-500">
                    <p>Liquid rent/expense cash</p>
                  </div>
                </div>

                {/* Total Available Money */}
                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/20 p-6 flex flex-col justify-between shadow-lg shadow-indigo-950/10">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-300">Total Available Money</span>
                      <LucideWallet className="h-4 w-4 text-indigo-400" />
                    </div>
                    <p className="mt-3 text-2xl font-black text-indigo-400 tabular-nums">
                      AED {parseFloat(data.totalAvailableMoney || "0").toLocaleString("en-AE", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="mt-4 border-t border-indigo-950/40 pt-2 text-[10px] text-indigo-400/80">
                    <p>Consolidated liquid balances</p>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Financial Health Summary */}
      {(() => {
        const income = parseFloat(data.actual.income);
        const expenses = parseFloat(data.actual.expenses);
        const remittances = parseFloat(data.actual.remittances);
        const debtPayments = parseFloat(data.actual.debtPayments);
        const net = parseFloat(data.actual.remaining);
        const totalOutflow = expenses + remittances + debtPayments;
        const savingsRate = income > 0 ? ((income - totalOutflow) / income) * 100 : 0;
        const healthScore =
          net >= 0 && savingsRate >= 20
            ? "excellent"
            : net >= 0 && savingsRate >= 10
            ? "good"
            : net >= 0
            ? "fair"
            : "poor";
        const healthMeta: Record<string, { label: string; color: string; bg: string }> = {
          excellent: { label: "Excellent", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          good:      { label: "Good",      color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/20" },
          fair:      { label: "Fair",      color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
          poor:      { label: "Needs Attention", color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
        };
        const meta = healthMeta[healthScore];

        return (
          <div className={`rounded-2xl border p-5 ${meta.bg} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5`}>
            <div className="flex items-start gap-4">
              <div className={`rounded-full p-2 border ${meta.bg}`}>
                <LucideTrendingUp className={`h-5 w-5 ${meta.color}`} aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Financial Health</p>
                <p className={`text-xl font-bold mt-0.5 ${meta.color}`}>{meta.label}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Net cash flow:{" "}
                  <span className={net >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                    {net >= 0 ? "+" : ""}AED {net.toFixed(2)}
                  </span>
                  {income > 0 && (
                    <span className="ml-2 text-slate-500">
                      · Savings rate: {Math.max(0, savingsRate).toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-slate-500">Outstanding Debt</p>
                <p className="text-base font-bold text-rose-400 mt-0.5">
                  AED {parseFloat(data.outstandingDebt).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Savings</p>
                <p className="text-base font-bold text-emerald-400 mt-0.5">
                  AED {parseFloat(data.totalSavings).toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        );
      })()}


      {/* Rollover Banner Alert */}
      {rolloverPreview && !rolloverPreview.alreadyRolledOver && rolloverPreview.existingTargetBudgets.length === 0 && rolloverPreview.budgetsToCopy.length > 0 && (
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-5 backdrop-blur-md animate-in fade-in slide-in-from-top duration-300">
          <div className="flex gap-3">
            <LucideClock className="h-5 w-5 text-indigo-400 mt-0.5 flex-shrink-0 animate-pulse" />
            <div>
              <h4 className="font-semibold text-white text-sm">Monthly Budget Rollover Available</h4>
              <p className="text-xs text-slate-350 mt-1">
                Carry forward {rolloverPreview.budgetsToCopy.length} budget templates from {getMonthLabel(previousMonth)} to {getMonthLabel(selectedMonth)}.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsRolloverModalOpen(true)}
            className="flex-shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 transition-all shadow-md shadow-indigo-600/15"
          >
            Review Rollover
          </button>
        </div>
      )}

      {/* Top Level Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Remaining Cash Flow */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Remaining Cash Flow
          </p>
          <p className={`mt-3 text-3xl font-bold tracking-tight ${
            parseFloat(data.actual.remaining) >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}>
            AED {parseFloat(data.actual.remaining).toFixed(2)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Actual Income - Outgoings this month
          </p>
        </div>

        {/* Total Current Savings */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Total Current Savings
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-indigo-400">
            AED {parseFloat(data.totalSavings).toFixed(2)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Balance in all active savings goals
          </p>
        </div>

        {/* Daily Food Allowance Widget */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 sm:col-span-2 lg:col-span-1">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Daily Food Allowance
              </p>
              <p className={`mt-3 text-3xl font-bold tracking-tight ${
                parseFloat(data.food.remaining) > 0 ? "text-indigo-400" : "text-rose-400"
              }`}>
                AED {parseFloat(data.food.dailyAllowance).toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
              <LucideUtensilsCrossed className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
            {parseFloat(data.food.remaining) > 0 ? (
              <>
                <span>AED {parseFloat(data.food.remaining).toFixed(2)} remaining</span>
                <span>•</span>
                <span>{data.food.remainingDays} days left</span>
              </>
            ) : (
              <span className="text-rose-400 font-semibold flex items-center gap-1">
                <LucideBadgeAlert className="h-3.5 w-3.5" /> Food budget overdrawn!
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Debts, Savings & Remittances Columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Debt Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <LucideFlame className="h-5 w-5 text-rose-400" />
            Debts Status
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Total Outstanding Debt</span>
              <span className="font-bold text-white text-base">AED {parseFloat(data.outstandingDebt).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Planned Monthly Payments</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.debtPayments).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Actual Payments (This Month)</span>
              <span className="font-bold text-emerald-400">AED {parseFloat(data.actual.debtPayments).toFixed(2)}</span>
            </div>
          </div>

          {/* Nearest Due Payment */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upcoming Schedule</p>
            {data.nearestPayment ? (
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-slate-200 text-sm">{data.nearestPayment.debtName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Due: {new Date(data.nearestPayment.dueDate).toLocaleDateString("en-AE", {
                      timeZone: "Asia/Dubai",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm text-slate-200">AED {parseFloat(data.nearestPayment.amount).toFixed(2)}</p>
                  {data.nearestPayment.isOverdue ? (
                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-rose-400 uppercase tracking-wide bg-rose-500/10 px-2 py-0.5 rounded-full">
                      <LucideCircleAlert className="h-3 w-3" /> Overdue
                    </span>
                  ) : (
                    <span className="inline-flex items-center mt-1 text-[10px] font-medium text-slate-400 uppercase tracking-wide bg-slate-800 px-2 py-0.5 rounded-full">
                      Upcoming
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">No active debt schedules found.</p>
            )}
          </div>

          <div className="text-center">
            <Link
              href="/debts"
              className="inline-block text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors"
            >
              Manage Debts & Projections →
            </Link>
          </div>
        </div>

        {/* Savings Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <LucidePiggyBank className="h-5 w-5 text-indigo-400" />
            Savings Goals
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Total Savings Balances</span>
              <span className="font-bold text-white text-base">AED {parseFloat(data.totalSavings).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Planned Monthly Allocation</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.savings).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Actual Deposits (Outflows)</span>
              <span className="font-bold text-emerald-400">AED {parseFloat(data.actual.savingsDeposits).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">Actual Withdrawals (Inflows)</span>
              <span className="font-bold text-indigo-300">AED {parseFloat(data.actual.savingsWithdrawals).toFixed(2)}</span>
            </div>
          </div>

          <div className="text-center pt-2">
            <Link
              href="/savings"
              className="inline-block text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View Savings Progress →
            </Link>
          </div>
        </div>

        {/* Remittances Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6 flex flex-col justify-between">
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <LucideTrendingUp className="h-5 w-5 text-emerald-400" />
              Remittances (PH)
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Completed Sent</span>
                <span className="font-bold text-white text-base">AED {parseFloat(data.remittanceOperations.amountSent).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">PHP Received</span>
                <span className="font-bold text-emerald-400">PHP {parseFloat(data.remittanceOperations.phpReceived).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Fees Paid</span>
                <span className="font-bold text-slate-200">AED {parseFloat(data.remittanceOperations.fees).toFixed(2)}</span>
              </div>
              {parseFloat(data.remittanceOperations.reversedAmount) > 0 && (
                <div className="flex justify-between items-center text-sm text-rose-400">
                  <span>Reversed Amount</span>
                  <span className="font-bold">AED {parseFloat(data.remittanceOperations.reversedAmount).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Latest Remittance */}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Latest Remittance</p>
              {data.remittanceOperations.latestRemittance ? (
                <div>
                  <p className="font-semibold text-slate-200 text-sm">To: {data.remittanceOperations.latestRemittance.recipient}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    AED {parseFloat(data.remittanceOperations.latestRemittance.amountSentAed).toFixed(2)} via {data.remittanceOperations.latestRemittance.transferProvider}
                  </p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] text-slate-500">
                      {new Date(data.remittanceOperations.latestRemittance.transferDate).toLocaleDateString("en-AE", {
                        timeZone: "Asia/Dubai",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                      data.remittanceOperations.latestRemittance.status === "REVERSED"
                        ? "bg-rose-500/10 text-rose-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    }`}>
                      {data.remittanceOperations.latestRemittance.status}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic py-2">No remittances recorded this month.</p>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-4">
            <p className="text-[10px] text-slate-500 leading-tight italic text-center">
              * Note: Unlinked remittances appear in PH totals but are excluded from actual cash-flow calculations.
            </p>
            <div className="text-center">
              <Link
                href="/remittances"
                className="inline-block text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Track & Send Remittances →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Actual Cash Flow vs Planned Allocation */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Actual Cash Flow Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6">
          <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
            <LucideTrendingUp className="h-5 w-5 text-emerald-400" />
            Actual Cash Flow (Recorded)
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Actual Income</span>
              <span className="font-bold text-white">AED {parseFloat(data.actual.income).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Actual Expenses</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.actual.expenses).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2 flex-col sm:flex-row">
              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Net Savings Flow</span>
                <span className="inline-flex" title="Deposits minus Withdrawals. Positive means money transferred to savings.">
                  <LucideInfo className="h-3.5 w-3.5 text-slate-500 cursor-help" />
                </span>
              </div>
              <span className="font-bold text-slate-200 mt-1 sm:mt-0">AED {parseFloat(data.actual.savings).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Actual Remittances</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.actual.remittances).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Actual Debt Payments</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.actual.debtPayments).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Planned Allocation Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6">
          <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
            <LucideCalendar className="h-5 w-5 text-indigo-400" />
            Planned Budget Plan (Month allocation)
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Target Monthly Salary</span>
              <span className="font-bold text-white">AED {parseFloat(data.planned.salary).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Planned Expenses (Fixed/Variable)</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.expenses).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Planned Savings Targets</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.savings).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Planned Remittances (Family)</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.remittances).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-slate-850 pb-2">
              <span className="text-slate-400">Planned Debt Installments</span>
              <span className="font-bold text-slate-200">AED {parseFloat(data.planned.debtPayments).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm text-emerald-400 pt-1">
              <span>Unallocated Salary Balance</span>
              <span className="font-extrabold">AED {parseFloat(data.planned.unallocated).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two-Column Grid: Transactions & Upcoming Feed */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Transactions List */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <LucideReceipt className="h-5 w-5 text-slate-400" />
                Recent Transactions (Current Month)
              </h3>
              <Link
                href="/transactions"
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View Ledger →
              </Link>
            </div>

            {!data.recentTransactions.length ? (
              <p className="text-sm text-slate-550 py-12 text-center italic">
                No transactions recorded yet for this month.
              </p>
            ) : (
              <div className="divide-y divide-slate-850 max-h-80 overflow-y-auto pr-1 space-y-0.5">
                {data.recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-200 text-sm truncate">{tx.description}</p>
                      <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
                        <span>{tx.categoryName}</span>
                        <span>•</span>
                        <span>
                          {new Date(tx.date).toLocaleDateString("en-AE", {
                            timeZone: "Asia/Dubai",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </p>
                    </div>
                    <span className={`font-bold text-sm whitespace-nowrap ml-4 ${
                      tx.type === "INCOME" ? "text-emerald-400" :
                      tx.type === "SAVINGS" ? "text-slate-350" : "text-rose-400"
                    }`}>
                      {tx.type === "INCOME" ? "+" : "-"}AED {parseFloat(tx.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Unified Upcoming Payments Feed */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <LucideClock className="h-5 w-5 text-indigo-400" />
                Upcoming Payments & Reminders
              </h3>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Dubai Timezone
              </span>
            </div>

            {upcomingPayments.length === 0 ? (
              <p className="text-sm text-slate-550 py-12 text-center italic">
                No upcoming payments or active alerts.
              </p>
            ) : (
              <div className="divide-y divide-slate-850 max-h-80 overflow-y-auto pr-1 space-y-2">
                {upcomingPayments.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex justify-between items-center py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-200 text-sm truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-550 mt-1 flex items-center gap-1.5">
                        <span>Due: {item.dueDate}</span>
                        <span>•</span>
                        <span className={clsx(
                          "rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase",
                          item.status === "OVERDUE" ? "bg-red-500/15 text-red-400 animate-pulse" :
                          item.status === "DUE_TODAY" ? "bg-amber-500/15 text-amber-400" :
                          item.status === "HANDLED" ? "bg-emerald-500/15 text-emerald-400" :
                          "bg-slate-800 text-slate-400"
                        )}>
                          {item.status}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm text-white">AED {item.amount}</span>
                      
                      {item.canMarkHandled && item.status !== "HANDLED" && item.status !== "SKIPPED" ? (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              if (item.occurrenceId) {
                                const record = confirm("Would you like to automatically record a ledger transaction for this payment?");
                                handlePaymentMutation.mutate({
                                  id: item.occurrenceId,
                                  action: "COMPLETED",
                                  createTransaction: record,
                                });
                              }
                            }}
                            className="rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2.5 py-1 text-[10px] font-bold"
                          >
                            Mark Paid
                          </button>
                          {item.canSkip && (
                            <button
                              onClick={() => {
                                if (item.occurrenceId && confirm("Skip this scheduled occurrence?")) {
                                  handlePaymentMutation.mutate({
                                    id: item.occurrenceId,
                                    action: "SKIPPED",
                                  });
                                }
                              }}
                              className="rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-400 px-2 py-1 text-[10px]"
                            >
                              Skip
                            </button>
                          )}
                        </div>
                      ) : !item.canMarkHandled && item.status !== "HANDLED" ? (
                        <Link
                          href={item.destinationPath}
                          className="rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-2.5 py-1 text-[10px] font-bold"
                        >
                          Pay Info
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rollover Prompt Modal */}
      {isRolloverModalOpen && rolloverPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md space-y-5">
            <div>
              <h3 className="text-lg font-bold text-white">Monthly Budget Rollover Preview</h3>
              <p className="text-xs text-slate-450 mt-0.5">
                Copy category budget allocations from {getMonthLabel(previousMonth)} to {getMonthLabel(selectedMonth)}.
              </p>
            </div>

            {rolloverError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
                <LucideAlertTriangle className="h-4 w-4" />
                {rolloverError}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-950/45 p-3 rounded-xl">
                <div>
                  <span className="text-slate-400 block mb-0.5">Planned Salary</span>
                  <span className="font-bold text-white text-sm">AED {parseFloat(rolloverPreview.plannedSalary).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Planned Allocation</span>
                  <span className="font-bold text-white text-sm">AED {parseFloat(rolloverPreview.totalPlannedAllocation).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Unallocated Amount</span>
                  <span className="font-bold text-emerald-400 text-sm">AED {parseFloat(rolloverPreview.unallocatedAmount).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Overdue Reminders</span>
                  <span className={clsx(
                    "font-bold text-sm",
                    rolloverPreview.overdueRemindersCount > 0 ? "text-rose-450" : "text-slate-300"
                  )}>
                    {rolloverPreview.overdueRemindersCount} unresolved
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Budgets to copy ({rolloverPreview.budgetsToCopy.length})</h4>
                <div className="max-h-40 overflow-y-auto border border-slate-850 rounded-xl divide-y divide-slate-850 bg-slate-950/20 px-3">
                  {rolloverPreview.budgetsToCopy.map((b: { categoryName: string; amount: string }, idx: number) => (
                    <div key={idx} className="flex justify-between items-center py-2 text-xs">
                      <span className="font-medium text-slate-300">{b.categoryName}</span>
                      <span className="font-bold text-slate-200">AED {b.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => {
                  setIsRolloverModalOpen(false);
                  setRolloverError("");
                }}
                className="rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-800 px-5 py-2 text-sm text-slate-350 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmRolloverMutation.mutate()}
                disabled={confirmRolloverMutation.isPending}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                {confirmRolloverMutation.isPending ? "Confirming..." : "Confirm & Copy"}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
