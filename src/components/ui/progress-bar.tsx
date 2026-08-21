import { clsx } from "clsx";
import type { Tone } from "@/components/ui/stat-tile";

const fillClass: Record<Tone, string> = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  indigo: "bg-indigo-500",
  amber: "bg-amber-500",
  slate: "bg-slate-500",
};

export function ProgressBar({
  value,
  max = 100,
  tone = "indigo",
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={clsx("h-2 w-full overflow-hidden rounded-full bg-slate-800", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx("h-full w-full origin-left rounded-full transition-transform duration-500 ease-out", fillClass[tone])}
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}
