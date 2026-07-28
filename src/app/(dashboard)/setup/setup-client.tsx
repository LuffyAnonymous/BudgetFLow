"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LucideSave, LucideCheckCircle2, LucideAlertCircle } from "lucide-react";

export function SetupClient() {
  const router = useRouter();

  // Queries for categories
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.data;
    },
  });

  // State
  const [tabbyBalance, setTabbyBalance] = useState("8284.58");
  const [tableTennisBalance, setTableTennisBalance] = useState("600.00");
  const [salaryCategoryId, setSalaryCategoryId] = useState("");
  const [payday, setPayday] = useState("25");
  const [foodBudget, setFoodBudget] = useState("900.00");
  const [nolBudget, setNolBudget] = useState("400.00");
  const [savingsTarget, setSavingsTarget] = useState("10000.00");
  const [safetyBuffer, setSafetyBuffer] = useState("50.00");
  const [senderAllowlist, setSenderAllowlist] = useState("ENBD");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabbyBalance,
          tableTennisBalance,
          salaryCategoryId: salaryCategoryId || undefined,
          payday,
          foodBudget,
          nolBudget,
          savingsTarget,
          safetyBuffer,
          senderAllowlist,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to initialize setup.");
      }

      setSuccess("Onboarding setup completed successfully! Redirecting...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
          <LucideAlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-sm text-emerald-400">
          <LucideCheckCircle2 className="h-4 w-4" />
          <span>{success}</span>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          1. Initial Debts & Balances
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Tabby Balance (AED)
            </label>
            <input
              type="number"
              step="0.01"
              value={tabbyBalance}
              onChange={(e) => setTabbyBalance(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Table Tennis Equipment Balance (AED)
            </label>
            <input
              type="number"
              step="0.01"
              value={tableTennisBalance}
              onChange={(e) => setTableTennisBalance(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          2. Salary & Imports Allowlist
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Salary Income Category
            </label>
            <select
              value={salaryCategoryId}
              onChange={(e) => setSalaryCategoryId(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
            >
              <option value="">Select Category (Default: Salary)</option>
              {categories?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Payday (Day of Month)
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={payday}
              onChange={(e) => setPayday(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-2">
            Import Sender Allowlist (Comma separated)
          </label>
          <input
            type="text"
            value={senderAllowlist}
            onChange={(e) => setSenderAllowlist(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
            placeholder="e.g. ENBD"
            required
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          3. Budgets & Safety Targets
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Food Monthly Budget (AED)
            </label>
            <input
              type="number"
              step="1"
              value={foodBudget}
              onChange={(e) => setFoodBudget(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Transportation / NOL Budget (AED)
            </label>
            <input
              type="number"
              step="1"
              value={nolBudget}
              onChange={(e) => setNolBudget(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Emergency Fund Goal Target (AED)
            </label>
            <input
              type="number"
              step="1"
              value={savingsTarget}
              onChange={(e) => setSavingsTarget(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              Safe Daily Spending Buffer (AED)
            </label>
            <input
              type="number"
              step="1"
              value={safetyBuffer}
              onChange={(e) => setSafetyBuffer(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-hidden"
              required
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          <LucideSave className="h-4 w-4" />
          {loading ? "Completing Setup..." : "Save Setup Preferences"}
        </button>
      </div>
    </form>
  );
}
