"use client";

import React from "react";
import { LucideChevronLeft, LucideChevronRight } from "lucide-react";
import type { PaginationState } from "./types";
import { clsx } from "clsx";

interface DataTablePaginationProps {
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  /** Optional label displayed before the count, e.g. "transactions" */
  itemLabel?: string;
  className?: string;
}

/**
 * DataTablePagination
 *
 * Server-driven pagination controls. Calculates the displayed item range
 * from the pagination state provided by the parent.
 *
 * Does NOT hold its own page state — the parent query manages pagination
 * so that page changes trigger server requests rather than client filtering.
 */
export function DataTablePagination({
  pagination,
  onPageChange,
  itemLabel = "records",
  className,
}: DataTablePaginationProps) {
  const { page, pageSize, totalItems, totalPages } = pagination;

  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  return (
    <nav
      aria-label={`Pagination — ${itemLabel}`}
      className={clsx(
        "flex items-center justify-between gap-4 px-1 py-3 text-sm text-slate-400",
        className
      )}
    >
      {/* Item count */}
      <p aria-live="polite" aria-atomic="true">
        {totalItems === 0 ? (
          <span>No {itemLabel}</span>
        ) : (
          <span>
            <span className="font-semibold text-white">{start}–{end}</span>
            {" "}of{" "}
            <span className="font-semibold text-white">{totalItems.toLocaleString()}</span>
            {" "}{itemLabel}
          </span>
        )}
      </p>

      {/* Page controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrev}
          aria-label="Previous page"
          className={clsx(
            "rounded-lg p-2 transition-colors",
            canGoPrev
              ? "hover:bg-slate-800 text-slate-300"
              : "opacity-30 cursor-not-allowed text-slate-600"
          )}
        >
          <LucideChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <span className="min-w-[6rem] text-center text-xs">
          Page{" "}
          <span className="font-semibold text-white">{page}</span>
          {" "}of{" "}
          <span className="font-semibold text-white">{totalPages}</span>
        </span>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          aria-label="Next page"
          className={clsx(
            "rounded-lg p-2 transition-colors",
            canGoNext
              ? "hover:bg-slate-800 text-slate-300"
              : "opacity-30 cursor-not-allowed text-slate-600"
          )}
        >
          <LucideChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
