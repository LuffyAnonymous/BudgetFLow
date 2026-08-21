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
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";
import type { UpcomingPaymentItem } from "@/server/services/upcoming-payment.service";
import { AutomationStatusPanel } from "@/components/imports/automation-status-panel";
import { SalarySafetyAlert } from "@/components/dashboard/salary-safety-alert";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile, type Tone } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

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
  accounts?: {
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
  totalAvailableMoney?: string;
}

interface DashboardClientProps {
  initialData: DashboardData;
}

const healthMeta: Record<string, { label: string; tone: Tone }> = {
  excellent: { label: "Excellent", tone: "emerald" },
  good: { label: "Good", tone: "indigo" },
  fair: { label: "Fair", tone: "amber" },
  poor: { label: "Needs Attention", tone: "rose" },
};

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [selectedMonth, setSelectedMonth] = useState(initialData.month);

  const queryClient = useQueryClient();
  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [rolloverError, setRolloverError] = useState("");

  const { data = initialData } = useQuery<DashboardData>({
    queryKey: ["dashboard", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?month=${selectedMonth}`);
      const json = await res.json();
      return json.data;
    },
    initialData: selectedMonth === initialData.month ? initialData : undefined,
  });

  const [y, monthNum] = selectedMonth.split("-").map(Number);
  const prevDate = new Date(Date.UTC(y, monthNum - 2, 1));
  const prevY = prevDate.getUTCFullYear();
  const prevM = String(prevDate.getUTCMonth() + 1).padStart(2, "0");
  const previousMonth = `${prevY}-${prevM}`;

  const { data: rolloverPreview, refetch: refetchRolloverPreview } = useQuery({
    queryKey: ["rollover-preview", previousMonth, selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/monthly-rollover/preview?from=${previousMonth}&to=${selectedMonth}`);
      const json = await res.json();
      return json.data;
    },
    enabled: !!selectedMonth,
  });

  const { data: upcomingPayments = [] } = useQuery<UpcomingPaymentItem[]>({
    queryKey: ["upcoming-payments"],
    queryFn: async () => {
      const res = await fetch("/api/upcoming-payments");
      const json = await res.json();
      return json.data || [];
    },
  });

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

  const income = parseFloat(data.actual.income);
  const expenses = parseFloat(data.actual.expenses);
  const remittances = parseFloat(data.actual.remittances);
  const debtPayments = parseFloat(data.actual.debtPayments);
  const net = parseFloat(data.actual.remaining);
  const totalOutflow = expenses + remittances + debtPayments;
  const savingsRate = income > 0 ? ((income - totalOutflow) / income) * 100 : 0;
  const healthScore =
    net >= 0 && savingsRate >= 20 ? "excellent" : net >= 0 && savingsRate >= 10 ? "good" : net >= 0 ? "fair" : "poor";
  const meta = healthMeta[healthScore];

  return (
    <div className="space-y-8 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Financial Overview"
        description="Here is your financial status for the selected month."
        action={
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-1.5">
            <button
              onClick={() => changeMonth(-1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-slate-800"
              aria-label="Previous month"
            >
              <LucideChevronLeft className="h-4.5 w-4.5" />
            </button>
            <span className="min-w-32 text-center text-sm font-bold text-white">
              {getMonthLabel(selectedMonth)}
            </span>
            <button
              onClick={() => changeMonth(1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-slate-800"
              aria-label="Next month"
            >
              <LucideChevronRight className="h-4.5 w-4.5" />
            </button>
          </div>
        }
      />

      <SalarySafetyAlert />
      <AutomationStatusPanel activeMonth={selectedMonth} />

      {/* Financial Health Summary */}
      <Card
        className={clsx(
          "flex flex-col items-start justify-between gap-5 p-5 sm:flex-row sm:items-center",
          meta.tone === "emerald" && "border-emerald-500/20 bg-emerald-500/10",
          meta.tone === "indigo" && "border-indigo-500/20 bg-indigo-500/10",
          meta.tone === "amber" && "border-amber-500/20 bg-amber-500/10",
          meta.tone === "rose" && "border-rose-500/20 bg-rose-500/10"
        )}
      >
        <div className="flex items-start gap-4">
          <span
            className={clsx(
              "rounded-full border p-2",
              meta.tone === "emerald" && "border-emerald-500/20 bg-emerald-500/10",
              meta.tone === "indigo" && "border-indigo-500/20 bg-indigo-500/10",
              meta.tone === "amber" && "border-amber-500/20 bg-amber-500/10",
              meta.tone === "rose" && "border-rose-500/20 bg-rose-500/10"
            )}
          >
            <LucideTrendingUp
              className={clsx(
                "h-5 w-5",
                meta.tone === "emerald" && "text-emerald-400",
                meta.tone === "indigo" && "text-indigo-400",
                meta.tone === "amber" && "text-amber-400",
                meta.tone === "rose" && "text-rose-400"
              )}
              aria-hidden="true"
            />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Financial Health</p>
            <p
              className={clsx(
                "mt-0.5 text-xl font-bold",
                meta.tone === "emerald" && "text-emerald-400",
                meta.tone === "indigo" && "text-indigo-400",
                meta.tone === "amber" && "text-amber-400",
                meta.tone === "rose" && "text-rose-400"
              )}
            >
              {meta.label}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Net cash flow:{" "}
              <span className={net >= 0 ? "font-bold text-emerald-400" : "font-bold text-rose-400"}>
                {net >= 0 ? "+" : ""}AED {net.toFixed(2)}
              </span>
              {income > 0 && (
                <span className="ml-2 text-slate-500">· Savings rate: {Math.max(0, savingsRate).toFixed(1)}%</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-xs text-slate-500">Outstanding Debt</p>
            <p className="mt-0.5 text-base font-bold text-rose-400 tabular-nums">AED {parseFloat(data.outstandingDebt).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Savings</p>
            <p className="mt-0.5 text-base font-bold text-emerald-400 tabular-nums">AED {parseFloat(data.totalSavings).toFixed(2)}</p>
          </div>
        </div>
      </Card>

      {/* Rollover Banner Alert */}
      {rolloverPreview && !rolloverPreview.alreadyRolledOver && rolloverPreview.existingTargetBudgets.length === 0 && rolloverPreview.budgetsToCopy.length > 0 && (
        <Card className="flex animate-in fade-in slide-in-from-top flex-col items-start justify-between gap-4 border-indigo-500/20 bg-indigo-500/10 p-5 duration-300 md:flex-row md:items-center">
          <div className="flex gap-3">
            <LucideClock className="mt-0.5 h-5 w-5 flex-shrink-0 animate-pulse text-indigo-400" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-white">Monthly Budget Rollover Available</h3>
              <p className="mt-1 text-xs text-slate-400">
                Carry forward {rolloverPreview.budgetsToCopy.length} budget templates from {getMonthLabel(previousMonth)} to {getMonthLabel(selectedMonth)}.
              </p>
            </div>
          </div>
          <Button variant="primary" size="sm" className="flex-shrink-0" onClick={() => setIsRolloverModalOpen(true)}>
            Review Rollover
          </Button>
        </Card>
      )}

      {/* Top Level Summary Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Remaining Cash Flow"
          value={`AED ${parseFloat(data.actual.remaining).toFixed(2)}`}
          tone={parseFloat(data.actual.remaining) >= 0 ? "emerald" : "rose"}
          caption="Actual Income - Outgoings this month"
        />
        <StatTile
          label="Total Current Savings"
          value={`AED ${parseFloat(data.totalSavings).toFixed(2)}`}
          tone="indigo"
          caption="Balance in all active savings goals"
        />
        <StatTile
          className="sm:col-span-2 lg:col-span-1"
          label="Daily Food Allowance"
          value={`AED ${parseFloat(data.food.dailyAllowance).toFixed(2)}`}
          tone={parseFloat(data.food.remaining) > 0 ? "indigo" : "rose"}
          icon={<LucideUtensilsCrossed className="h-5 w-5" />}
          caption={
            parseFloat(data.food.remaining) > 0 ? (
              <>
                AED {parseFloat(data.food.remaining).toFixed(2)} remaining • {data.food.remainingDays} days left
              </>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-rose-400">
                <LucideBadgeAlert className="h-3.5 w-3.5" /> Food budget overdrawn!
              </span>
            )
          }
        />
      </div>

      {/* Debts, Savings & Remittances Columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-6 p-6">
          <CardHeader icon={<LucideFlame className="h-5 w-5 text-rose-400" aria-hidden="true" />} title="Debts Status" />
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Total Outstanding Debt</span>
              <span className="text-base font-bold text-white tabular-nums">AED {parseFloat(data.outstandingDebt).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Planned Monthly Payments</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.debtPayments).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Actual Payments (This Month)</span>
              <span className="font-bold text-emerald-400 tabular-nums">AED {parseFloat(data.actual.debtPayments).toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Upcoming Schedule</p>
            {data.nearestPayment ? (
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-200">{data.nearestPayment.debtName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Due:{" "}
                    {new Date(data.nearestPayment.dueDate).toLocaleDateString("en-AE", {
                      timeZone: "Asia/Dubai",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-200 tabular-nums">AED {parseFloat(data.nearestPayment.amount).toFixed(2)}</p>
                  {data.nearestPayment.isOverdue ? (
                    <Badge tone="rose" className="mt-1">
                      <LucideCircleAlert className="h-3 w-3" /> Overdue
                    </Badge>
                  ) : (
                    <Badge tone="slate" className="mt-1">
                      Upcoming
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <p className="py-2 text-xs italic text-slate-500">No active debt schedules found.</p>
            )}
          </div>

          <div className="text-center">
            <Link href="/debts" className="inline-block text-xs font-semibold text-rose-400 transition-colors hover:text-rose-300">
              Manage Debts & Projections →
            </Link>
          </div>
        </Card>

        <Card className="space-y-6 p-6">
          <CardHeader icon={<LucidePiggyBank className="h-5 w-5 text-indigo-400" aria-hidden="true" />} title="Savings Goals" />
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Total Savings Balances</span>
              <span className="text-base font-bold text-white tabular-nums">AED {parseFloat(data.totalSavings).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Planned Monthly Allocation</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.savings).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Actual Deposits (Outflows)</span>
              <span className="font-bold text-emerald-400 tabular-nums">AED {parseFloat(data.actual.savingsDeposits).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Actual Withdrawals (Inflows)</span>
              <span className="font-bold text-indigo-300 tabular-nums">AED {parseFloat(data.actual.savingsWithdrawals).toFixed(2)}</span>
            </div>
          </div>

          <div className="pt-2 text-center">
            <Link href="/savings" className="inline-block text-xs font-semibold text-indigo-400 transition-colors hover:text-indigo-300">
              View Savings Progress →
            </Link>
          </div>
        </Card>

        <Card className="flex flex-col justify-between space-y-6 p-6">
          <div className="space-y-6">
            <CardHeader icon={<LucideTrendingUp className="h-5 w-5 text-emerald-400" aria-hidden="true" />} title="Remittances (PH)" />
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Completed Sent</span>
                <span className="text-base font-bold text-white tabular-nums">AED {parseFloat(data.remittanceOperations.amountSent).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">PHP Received</span>
                <span className="font-bold text-emerald-400 tabular-nums">PHP {parseFloat(data.remittanceOperations.phpReceived).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Fees Paid</span>
                <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.remittanceOperations.fees).toFixed(2)}</span>
              </div>
              {parseFloat(data.remittanceOperations.reversedAmount) > 0 && (
                <div className="flex items-center justify-between text-sm text-rose-400">
                  <span>Reversed Amount</span>
                  <span className="font-bold tabular-nums">AED {parseFloat(data.remittanceOperations.reversedAmount).toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Latest Remittance</p>
              {data.remittanceOperations.latestRemittance ? (
                <div>
                  <p className="text-sm font-semibold text-slate-200">To: {data.remittanceOperations.latestRemittance.recipient}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    AED {parseFloat(data.remittanceOperations.latestRemittance.amountSentAed).toFixed(2)} via{" "}
                    {data.remittanceOperations.latestRemittance.transferProvider}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {new Date(data.remittanceOperations.latestRemittance.transferDate).toLocaleDateString("en-AE", {
                        timeZone: "Asia/Dubai",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <Badge tone={data.remittanceOperations.latestRemittance.status === "REVERSED" ? "rose" : "emerald"}>
                      {data.remittanceOperations.latestRemittance.status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <p className="py-2 text-xs italic text-slate-500">No remittances recorded this month.</p>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-4">
            <p className="text-center text-[10px] italic leading-tight text-slate-500">
              * Note: Unlinked remittances appear in PH totals but are excluded from actual cash-flow calculations.
            </p>
            <div className="text-center">
              <Link href="/remittances" className="inline-block text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300">
                Track & Send Remittances →
              </Link>
            </div>
          </div>
        </Card>
      </div>

      {/* Actual Cash Flow vs Planned Allocation */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-white">
            <LucideTrendingUp className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            Actual Cash Flow (Recorded)
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Actual Income</span>
              <span className="font-bold text-white tabular-nums">AED {parseFloat(data.actual.income).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Actual Expenses</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.actual.expenses).toFixed(2)}</span>
            </div>
            <div className="flex flex-col items-center justify-between border-b border-slate-800 pb-2 text-sm sm:flex-row">
              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Net Savings Flow</span>
                <span className="inline-flex" title="Deposits minus Withdrawals. Positive means money transferred to savings.">
                  <LucideInfo className="h-3.5 w-3.5 cursor-help text-slate-500" />
                </span>
              </div>
              <span className="mt-1 font-bold text-slate-200 tabular-nums sm:mt-0">AED {parseFloat(data.actual.savings).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Actual Remittances</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.actual.remittances).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Actual Debt Payments</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.actual.debtPayments).toFixed(2)}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-white">
            <LucideCalendar className="h-5 w-5 text-indigo-400" aria-hidden="true" />
            Planned Budget Plan (Month allocation)
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Target Monthly Salary</span>
              <span className="font-bold text-white tabular-nums">AED {parseFloat(data.planned.salary).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Planned Expenses (Fixed/Variable)</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.expenses).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Planned Savings Targets</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.savings).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Planned Remittances (Family)</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.remittances).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Planned Debt Installments</span>
              <span className="font-bold text-slate-200 tabular-nums">AED {parseFloat(data.planned.debtPayments).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-1 text-sm text-emerald-400">
              <span>Unallocated Salary Balance</span>
              <span className="font-extrabold tabular-nums">AED {parseFloat(data.planned.unallocated).toFixed(2)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Two-Column Grid: Transactions & Upcoming Feed */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <LucideReceipt className="h-5 w-5 text-slate-400" aria-hidden="true" />
                Recent Transactions (Current Month)
              </h3>
              <Link href="/transactions" className="text-xs font-semibold text-indigo-400 transition-colors hover:text-indigo-300">
                View Ledger →
              </Link>
            </div>

            {!data.recentTransactions.length ? (
              <p className="py-12 text-center text-sm italic text-slate-500">No transactions recorded yet for this month.</p>
            ) : (
              <div className="max-h-80 space-y-0.5 divide-y divide-slate-800 overflow-y-auto pr-1">
                {data.recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-200">{tx.description}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
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
                    <span
                      className={clsx(
                        "ml-4 whitespace-nowrap text-sm font-bold tabular-nums",
                        tx.type === "INCOME" ? "text-emerald-400" : tx.type === "SAVINGS" ? "text-slate-400" : "text-rose-400"
                      )}
                    >
                      {tx.type === "INCOME" ? "+" : "-"}AED {parseFloat(tx.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-white">
                <LucideClock className="h-5 w-5 text-indigo-400" aria-hidden="true" />
                Upcoming Payments & Reminders
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dubai Timezone</span>
            </div>

            {upcomingPayments.length === 0 ? (
              <p className="py-12 text-center text-sm italic text-slate-500">No upcoming payments or active alerts.</p>
            ) : (
              <div className="max-h-80 space-y-2 divide-y divide-slate-800 overflow-y-auto pr-1">
                {upcomingPayments.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-y-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-200">{item.title}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>Due: {item.dueDate}</span>
                        <span>•</span>
                        <Badge
                          tone={
                            item.status === "OVERDUE"
                              ? "rose"
                              : item.status === "DUE_TODAY"
                              ? "amber"
                              : item.status === "HANDLED"
                              ? "emerald"
                              : "slate"
                          }
                          pulse={item.status === "OVERDUE"}
                        >
                          {item.status}
                        </Badge>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-white tabular-nums">AED {item.amount}</span>

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
                            className={buttonVariants({ variant: "primary", size: "sm", className: "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-500" })}
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
                              className={buttonVariants({ variant: "secondary", size: "sm" })}
                            >
                              Skip
                            </button>
                          )}
                        </div>
                      ) : !item.canMarkHandled && item.status !== "HANDLED" ? (
                        <Link href={item.destinationPath} className={buttonVariants({ variant: "primary", size: "sm" })}>
                          Pay Info
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Rollover Prompt Modal */}
      {isRolloverModalOpen && rolloverPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-lg space-y-5 border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
            <div>
              <h3 className="text-lg font-bold text-white">Monthly Budget Rollover Preview</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Copy category budget allocations from {getMonthLabel(previousMonth)} to {getMonthLabel(selectedMonth)}.
              </p>
            </div>

            {rolloverError && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-semibold text-rose-400"
              >
                <LucideAlertTriangle className="h-4 w-4" aria-hidden="true" />
                {rolloverError}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-950/45 p-3 text-xs">
                <div>
                  <span className="mb-0.5 block text-slate-400">Planned Salary</span>
                  <span className="text-sm font-bold text-white tabular-nums">AED {parseFloat(rolloverPreview.plannedSalary).toFixed(2)}</span>
                </div>
                <div>
                  <span className="mb-0.5 block text-slate-400">Planned Allocation</span>
                  <span className="text-sm font-bold text-white tabular-nums">AED {parseFloat(rolloverPreview.totalPlannedAllocation).toFixed(2)}</span>
                </div>
                <div>
                  <span className="mb-0.5 block text-slate-400">Unallocated Amount</span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">AED {parseFloat(rolloverPreview.unallocatedAmount).toFixed(2)}</span>
                </div>
                <div>
                  <span className="mb-0.5 block text-slate-400">Overdue Reminders</span>
                  <span className={clsx("text-sm font-bold", rolloverPreview.overdueRemindersCount > 0 ? "text-rose-400" : "text-slate-300")}>
                    {rolloverPreview.overdueRemindersCount} unresolved
                  </span>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Budgets to copy ({rolloverPreview.budgetsToCopy.length})
                </h4>
                <div className="max-h-40 divide-y divide-slate-800 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950/20 px-3">
                  {rolloverPreview.budgetsToCopy.map((b: { categoryName: string; amount: string }, idx: number) => (
                    <div key={idx} className="flex items-center justify-between py-2 text-xs">
                      <span className="font-medium text-slate-300">{b.categoryName}</span>
                      <span className="font-bold text-slate-200 tabular-nums">AED {b.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsRolloverModalOpen(false);
                  setRolloverError("");
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={() => confirmRolloverMutation.mutate()} disabled={confirmRolloverMutation.isPending}>
                {confirmRolloverMutation.isPending ? "Confirming…" : "Confirm & Copy"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
