"use client";

import React from "react";
import { LucideSearch, LucideX } from "lucide-react";
import { clsx } from "clsx";

interface DataTableToolbarProps {
  /** Current search query value */
  search?: string;
  /** Called when search input changes */
  onSearchChange?: (value: string) => void;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Additional filter controls rendered to the right of the search */
  filters?: React.ReactNode;
  /** Action buttons rendered at the far right (e.g., Add New button) */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * DataTableToolbar
 *
 * Reusable toolbar with an optional search field and filter/action slots.
 * Feature modules pass their own filter dropdowns and action buttons as
 * React nodes — the toolbar only provides layout and the search field.
 *
 * The search input is debounced at the usage site (via useEffect + setTimeout),
 * not here, to keep this component stateless and easily testable.
 */
export function DataTableToolbar({
  search = "",
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  actions,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      className={clsx(
        "flex flex-col sm:flex-row gap-3 items-start sm:items-center",
        className
      )}
    >
      {/* Search input */}
      {onSearchChange && (
        <div className="relative flex-1 min-w-0 max-w-xs">
          <LucideSearch
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl pl-9 pr-9 py-2.5 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <LucideX className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Feature-defined filters */}
      {filters && (
        <div className="flex flex-wrap gap-2 items-center">
          {filters}
        </div>
      )}

      {/* Feature-defined action buttons */}
      {actions && (
        <div className="flex gap-2 items-center sm:ml-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
