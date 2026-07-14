"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
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
  const [activeTab, setActiveTab] = useState<"monthly" | "trends" | "export">("monthly");
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
            <p className="text-center text-slate-500 py-12 italic">No data found for this month.</p>
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
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Ledger Transactions</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Full transactions log</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("budgets")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Budget Targets</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Budget limits by category</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("debt_payments")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Debt Payments</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Debt schedule payouts</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("savings_transactions")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">Savings Transactions</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Deposits & withdrawals</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("remittances")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
              >
                <div>
                  <span className="block text-white font-bold">PH Remittances</span>
                  <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">Remittance logs to Philippines</span>
                </div>
                <LucideDownload className="h-4.5 w-4.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
              </button>

              <button
                onClick={() => handleExport("monthly_summary")}
                className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-850 p-4 text-sm font-semibold hover:bg-slate-900/60 hover:text-white transition-colors group text-left"
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
