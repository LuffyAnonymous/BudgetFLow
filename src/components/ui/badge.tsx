import { clsx } from "clsx";
import type { Tone } from "@/components/ui/stat-tile";

const toneClass: Record<Tone, string> = {
  emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  rose: "border-rose-500/20 bg-rose-500/10 text-rose-400",
  indigo: "border-indigo-500/20 bg-indigo-500/10 text-indigo-400",
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  slate: "border-slate-700 bg-slate-800 text-slate-300",
};

export function Badge({
  tone = "slate",
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        toneClass[tone],
        pulse && "animate-pulse",
        className
      )}
    >
      {children}
    </span>
  );
}
