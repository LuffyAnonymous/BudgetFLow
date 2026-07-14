import Link from "next/link";
import { LucideCompass } from "lucide-react";

export const metadata = {
  title: "Page not found — BudgetFlow",
};

/**
 * Custom 404 page.
 * Rendered when a route does not match any known path.
 * No dynamic data is shown to prevent information disclosure.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-indigo-500/10 p-5 border border-indigo-500/20">
            <LucideCompass className="h-10 w-10 text-indigo-400" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-7xl font-black text-indigo-500/40">404</p>
          <h1 className="text-2xl font-bold text-white">Page not found</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            The page you are looking for does not exist or may have been moved.
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 transition-all"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-5 py-2.5 transition-all"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
