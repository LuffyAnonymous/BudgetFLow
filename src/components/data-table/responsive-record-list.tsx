"use client";

import React from "react";
import { clsx } from "clsx";

interface RecordField {
  label: string;
  value: React.ReactNode;
  /** Align value to the right (e.g. for amounts) */
  alignRight?: boolean;
}

interface RecordItem {
  id: string;
  /** Primary label — shown prominently at the top */
  title: React.ReactNode;
  /** Secondary label — shown below the title */
  subtitle?: React.ReactNode;
  /** Key-value pairs shown in the body */
  fields?: RecordField[];
  /** Badge or status indicator */
  badge?: React.ReactNode;
  /** Actions rendered in the footer */
  actions?: React.ReactNode;
}

interface ResponsiveRecordListProps {
  records: RecordItem[];
  isLoading?: boolean;
  error?: string | null;
  emptyState?: React.ReactNode;
  className?: string;
}

const SKELETON_CARDS = 4;

/**
 * ResponsiveRecordList
 *
 * Mobile-first fallback for DataTable. Renders each row as a card.
 * Feature modules define their own RecordItem shapes and map
 * domain objects to this interface at the usage site.
 *
 * Used together with DataTable: the table is hidden on small screens
 * and this list is hidden on large screens via Tailwind's responsive classes.
 */
export function ResponsiveRecordList({
  records,
  isLoading = false,
  error,
  emptyState,
  className,
}: ResponsiveRecordListProps) {
  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={clsx("py-8 text-center text-rose-400 text-sm", className)}
      >
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={clsx("space-y-3", className)} aria-live="polite" aria-label="Loading records…">
        <span className="sr-only">Loading…</span>
        {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-slate-800 bg-slate-900/30 p-4 space-y-3"
            aria-hidden="true"
          >
            <div className="h-4 bg-slate-800 rounded-md w-2/3" />
            <div className="h-3 bg-slate-800 rounded-md w-1/2" />
            <div className="h-3 bg-slate-800 rounded-md w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div
        className={clsx("py-16 text-center", className)}
        role="status"
        aria-live="polite"
      >
        {emptyState ?? <p className="text-slate-500 text-sm">No records found.</p>}
      </div>
    );
  }

  return (
    <ul className={clsx("space-y-3", className)} role="list" aria-label="Records">
      {records.map((record) => (
        <li
          key={record.id}
          className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4 space-y-3"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-white text-sm truncate">{record.title}</div>
              {record.subtitle && (
                <div className="text-xs text-slate-400 mt-0.5">{record.subtitle}</div>
              )}
            </div>
            {record.badge && <div className="flex-shrink-0">{record.badge}</div>}
          </div>

          {/* Fields */}
          {record.fields && record.fields.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {record.fields.map((field, idx) => (
                <React.Fragment key={idx}>
                  <dt className="text-slate-500 truncate">{field.label}</dt>
                  <dd className={clsx("text-slate-300 font-medium", field.alignRight && "text-right")}>
                    {field.value}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {/* Actions */}
          {record.actions && (
            <div className="flex gap-2 pt-1 border-t border-slate-800">
              {record.actions}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
