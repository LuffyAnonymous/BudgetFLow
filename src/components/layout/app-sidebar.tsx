"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LucideLayoutDashboard,
  LucideReceipt,
  LucidePieChart,
  LucideTrendingDown,
  LucidePiggyBank,
  LucideSend,
  LucideBarChart3,
  LucideSettings,
  LucideLogOut,
  LucideUser,
  LucideRefreshCw,
  LucideDownload,
} from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";

const navigationItems = [
  { name: "Dashboard",    href: "/dashboard",    icon: LucideLayoutDashboard },
  { name: "Transactions", href: "/transactions", icon: LucideReceipt },
  { name: "Imports",      href: "/imports",      icon: LucideDownload, showBadge: true },
  { name: "Recurring",    href: "/recurring",    icon: LucideRefreshCw },
  { name: "Budgets",      href: "/budgets",      icon: LucidePieChart },
  { name: "Debts",        href: "/debts",        icon: LucideTrendingDown },
  { name: "Savings",      href: "/savings",      icon: LucidePiggyBank },
  { name: "Remittances",  href: "/remittances",  icon: LucideSend },
  { name: "Reports",      href: "/reports",      icon: LucideBarChart3 },
  { name: "Settings",     href: "/settings",     icon: LucideSettings },
] as const;

interface AppSidebarProps {
  userName?: string | null;
  userEmail?: string | null;
  onCloseMobile?: () => void;
}

export function AppSidebar({ userName, userEmail, onCloseMobile }: AppSidebarProps) {
  const pathname = usePathname();

  // Fetch pending review count for the Imports badge
  const { data: pendingReviewCount = 0 } = useQuery<number>({
    queryKey: ["nav-pending-review"],
    queryFn: async () => {
      const res = await fetch("/api/imports/automation-metrics");
      if (!res.ok) return 0;
      const json = await res.json();
      return (json.data?.queueStats?.pendingReview ?? 0) as number;
    },
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60_000,
  });

  const handleLogout = () => {
    signOut({ redirectTo: "/login" });
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900 text-slate-300">
      {/* Brand Header */}
      <div className="flex h-16 items-center border-b border-slate-800 px-6 gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-md shadow-indigo-500/20">
          <span className="font-bold text-base text-white">B</span>
        </div>
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">BudgetFlow</h2>
          <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Personal finance</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 px-4 py-6" aria-label="Main navigation">
        {navigationItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const showBadge = "showBadge" in item && item.showBadge && pendingReviewCount > 0;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onCloseMobile}
              aria-current={isActive ? "page" : undefined}
              className={clsx(
                "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                  : "hover:bg-slate-800 hover:text-slate-100"
              )}
            >
              <item.icon
                className={clsx(
                  "h-5 w-5 transition-transform group-hover:scale-110",
                  isActive ? "text-white" : "text-slate-400 group-hover:text-slate-300"
                )}
                aria-hidden="true"
              />
              <span className="flex-1">{item.name}</span>
              {showBadge && (
                <span
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black"
                  aria-label={`${pendingReviewCount} import${pendingReviewCount === 1 ? "" : "s"} pending review`}
                >
                  {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Section & Logout */}
      <div className="border-t border-slate-800 p-4 space-y-3">
        <div className="flex items-center gap-3 rounded-xl bg-slate-950/40 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300">
            <LucideUser className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">
              {userName || "User"}
            </p>
            <p className="truncate text-[10px] text-slate-500">
              {userEmail || "user@budgetflow.com"}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <LucideLogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
