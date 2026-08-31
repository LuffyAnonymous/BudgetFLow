"use client";

import { useState, type ReactNode } from "react";
import { LucideChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  /** Unique id — used to build the header/content aria wiring. */
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Rendered next to the title, e.g. a small connection-status pill — visible even when collapsed. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  /**
   * When this flips to true (e.g. a validation error just appeared inside
   * a collapsed section), the section expands so the error is visible.
   * Does not force it to stay open — the user can still collapse it again.
   */
  forceOpenSignal?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  description,
  icon,
  badge,
  defaultOpen = false,
  forceOpenSignal = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Expand when forceOpenSignal transitions to true (e.g. a validation error
  // just appeared inside a collapsed section) — set during render, per
  // React's documented pattern for adjusting state from a changed prop,
  // rather than in an effect (which would cause an extra render pass).
  const [lastForceOpenSignal, setLastForceOpenSignal] = useState(forceOpenSignal);
  if (forceOpenSignal !== lastForceOpenSignal) {
    setLastForceOpenSignal(forceOpenSignal);
    if (forceOpenSignal) setOpen(true);
  }

  const contentId = `${id}-content`;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-2xl p-6 text-left transition-colors hover:bg-slate-900/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {badge}
          </div>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        <LucideChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={contentId} className="border-t border-slate-800 px-6 pb-6 pt-6">
          {children}
        </div>
      )}
    </div>
  );
}

/** Small status pill for a CollapsibleSection's `badge` prop. */
export function SectionBadge({ tone, children }: { tone: "emerald" | "amber" | "slate"; children: ReactNode }) {
  const toneClasses =
    tone === "emerald"
      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
      : tone === "amber"
        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
        : "bg-slate-500/10 border-slate-700 text-slate-400";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${toneClasses}`}
    >
      {children}
    </span>
  );
}
