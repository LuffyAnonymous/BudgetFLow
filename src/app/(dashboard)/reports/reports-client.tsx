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

export function ReportsClient() {
  const [activeTab, setActiveTab] = useState<"monthly" | "trends" | "insights" | "export">("monthly");
  const [mounted, setMounted] = useState(false);

  // Date selections
  const [monthlyMonth, setMonthlyMonth] = useState("2026-07");
  const [trendFrom, setTrendFrom] = useState("2026-01");
  const [trendTo, setTrendTo] = useState("2026-07");

  // Export filters
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  // Queries
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
    <div className="space-y-8 text-slate-100 animate-in fade-in duration-300">
      <PageHeader
        title="Financial Reports"
        description="Analyze your income, outgoings, budget progress, debts, and PHP remittances."
      />

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab("monthly")}
          className={`pb-4 text-sm font-semibold border-b-2 px-1 transition-colors ${
            activeTab === "monthly"
              ? "border-indigo-500 text-white font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Monthly Summary
        </button>
        <button
          onClick={() => setActiveTab("trends")}
          className={`pb-4 text-sm font-semibold border-b-2 px-1 transition-colors ${
            activeTab === "trends"
              ? "border-indigo-500 text-white font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Historical Trends
        </button>
        <button
          onClick={() => setActiveTab("insights")}
          className={`pb-4 text-sm font-semibold border-b-2 px-1 transition-colors ${
            activeTab === "insights"
              ? "border-indigo-500 text-white font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Smart Insights
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`pb-4 text-sm font-semibold border-b-2 px-1 transition-colors ${
            activeTab === "export"
              ? "border-indigo-500 text-white font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Export Center
        </button>
      </div>

      {/* Monthly Report Tab */}
      {activeTab === "monthly" && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex items-center justify-between bg-slate-900/30 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Select Reporting Month</h3>
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1.5 gap-2">
              <button
                onClick={() => changeMonthlyMonth(-1)}
                className="rounded-lg p-1.5 hover:bg-slate-800 transition-colors"
              >
                <LucideChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold min-w-32 text-center text-white">
                {getMonthLabel(monthlyMonth)}
              </span>
              <button
                onClick={() => changeMonthlyMonth(1)}
                className="rounded-lg p-1.5 hover:bg-slate-800 transition-colors"
              >
                <LucideChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {loadingMonthly ? (
            <p className="text-center text-slate-500 py-12">Generating monthly analysis...</p>
          ) : !monthlyData ? (
            <EmptyState
              icon={LucideBarChart3}
              title="No data for this month"
              description="Nothing was recorded in this period yet — figures will appear here once there's activity."
            />
          ) : (
            <div className="space-y-6">
              {/* Cards Summary */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Net Cash Flow</span>
                  <div className={`mt-2 text-2xl font-bold ${
                    parseFloat(monthlyData.netCashFlow) >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    AED {parseFloat(monthlyData.netCashFlow).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Income - Expenses (Ledger)</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Remittances (PH)</span>
                  <div className="mt-2 text-2xl font-bold text-white">
                    AED {parseFloat(monthlyData.remittances.netAmountSent).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    PHP {parseFloat(monthlyData.remittances.netPhpReceived).toFixed(2)} received
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Debt Payments</span>
                  <div className="mt-2 text-2xl font-bold text-rose-400">
                    AED {parseFloat(monthlyData.debts.totalPayments).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Total installments paid</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-5">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Savings Goal Flow</span>
                  <div className="mt-2 text-2xl font-bold text-indigo-400">
                    AED {(parseFloat(monthlyData.savings.totalDeposits) - parseFloat(monthlyData.savings.totalWithdrawals)).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Deposits: +{parseFloat(monthlyData.savings.totalDeposits).toFixed(0)} | W/D: -{parseFloat(monthlyData.savings.totalWithdrawals).toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Monthly Visualizations Grid */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Income vs Outgoing Bar */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucideBarChart3 className="h-4.5 w-4.5 text-indigo-400" />
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
                          <Tooltip
                            contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                            labelStyle={{ color: "#fff", fontWeight: "bold" }}
                          />
                          <Bar dataKey="Amount" radius={[10, 10, 0, 0]}>
                            <Cell fill="#6366f1" />
                            <Cell fill="#f43f5e" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Spending by Category Pie */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucidePieChart className="h-4.5 w-4.5 text-indigo-400" />
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
                            <Tooltip
                              contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                      {monthlyData.spendingByCategory.length === 0 && (
                        <div className="h-full flex items-center justify-center text-slate-500 italic text-xs">
                          No category records.
                        </div>
                      )}
                    </div>
                    {/* Pie Legend List */}
                    <div className="space-y-2 text-xs">
                      {monthlyData.spendingByCategory.slice(0, 6).map((c, idx) => (
                        <div key={c.categoryName} className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                            />
                            <span className="text-slate-400 truncate">{c.categoryName}</span>
                          </div>
                          <span className="font-semibold text-slate-200">AED {parseFloat(c.amount).toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Budget vs Actual Comparison */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4 md:col-span-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucideBarChart3 className="h-4.5 w-4.5 text-indigo-400" />
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
                          <Tooltip
                            contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                            labelStyle={{ color: "#white", fontWeight: "bold" }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                          <Bar dataKey="Budgeted" fill="#475569" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Actual" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                    {monthlyData.budgetVsActual.length === 0 && (
                      <div className="h-full flex items-center justify-center text-slate-500 italic text-xs">
                        No active budget targets set for this month.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historical Trends Tab */}
      {activeTab === "trends" && (
        <div className="space-y-6">
          {/* Range Controls */}
          <div className="grid gap-4 sm:grid-cols-2 bg-slate-900/30 border border-slate-800 rounded-2xl p-4 text-sm">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase">From Month</label>
              <input
                type="month"
                value={trendFrom}
                onChange={(e) => setTrendFrom(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400 uppercase">To Month</label>
              <input
                type="month"
                value={trendTo}
                onChange={(e) => setTrendTo(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none text-white"
              />
            </div>
          </div>

          {loadingTrends ? (
            <p className="text-center text-slate-500 py-12">Compiling trend analysis...</p>
          ) : !trendData?.months.length ? (
            <p className="text-center text-slate-500 py-12 italic">No trend data available for this range.</p>
          ) : (
            <div className="space-y-6">
              {/* Net Cash Flow Trend Chart */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <LucideTrendingUp className="h-4.5 w-4.5 text-emerald-400" />
                  Net Monthly Cash Flow Trend
                </h4>
                <div className="h-64">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={trendData.months}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                        />
                        <Area type="monotone" dataKey="netCashFlow" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Debt & Savings Balance Line Trend */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Debt Balance line */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucideTrendingDown className="h-4.5 w-4.5 text-rose-400" />
                    Debt Balance Trend (Historical Snapshot)
                  </h4>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={trendData.months}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                          />
                          <Line type="monotone" dataKey="debtBalance" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Savings Balance line */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucidePiggyBank className="h-4.5 w-4.5 text-indigo-400" />
                    Savings Balance Trend (Historical Snapshot)
                  </h4>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={trendData.months}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                          />
                          <Line type="monotone" dataKey="savingsBalance" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Remittances Sent Trend */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4 md:col-span-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucideSend className="h-4.5 w-4.5 text-emerald-400" />
                    Philippines Remittances Sent Trend
                  </h4>
                  <div className="h-64">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={trendData.months}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                          <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "12px" }}
                          />
                          <Bar dataKey="remittanceSent" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Smart Insights Tab */}
      {activeTab === "insights" && (
        <div className="space-y-6">
          {loadingInsights ? (
            <p className="text-center text-slate-500 py-12">Analyzing your transaction history...</p>
          ) : !insightsData ? (
            <EmptyState
              icon={LucideSparkles}
              title="No insights yet"
              description="Nothing to analyze yet — insights appear once transactions start coming in."
            />
          ) : !insightsData.dataSufficient ? (
            <EmptyState
              icon={LucideHourglass}
              title="Still learning your spending patterns"
              description={`Only ${insightsData.monthsOfHistory} month${insightsData.monthsOfHistory === 1 ? "" : "s"} of transaction history so far — at least 2 months are needed before a recommendation can be trusted. Keep importing transactions and check back.`}
            />
          ) : (
            <div className="space-y-6">
              {/* Salary: asymmetric hero + declared-vs-calculated comparison, not a repeated 3-card grid */}
              <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-slate-900/40 to-slate-900/40 p-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-semibold">
                    {insightsData.salary.source === "SALARY_TAGGED" ? "Calculated Salary" : insightsData.salary.source === "ALL_INCOME" ? "Calculated From Income" : "Declared Salary"}
                  </p>
                  {insightsData.salary.source !== "DECLARED_FALLBACK" && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                      <LucideBadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> From {insightsData.monthsOfHistory}-month history
                    </span>
                  )}
                </div>
                <p className="mt-2 text-4xl font-bold text-white tabular-nums tracking-tight">
                  AED {parseFloat(insightsData.salary.calculated).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {insightsData.salary.source !== "DECLARED_FALLBACK" && (
                  <p className="mt-2 text-xs text-slate-400">
                    Your declared salary in Settings is AED {parseFloat(insightsData.salary.declared).toFixed(2)}.
                    {insightsData.salary.discrepancyPct && (
                      <span className="text-amber-400 font-semibold"> That&apos;s a {insightsData.salary.discrepancyPct}% difference — consider updating Settings.</span>
                    )}
                  </p>
                )}
              </div>

              {/* Fixed commitments breakdown */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <LucideWallet className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                  Fixed Monthly Commitments
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-950/40 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Recurring Bills</p>
                    <p className="font-bold text-sm text-slate-200 mt-1 tabular-nums">AED {parseFloat(insightsData.fixedCommitments.historicalFixedExpenses).toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-950/40 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Debt Payments</p>
                    <p className="font-bold text-sm text-slate-200 mt-1 tabular-nums">AED {parseFloat(insightsData.fixedCommitments.debtPayments).toFixed(2)}</p>
                  </div>
                  <div className="bg-slate-950/40 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Remittances</p>
                    <p className="font-bold text-sm text-slate-200 mt-1 tabular-nums">AED {parseFloat(insightsData.fixedCommitments.remittance).toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 border-t border-slate-800 pt-3">
                  Total committed: <span className="font-bold text-slate-300">AED {parseFloat(insightsData.fixedCommitments.total).toFixed(2)}</span> — derived from your recent bills, active debts, and remittance history.
                </p>
              </div>

              {/* Recommendation: over-committed warning, or safe-to-spend + savings */}
              {insightsData.recommendation?.isOverCommitted ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 flex items-start gap-3">
                  <LucideCircleAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <h4 className="text-sm font-bold text-rose-300">Your fixed commitments exceed your calculated salary</h4>
                    <p className="text-xs text-rose-300/70 mt-1">
                      There&apos;s no safe-to-spend budget to recommend this month — your recurring bills, debt payments, and remittances alone add up to more than you&apos;re earning. Review your commitments or debts before planning new spending.
                    </p>
                  </div>
                </div>
              ) : insightsData.recommendation ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-semibold">Safe to Spend This Month</p>
                    <p className="mt-2 text-4xl font-bold text-white tabular-nums tracking-tight">
                      AED {parseFloat(insightsData.recommendation.recommendedSafeToSpend).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      What&apos;s left after fixed commitments and your recommended savings — free to spend on groceries, dining, shopping, and other variable categories.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6">
                    <p className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-semibold">Recommended Savings</p>
                    <p className="mt-2 text-2xl font-bold text-indigo-300 tabular-nums tracking-tight">
                      AED {parseFloat(insightsData.recommendation.recommendedSavings).toFixed(2)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">Based on your own best sustainable months, not a generic rule.</p>
                  </div>
                </div>
              ) : null}

              {/* Category breakdown */}
              {insightsData.categoryBreakdown.length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/10 p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <LucidePieChart className="h-4.5 w-4.5 text-indigo-400" aria-hidden="true" />
                    Suggested Category Caps
                  </h4>
                  <div className="space-y-3">
                    {insightsData.categoryBreakdown.map((c, idx) => (
                      <div key={c.categoryName}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-300 font-semibold">{c.categoryName}</span>
                          <span className="text-slate-400 tabular-nums">AED {parseFloat(c.suggestedCap).toFixed(2)} <span className="text-slate-600">({c.historicalSharePct}%)</span></span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${c.historicalSharePct}%`, backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-3">
                    Split proportionally to how you&apos;ve historically spent across these categories.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Export Center Tab */}
      {activeTab === "export" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Export Center</h3>
              <p className="text-sm text-slate-400 mt-1">
                Filter by date and download spreadsheet-neutral CSV files of your financial records. Up to a 5 year range.
              </p>
            </div>

            {/* Optional Date Filter */}
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 uppercase">Start Date</label>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 uppercase">End Date</label>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none text-white"
                />
              </div>
            </div>

            {/* Grid of export scopes */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 pt-4">
              <button
                onClick={() => handleExport("transactions")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Ledger Transactions</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Full transactions log</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("budgets")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Budget Targets</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Budget limits by category</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("debt_payments")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Debt Payments</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Debt schedule payouts</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("savings_transactions")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Savings Transactions</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Deposits & withdrawals</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("remittances")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">PH Remittances</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Remittance logs to Philippines</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("monthly_summary")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Monthly Trend Summary</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Monthly cash flow & balances</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
