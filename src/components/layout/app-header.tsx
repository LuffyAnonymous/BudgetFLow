"use client";

import { usePathname } from "next/navigation";
import { LucideMenu } from "lucide-react";
import { NotificationDropdown } from "./notification-dropdown";
import { GlobalSearch } from "@/components/search/global-search";

interface AppHeaderProps {
  onMenuToggle: () => void;
}

export function AppHeader({ onMenuToggle }: AppHeaderProps) {
  const pathname = usePathname();

  // Helper to map route to readable page title
  const getPageTitle = (path: string) => {
    const segment = path.split("/")[1];
    if (!segment) return "Dashboard";
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  };

  return (
    <header className="flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-900 px-6 text-white lg:bg-slate-950">
      {/* Mobile Drawer Trigger */}
      <button
        onClick={onMenuToggle}
        className="rounded-lg p-1.5 hover:bg-slate-800 focus:outline-none lg:hidden"
      >
        <LucideMenu className="h-6 w-6 text-slate-350" />
      </button>

      {/* Dynamic Title */}
      <h1 className="text-xl font-bold tracking-tight text-white lg:text-2xl">
        {getPageTitle(pathname)}
      </h1>

      {/* Utility Area */}
      <div className="flex items-center gap-3">
        <GlobalSearch />
        <span className="hidden text-xs font-medium text-slate-400 sm:block">
          AED Default Account
        </span>
        <NotificationDropdown />
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" title="System Connected" />
      </div>
    </header>
  );
}

