import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-900/40",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  icon,
  title,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between border-b border-slate-800 pb-3", className)}>
      <h3 className="flex items-center gap-2 text-base font-bold text-white">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}
