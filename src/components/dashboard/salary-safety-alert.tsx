"use client";

import { useQuery } from "@tanstack/react-query";
import { LucideAlertOctagon, LucideAlertTriangle } from "lucide-react";
import Link from "next/link";

interface HealthAlert {
  type: string;
  message: string;
}

export function SalarySafetyAlert() {
  const { data, isLoading } = useQuery<{ isHealthy: boolean; alerts: HealthAlert[] }>({
    queryKey: ["imports-health"],
    queryFn: async () => {
      const res = await fetch("/api/imports/health");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  if (isLoading || !data || data.isHealthy || data.alerts.length === 0) return null;

  return (
    <div className="space-y-3">
      {data.alerts.map((alert, i) => (
        <div key={i} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border p-4 shadow-lg animate-in fade-in slide-in-from-top duration-300 ${alert.type === "SALARY_MISSING" ? "border-rose-500/30 bg-rose-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
          <div className="flex gap-3 items-start">
            {alert.type === "SALARY_MISSING" ? (
              <LucideAlertOctagon className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <LucideAlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div>
              <h4 className={`font-bold text-sm ${alert.type === "SALARY_MISSING" ? "text-rose-400" : "text-amber-400"}`}>
                {alert.type === "SALARY_MISSING" ? "Salary Import Missing" : "Webhook Health Warning"}
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {alert.message}
              </p>
            </div>
          </div>
          <Link
            href="/imports"
            className={`shrink-0 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              alert.type === "SALARY_MISSING"
                ? "bg-rose-500 hover:bg-rose-600 text-white"
                : "bg-amber-500 hover:bg-amber-600 text-slate-900"
            }`}
          >
            Review Imports
          </Link>
        </div>
      ))}
    </div>
  );
}
