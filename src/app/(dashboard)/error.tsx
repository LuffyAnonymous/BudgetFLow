"use client";

import { useEffect } from "react";
import { LucideAlertTriangle, LucideRefreshCw } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Dashboard-level error boundary.
 * Catches runtime errors in the (dashboard) route group.
 * Does NOT expose raw error messages or stack traces to the user.
 */
export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to server-side error tracking in production
    console.error("[DashboardError]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[60vh] flex items-center justify-center p-8"
    >
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-rose-500/10 p-5 border border-rose-500/20">
            <LucideAlertTriangle className="h-10 w-10 text-rose-400" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            An unexpected error occurred while loading this page.
            Your data has not been affected.
            {error.digest && (
              <span className="block mt-2 text-xs text-slate-600 font-mono">
                Reference: {error.digest}
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 transition-all"
          >
            <LucideRefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-5 py-2.5 transition-all"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
