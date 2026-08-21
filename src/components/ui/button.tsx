import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500",
  secondary: "border border-slate-800 bg-slate-900/50 text-slate-300 hover:bg-slate-800",
  danger: "bg-rose-600 text-white shadow-md shadow-rose-600/20 hover:bg-rose-500",
  ghost: "text-indigo-400 hover:text-indigo-300",
};

const sizeClass: Record<Size, string> = {
  sm: "rounded-lg px-2.5 py-1 text-[10px] font-bold",
  md: "rounded-xl px-5 py-2.5 text-sm font-semibold",
};

export function buttonVariants({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
    variantClass[variant],
    sizeClass[size],
    className
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}
