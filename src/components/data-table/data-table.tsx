"use client";

import React from "react";
import { LucideArrowUp, LucideArrowDown, LucideArrowUpDown, LucideLoader2 } from "lucide-react";
import type { DataTableProps, SortState } from "./types";
import { clsx } from "clsx";

const SKELETON_ROWS = 5;

/**
 * DataTable
 *
 * Generic, accessible table primitive. Feature modules supply column
 * definitions and data. The table handles:
 *   - Loading skeleton rows
 *   - Error state (inline)
 *   - Empty state (slot)
 *   - Stable column-header sort controls (aria-sort)
 *   - Column visibility
 *   - Accessible table semantics (scope="col", role="status" for live regions)
 *
 * Only the desktop table is rendered here. Mobile layouts use
 * ResponsiveRecordList and are rendered side-by-side with the table
 * using show/hide utilities.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  error,
  emptyState,
  sort,
  onSortChange,
  columnVisibility = {},
  className,
}: DataTableProps<TRow>) {
  const visibleColumns = columns.filter((col) => {
    const visible = columnVisibility[col.key];
    return visible === undefined ? (col.defaultVisible ?? true) : visible;
  });

  function handleSortClick(columnKey: string) {
    if (!onSortChange) return;
    const next: SortState =
      sort?.column === columnKey && sort.direction === "asc"
        ? { column: columnKey, direction: "desc" }
        : { column: columnKey, direction: "asc" };
    onSortChange(next);
  }

  function ariaSortFor(colKey: string): React.AriaAttributes["aria-sort"] {
    if (sort?.column !== colKey) return "none";
    return sort.direction === "asc" ? "ascending" : "descending";
  }

  return (
    <div className={clsx("overflow-x-auto rounded-2xl border border-slate-800", className)}>
      <table className="w-full text-left border-collapse text-sm" role="table">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={col.sortable ? ariaSortFor(col.key) : undefined}
                className={clsx(
                  "px-5 py-4 font-semibold text-xs uppercase tracking-wider whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.sortable && "cursor-pointer select-none hover:text-white transition-colors"
                )}
                onClick={col.sortable ? () => handleSortClick(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1.5">
                  {col.header}
                  {col.sortable && (
                    sort?.column === col.key ? (
                      sort.direction === "asc"
                        ? <LucideArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        : <LucideArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <LucideArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                    )
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {/* Error state */}
          {error && !isLoading && (
            <tr>
              <td
                colSpan={visibleColumns.length}
                className="px-5 py-12 text-center text-rose-400 text-sm"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </td>
            </tr>
          )}

          {/* Loading skeleton */}
          {isLoading && !error && (
            <>
              <tr aria-hidden="true">
                <td colSpan={visibleColumns.length} className="px-5 py-4">
                  <span className="sr-only" role="status" aria-live="polite">Loading data…</span>
                </td>
              </tr>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i} className="border-b border-slate-800/50 animate-pulse" aria-hidden="true">
                  {visibleColumns.map((col) => (
                    <td key={col.key} className="px-5 py-4">
                      <div className="h-4 bg-slate-800 rounded-md w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            </>
          )}

          {/* Empty state */}
          {!isLoading && !error && rows.length === 0 && (
            <tr>
              <td
                colSpan={visibleColumns.length}
                className="px-5 py-16 text-center"
                role="status"
                aria-live="polite"
              >
                {emptyState ?? (
                  <p className="text-slate-500 text-sm">No records found.</p>
                )}
              </td>
            </tr>
          )}

          {/* Data rows */}
          {!isLoading && !error && rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-slate-800/50 hover:bg-slate-900/30 transition-colors text-slate-300"
            >
              {visibleColumns.map((col) => (
                <td
                  key={col.key}
                  className={clsx(
                    "px-5 py-4",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center"
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Inline loading indicator when refreshing (not initial load) */}
      {isLoading && rows.length > 0 && (
        <div className="flex justify-center py-3 border-t border-slate-800" aria-live="polite">
          <LucideLoader2 className="h-4 w-4 animate-spin text-indigo-400" aria-label="Refreshing…" />
        </div>
      )}
    </div>
  );
}
