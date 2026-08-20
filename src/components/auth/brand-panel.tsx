import { ProductCarousel } from "@/components/auth/product-carousel";

export function BrandPanel() {
  return (
    <div className="relative hidden w-full flex-col overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-950 to-cyan-950 p-12 lg:flex lg:w-[70%] lg:px-20 xl:px-28">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-lg shadow-indigo-500/25">
          <span className="text-lg font-bold text-white">B</span>
        </div>
        <span className="text-lg font-bold tracking-tight text-white">
          BudgetFlow
        </span>
      </div>

      <div className="relative mt-10 shrink-0">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white">
          Your bank texts you.
          <br />
          BudgetFlow reads it.
        </h1>
        <p className="mt-4 max-w-sm text-base text-slate-400">
          Every card swipe, BNPL split, and salary deposit gets logged and
          categorized on its own — no receipts to type in, no spreadsheet
          to keep up to date.
        </p>
      </div>

      <div className="relative mt-6 flex shrink-0 items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
          Live preview
        </span>
        <span className="text-xs text-slate-500">— cycling through your dashboard</span>
      </div>

      <ProductCarousel className="relative mt-4 min-h-[280px] flex-1" />
    </div>
  );
}
