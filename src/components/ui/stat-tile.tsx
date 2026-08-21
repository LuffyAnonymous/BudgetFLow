import { clsx } from "clsx";
import { Card } from "@/components/ui/card";

export type Tone = "emerald" | "rose" | "indigo" | "amber" | "slate";

const toneText: Record<Tone, string> = {
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  indigo: "text-indigo-400",
  amber: "text-amber-400",
  slate: "text-slate-200",
};

const toneChip: Record<Tone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400",
  rose: "bg-rose-500/10 text-rose-400",
  indigo: "bg-indigo-500/10 text-indigo-400",
  amber: "bg-amber-500/10 text-amber-400",
  slate: "bg-slate-800 text-slate-300",
};

export function StatTile({
  label,
  value,
  caption,
  tone = "slate",
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={clsx("p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
          <p className={clsx("mt-3 text-3xl font-bold tracking-tight tabular-nums", toneText[tone])}>
            {value}
          </p>
        </div>
        {icon && (
          <span className={clsx("shrink-0 rounded-lg p-2", toneChip[tone])} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      {caption && <p className="mt-2 text-xs text-slate-500">{caption}</p>}
    </Card>
  );
}
