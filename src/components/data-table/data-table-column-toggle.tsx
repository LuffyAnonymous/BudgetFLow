"use client";

import React, { useState, useRef, useEffect } from "react";
import { LucideColumns, LucideChevronDown, LucideCheck } from "lucide-react";
import type { ColumnDef } from "./types";
import { clsx } from "clsx";

interface DataTableColumnToggleProps<TRow> {
  columns: ColumnDef<TRow>[];
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (key: string, visible: boolean) => void;
}

/**
 * DataTableColumnToggle
 *
 * Dropdown that lets users show/hide hideable columns.
 * Non-hideable columns are always shown and do not appear in this dropdown.
 * Focus is managed: dropdown is closed on outside-click and Escape key.
 */
export function DataTableColumnToggle<TRow>({
  columns,
  columnVisibility,
  onColumnVisibilityChange,
}: DataTableColumnToggleProps<TRow>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hideableColumns = columns.filter((c) => c.hideable !== false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (hideableColumns.length === 0) return null;

  function isVisible(col: ColumnDef<TRow>): boolean {
    const override = columnVisibility[col.key];
    return override === undefined ? (col.defaultVisible ?? true) : override;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Toggle column visibility"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium px-3 py-2 transition-colors"
      >
        <LucideColumns className="h-3.5 w-3.5" aria-hidden="true" />
        Columns
        <LucideChevronDown
          className={clsx("h-3 w-3 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Column visibility options"
          aria-multiselectable="true"
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-slate-800 bg-slate-900 shadow-xl py-1"
        >
          {hideableColumns.map((col) => {
            const visible = isVisible(col);
            return (
              <button
                key={col.key}
                role="option"
                aria-selected={visible}
                onClick={() => onColumnVisibilityChange(col.key, !visible)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
              >
                <span
                  className={clsx(
                    "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                    visible
                      ? "bg-indigo-600 border-indigo-600"
                      : "border-slate-600 bg-transparent"
                  )}
                  aria-hidden="true"
                >
                  {visible && <LucideCheck className="h-3 w-3 text-white" />}
                </span>
                {col.header}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
