"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  LucideBarChart3,
  LucideTrendingUp,
  LucideTrendingDown,
  LucidePiggyBank,
  LucideSend,
  LucidePieChart,
  LucideChevronLeft,
  LucideChevronRight,
  LucideDownload,
  LucideSparkles,
  LucideWallet,
  LucideCircleAlert,
  LucideBadgeCheck,
  LucideHourglass,
  LucideLoader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";

interface MonthlyReport {
  month: string;
  income: string;
  expense: string;
  netCashFlow: string;
  spendingByCategory: { categoryName: string; amount: string; type: string }[];
  budgetVsActual: {
    categoryName: string;
    budgeted: string;
    actual: string;
    difference: string;
  }[];
  remittances: {
    grossAmountSent: string;
    reversedAmount: string;
    netAmountSent: string;
    grossFees: string;
    reversedFees: string;
    netFees: string;
    grossPhpReceived: string;
    reversedPhp: string;
    netPhpReceived: string;
  };
  debts: {
    totalPayments: string;
  };
  savings: {
    totalDeposits: string;
    totalWithdrawals: string;
  };
}

interface SpendingRecommendation {
  monthsOfHistory: number;
  dataSufficient: boolean;
  salary: {
    calculated: string;
    declared: string;
    source: "SALARY_TAGGED" | "ALL_INCOME" | "DECLARED_FALLBACK";
    discrepancyPct: string | null;
  };
  fixedCommitments: {
    historicalFixedExpenses: string;
    debtPayments: string;
    remittance: string;
    total: string;
  };
  recommendation: {
    recommendedSavings: string;
    recommendedSafeToSpend: string;
    isOverCommitted: boolean;
  } | null;
  categoryBreakdown: { categoryName: string; historicalSharePct: string; suggestedCap: string }[];
}

interface TrendReport {
  months: {
    month: string;
    income: string;
    expense: string;
    netCashFlow: string;
    debtBalance: string;
    savingsBalance: string;
    remittanceSent: string;
  }[];
}

const CATEGORY_COLORS = [
  "#6366f1", // Indigo
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#a855f7", // Purple
  "#f43f5e", // Rose
];

const CHART_TOOLTIP_STYLE = { backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" };

const TABS = [
  { id: "monthly", label: "Monthly Summary" },
  { id: "trends", label: "Historical Trends" },
  { id: "insights", label: "Smart Insights" },
  { id: "export", label: "Export Center" },
] as const;

export function ReportsClient() {
  const [activeTab, setActiveTab] = useState<"monthly" | "trends" | "insights" | "export">("monthly");
  const [mounted, setMounted] = useState(false);

  const [monthlyMonth, setMonthlyMonth] = useState("2026-07");
  const [trendFrom, setTrendFrom] = useState("2026-01");
  const [trendTo, setTrendTo] = useState("2026-07");

  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  const { data: monthlyData, isLoading: loadingMonthly } = useQuery<MonthlyReport>({
    queryKey: ["monthly-report", monthlyMonth],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?month=${monthlyMonth}`);
      const json = await res.json();
      return json.data;
    },
    enabled: activeTab === "monthly",
  });

  const { data: trendData, isLoading: loadingTrends } = useQuery<TrendReport>({
    queryKey: ["trends-report", trendFrom, trendTo],
    queryFn: async () => {
      const res = await fetch(`/api/reports/trends?from=${trendFrom}&to=${trendTo}`);
      const json = await res.json();
      return json.data;
    },
    enabled: activeTab === "trends",
  });

  const { data: insightsData, isLoading: loadingInsights } = useQuery<SpendingRecommendation>({
    queryKey: ["spending-insights"],
    queryFn: async () => {
      const res = await fetch("/api/reports/insights");
      const json = await res.json();
      return json.data;
    },
    enabled: activeTab === "insights",
  });

  const handleExport = (type: string) => {
    let url = `/api/exports?type=${type}`;
    if (exportStartDate) url += `&startDate=${exportStartDate}`;
    if (exportEndDate) url += `&endDate=${exportEndDate}`;
    window.open(url, "_blank");
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

  const changeMonthlyMonth = (offset: number) => {
    const [y, m] = monthlyMonth.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    const nextY = date.getUTCFullYear();
    const nextM = String(date.getUTCMonth() + 1).padStart(2, "0");
    setMonthlyMonth(`${nextY}-${nextM}`);
  };

  return (
    <div className="animate-in fade-in space-y-8 text-slate-100 duration-300">
      <PageHeader title="Financial Reports" description="Analyze your income, outgoings, budget progress, debts, and PHP remittances." />

      {/* Tabs */}
      <div className="flex gap-6 border-b border-slate-800" role="tablist" aria-label="Report sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={
              "border-b-2 px-1 pb-4 text-sm font-semibold transition-colors " +
              (activeTab === tab.id ? "border-indigo-500 font-bold text-white" : "border-transparent text-slate-400 hover:text-slate-200")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Monthly Report Tab */}
      {activeTab === "monthly" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Select Reporting Month</h3>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1.5">
              <button onClick={() => changeMonthlyMonth(-1)} className="rounded-lg p-1.5 transition-colors hover:bg-slate-800" aria-label="Previous month">
                <LucideChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="min-w-32 text-center text-xs font-bold text-white">{getMonthLabel(monthlyMonth)}</span>
              <button onClick={() => changeMonthlyMonth(1)} className="rounded-lg p-1.5 transition-colors hover:bg-slate-800" aria-label="Next month">
                <LucideChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {loadingMonthly ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
              <LucideLoader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
              <p className="text-sm">Generating monthly analysis…</p>
            </div>
          ) : !monthlyData ? (
            <EmptyState
              icon={LucideBarChart3}
              title="No data for this month"
              description="Nothing was recorded in this period yet — figures will appear here once there's activity."
            />
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  label="Net Cash Flow"
                  value={`AED ${parseFloat(monthlyData.netCashFlow).toFixed(2)}`}
                  tone={parseFloat(monthlyData.netCashFlow) >= 0 ? "emerald" : "rose"}
                  caption="Income - Expenses (Ledger)"
                />
                <StatTile
                  label="Remittances (PH)"
                  value={`AED ${parseFloat(monthlyData.remittances.netAmountSent).toFixed(2)}`}
                  tone="slate"
                  caption={`PHP ${parseFloat(monthlyData.remittances.netPhpReceived).toFixed(2)} received`}
                />
                <StatTile
                  label="Debt Payments"
                  value={`AED ${parseFloat(monthlyData.debts.totalPayments).toFixed(2)}`}
                  tone="rose"
                  caption="Total installments paid"
                />
                <StatTile
                  label="Savings Goal Flow"
                  value={`AED ${(parseFloat(monthlyData.savings.totalDeposits) - parseFloat(monthlyData.savings.totalWithdrawals)).toFixed(2)}`}
                  tone="indigo"
                  caption={`Deposits: +${parseFloat(monthlyData.savings.totalDeposits).toFixed(0)} | W/D: -${parseFloat(monthlyData.savings.totalWithdrawals).toFixed(0)}`}
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Card className="space-y-4 p-6">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucideBarChart3 className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Income vs Outgoings
                  </h4>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: "Income", Amount: parseFloat(monthlyData.income) },
                            { name: "Outgoings", Amount: parseFloat(monthlyData.expense) },
                          ]}
                          margin={{ top: 20, right: 10, left: -20, bottom: 0 }}
                        >
                          <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "#fff", fontWeight: "bold" }} />
                          <Bar dataKey="Amount" radius={[10, 10, 0, 0]}>
                            <Cell fill="#6366f1" />
                            <Cell fill="#f43f5e" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                <Card className="space-y-4 p-6">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucidePieChart className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Spending by Category
                  </h4>
                  <div className="grid grid-cols-2 items-center">
                    <div className="h-60">
                      {mounted && monthlyData.spendingByCategory.length > 0 && (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={monthlyData.spendingByCategory.map((c) => ({
                                name: c.categoryName,
                                value: parseFloat(c.amount),
                              }))}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {monthlyData.spendingByCategory.map((_, idx) => (
                                <Cell key={`cell-${idx}`} fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                      {monthlyData.spendingByCategory.length === 0 && (
                        <div className="flex h-full items-center justify-center text-xs italic text-slate-500">No category records.</div>
                      )}
                    </div>
                    <div className="space-y-2 text-xs">
                      {monthlyData.spendingByCategory.slice(0, 6).map((c, idx) => (
                        <div key={c.categoryName} className="flex items-center justify-between">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-slate-400">{c.categoryName}</span>
                          </div>
                          <span className="font-semibold tabular-nums text-slate-200">AED {parseFloat(c.amount).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card className="space-y-4 p-6 md:col-span-2">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucideBarChart3 className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Budget vs Actual Spending
                  </h4>
                  <div className="h-72">
                    {mounted && monthlyData.budgetVsActual.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={monthlyData.budgetVsActual.map((b) => ({
                            name: b.categoryName,
                            Budgeted: parseFloat(b.budgeted),
                            Actual: parseFloat(b.actual),
                          }))}
                          margin={{ top: 20, right: 10, left: -20, bottom: 0 }}
                        >
                          <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "#fff", fontWeight: "bold" }} />
                          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                          <Bar dataKey="Budgeted" fill="#475569" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Actual" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                    {monthlyData.budgetVsActual.length === 0 && (
                      <div className="flex h-full items-center justify-center text-xs italic text-slate-500">No active budget targets set for this month.</div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historical Trends Tab */}
      {activeTab === "trends" && (
        <div className="space-y-6">
          <div className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="trend-from" className="text-xs font-semibold uppercase text-slate-400">
                From Month
              </label>
              <input
                id="trend-from"
                type="month"
                value={trendFrom}
                onChange={(e) => setTrendFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="trend-to" className="text-xs font-semibold uppercase text-slate-400">
                To Month
              </label>
              <input
                id="trend-to"
                type="month"
                value={trendTo}
                onChange={(e) => setTrendTo(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {loadingTrends ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
              <LucideLoader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
              <p className="text-sm">Compiling trend analysis…</p>
            </div>
          ) : !trendData?.months.length ? (
            <p className="py-12 text-center italic text-slate-500">No trend data available for this range.</p>
          ) : (
            <div className="space-y-6">
              <Card className="space-y-4 p-6">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <LucideTrendingUp className="h-4.5 w-4.5 text-emerald-400" aria-hidden="true" />
                  Net Monthly Cash Flow Trend
                </h3>
                <div className="h-64">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData.months} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Area type="monotone" dataKey="netCashFlow" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                <Card className="space-y-4 p-6">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucideTrendingDown className="h-4.5 w-4.5 text-rose-400" aria-hidden="true" />
                    Debt Balance Trend (Historical Snapshot)
                  </h3>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData.months} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                          <Line type="monotone" dataKey="debtBalance" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                <Card className="space-y-4 p-6">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucidePiggyBank className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Savings Balance Trend (Historical Snapshot)
                  </h3>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData.months} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                          <Line type="monotone" dataKey="savingsBalance" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                <Card className="space-y-4 p-6 md:col-span-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucideSend className="h-4.5 w-4.5 text-emerald-400" aria-hidden="true" />
                    Philippines Remittances Sent Trend
                  </h3>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trendData.months} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                          <Bar dataKey="remittanceSent" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Smart Insights Tab */}
      {activeTab === "insights" && (
        <div className="space-y-6">
          {loadingInsights ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
              <LucideLoader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
              <p className="text-sm">Analyzing your transaction history…</p>
            </div>
          ) : !insightsData ? (
            <EmptyState icon={LucideSparkles} title="No insights yet" description="Nothing to analyze yet — insights appear once transactions start coming in." />
          ) : !insightsData.dataSufficient ? (
            <EmptyState
              icon={LucideHourglass}
              title="Still learning your spending patterns"
              description={`Only ${insightsData.monthsOfHistory} month${insightsData.monthsOfHistory === 1 ? "" : "s"} of transaction history so far — at least 2 months are needed before a recommendation can be trusted. Keep importing transactions and check back.`}
            />
          ) : (
            <div className="space-y-6">
              <Card className="border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-slate-900/40 to-slate-900/40 p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/80">
                    {insightsData.salary.source === "SALARY_TAGGED"
                      ? "Calculated Salary"
                      : insightsData.salary.source === "ALL_INCOME"
                      ? "Calculated From Income"
                      : "Declared Salary"}
                  </p>
                  {insightsData.salary.source !== "DECLARED_FALLBACK" && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                      <LucideBadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> From {insightsData.monthsOfHistory}-month history
                    </span>
                  )}
                </div>
                <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums text-white">
                  AED {parseFloat(insightsData.salary.calculated).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {insightsData.salary.source !== "DECLARED_FALLBACK" && (
                  <p className="mt-2 text-xs text-slate-400">
                    Your declared salary in Settings is AED {parseFloat(insightsData.salary.declared).toFixed(2)}.
                    {insightsData.salary.discrepancyPct && (
                      <span className="font-semibold text-amber-400"> That&apos;s a {insightsData.salary.discrepancyPct}% difference — consider updating Settings.</span>
                    )}
                  </p>
                )}
              </Card>

              <Card className="space-y-4 p-6">
                <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                  <LucideWallet className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                  Fixed Monthly Commitments
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Recurring Bills</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">AED {parseFloat(insightsData.fixedCommitments.historicalFixedExpenses).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Debt Payments</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">AED {parseFloat(insightsData.fixedCommitments.debtPayments).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-950/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Remittances</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-slate-200">AED {parseFloat(insightsData.fixedCommitments.remittance).toFixed(2)}</p>
                  </div>
                </div>
                <p className="border-t border-slate-800 pt-3 text-xs text-slate-500">
                  Total committed: <span className="font-bold tabular-nums text-slate-300">AED {parseFloat(insightsData.fixedCommitments.total).toFixed(2)}</span> — derived
                  from your recent bills, active debts, and remittance history.
                </p>
              </Card>

              {insightsData.recommendation?.isOverCommitted ? (
                <Card className="flex items-start gap-3 border-rose-500/20 bg-rose-500/5 p-6">
                  <LucideCircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-bold text-rose-300">Your fixed commitments exceed your calculated salary</h3>
                    <p className="mt-1 text-xs text-rose-300/70">
                      There&apos;s no safe-to-spend budget to recommend this month — your recurring bills, debt payments, and remittances alone add up to more than
                      you&apos;re earning. Review your commitments or debts before planning new spending.
                    </p>
                  </div>
                </Card>
              ) : insightsData.recommendation ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <Card className="border-emerald-500/20 bg-emerald-500/5 p-6 lg:col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Safe to Spend This Month</p>
                    <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums text-white">
                      AED{" "}
                      {parseFloat(insightsData.recommendation.recommendedSafeToSpend).toLocaleString("en-AE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      What&apos;s left after fixed commitments and your recommended savings — free to spend on groceries, dining, shopping, and other variable
                      categories.
                    </p>
                  </Card>
                  <Card className="border-indigo-500/20 bg-indigo-500/5 p-6">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/80">Recommended Savings</p>
                    <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-indigo-300">
                      AED {parseFloat(insightsData.recommendation.recommendedSavings).toFixed(2)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">Based on your own best sustainable months, not a generic rule.</p>
                  </Card>
                </div>
              ) : null}

              {insightsData.categoryBreakdown.length > 0 && (
                <Card className="space-y-4 p-6">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <LucidePieChart className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Suggested Category Caps
                  </h3>
                  <div className="space-y-3">
                    {insightsData.categoryBreakdown.map((c, idx) => (
                      <div key={c.categoryName}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">{c.categoryName}</span>
                          <span className="tabular-nums text-slate-400">
                            AED {parseFloat(c.suggestedCap).toFixed(2)} <span className="text-slate-600">({c.historicalSharePct}%)</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-800">
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${c.historicalSharePct}%`, backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                    Split proportionally to how you&apos;ve historically spent across these categories.
                  </p>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* Export Center Tab */}
      {activeTab === "export" && (
        <div className="space-y-6">
          <Card className="space-y-6 p-6">
            <div>
              <h3 className="text-lg font-bold text-white">Export Center</h3>
              <p className="mt-1 text-sm text-slate-400">Filter by date and download spreadsheet-neutral CSV files of your financial records. Up to a 5 year range.</p>
            </div>

            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="export-start" className="text-xs font-semibold uppercase text-slate-400">
                  Start Date
                </label>
                <input
                  id="export-start"
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="export-end" className="text-xs font-semibold uppercase text-slate-400">
                  End Date
                </label>
                <input
                  id="export-end"
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid gap-4 pt-4 sm:grid-cols-2 md:grid-cols-3">
              {[
                { type: "transactions", title: "Ledger Transactions", subtitle: "Full transactions log" },
                { type: "budgets", title: "Budget Targets", subtitle: "Budget limits by category" },
                { type: "debt_payments", title: "Debt Payments", subtitle: "Debt schedule payouts" },
                { type: "savings_transactions", title: "Savings Transactions", subtitle: "Deposits & withdrawals" },
                { type: "remittances", title: "PH Remittances", subtitle: "Remittance logs to Philippines" },
                { type: "monthly_summary", title: "Monthly Trend Summary", subtitle: "Monthly cash flow & balances" },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => handleExport(item.type)}
                  className="group flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-4 text-left text-sm font-semibold transition-colors hover:bg-slate-900/60 hover:text-white"
                >
                  <div>
                    <span className="block font-bold text-white">{item.title}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{item.subtitle}</span>
                  </div>
                  <LucideDownload className="h-4.5 w-4.5 text-indigo-400 transition-colors group-hover:text-indigo-300" aria-hidden="true" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
