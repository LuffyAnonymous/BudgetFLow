"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LucideChevronLeft, LucideChevronRight } from "lucide-react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useCountUp(target: number, duration = 1400) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (prefersReducedMotion()) return;

    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function useEntrance(delay = 200) {
  const [active, setActive] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return active;
}

function formatAED(n: number) {
  return `AED ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function SlideHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 shrink-0">
      <h3 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h3>
      <p className="mt-1 text-xs text-slate-400 sm:text-sm">{subtitle}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "indigo" | "cyan";
}) {
  const toneClass = {
    emerald: "text-emerald-400",
    indigo: "text-indigo-300",
    cyan: "text-cyan-300",
  }[tone];

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <p className="text-[9px] font-semibold uppercase leading-tight tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-1.5 text-base font-bold tabular-nums sm:text-lg ${toneClass}`}>{value}</p>
    </div>
  );
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-rose-500/30 bg-rose-500/10 text-rose-400"
      }`}
    >
      {children}
    </span>
  );
}

function DashboardSlide() {
  const cashFlow = useCountUp(2480);
  const savings = useCountUp(6150);
  const food = useCountUp(75);

  return (
    <>
      <SlideHeader
        title="Financial Overview"
        subtitle="Here is your financial status for the selected month."
      />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Remaining Cash Flow" value={formatAED(cashFlow)} tone="emerald" />
        <StatCard label="Total Savings" value={formatAED(savings)} tone="indigo" />
        <StatCard label="Daily Food Allowance" value={formatAED(food)} tone="cyan" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            Financial Health
          </p>
          <p className="text-sm font-bold text-amber-400">Fair</p>
        </div>
        <p className="text-right text-xs text-slate-400">
          Net cash flow <span className="font-semibold text-emerald-400">+AED 1,240</span>
        </p>
      </div>
    </>
  );
}

const budgetRows = [
  { category: "Dining", group: "FOOD", planned: 800, spent: 540, ok: true },
  { category: "Groceries", group: "FOOD", planned: 1200, spent: 980, ok: true },
  { category: "Recreation", group: "VARIABLE", planned: 400, spent: 410, ok: false },
  { category: "Debt Payment", group: "DEBT", planned: 650, spent: 650, ok: true },
];

function BudgetsSlide() {
  return (
    <>
      <SlideHeader
        title="Monthly Budgets"
        subtitle="Allocate planned caps and track your actual outlays by category."
      />
      <div className="overflow-hidden rounded-xl border border-white/5">
        <div className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr] gap-2 border-b border-white/5 bg-white/[0.02] px-3 py-2 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
          <span>Category</span>
          <span className="text-right">Planned</span>
          <span className="text-right">Spent</span>
          <span className="text-right">Status</span>
        </div>
        {budgetRows.map((row) => (
          <div
            key={row.category}
            className="grid grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr] items-center gap-2 border-b border-white/5 px-3 py-2.5 last:border-b-0"
          >
            <div>
              <p className="text-xs font-semibold text-white sm:text-sm">{row.category}</p>
              <p className="text-[9px] uppercase tracking-wide text-slate-500">{row.group}</p>
            </div>
            <p className="text-right text-xs text-slate-300 tabular-nums">AED {row.planned}</p>
            <p className="text-right text-xs text-slate-300 tabular-nums">AED {row.spent}</p>
            <div className="flex justify-end">
              <StatusPill ok={row.ok}>{row.ok ? "On Track" : "Over"}</StatusPill>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function GoalBar({
  label,
  current,
  target,
  delay,
}: {
  label: string;
  current: number;
  target: number;
  delay: number;
}) {
  const active = useEntrance(delay);
  const pct = Math.round((current / target) * 100);

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white">{label}</span>
        <span className="text-slate-400 tabular-nums">
          AED {current.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-1000 ease-out"
          style={{ width: active ? `${pct}%` : "0%" }}
        />
      </div>
      <p className="mt-1.5 text-right text-[10px] font-semibold text-indigo-300">{pct}%</p>
    </div>
  );
}

function SavingsSlide() {
  return (
    <>
      <SlideHeader
        title="Savings Goals"
        subtitle="Track your savings progress, make deposits, and record withdrawals."
      />
      <div className="space-y-3">
        <GoalBar label="Emergency Fund" current={6200} target={10000} delay={200} />
        <GoalBar label="New Laptop" current={1200} target={4000} delay={350} />
      </div>
    </>
  );
}

function DebtSlide() {
  const active = useEntrance(200);
  const paidPct = 42;

  return (
    <>
      <SlideHeader
        title="Debt Tracker"
        subtitle="Monitor outstanding debt balances, record payments, and view payoff projections."
      />
      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Credit Card — Emirates NBD</p>
            <p className="text-[9px] uppercase tracking-wide text-slate-500">Balance remaining</p>
          </div>
          <StatusPill ok>On Track</StatusPill>
        </div>
        <p className="mt-2 text-2xl font-bold text-rose-400 tabular-nums">AED 3,200</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400 transition-[width] duration-1000 ease-out"
            style={{ width: active ? `${paidPct}%` : "0%" }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
          <span>{paidPct}% paid off</span>
          <span>AED 400/mo · 8 months left</span>
        </div>
      </div>
    </>
  );
}

function MiniBar({
  show,
  targetPx,
  colorClass,
  label,
}: {
  show: boolean;
  targetPx: number;
  colorClass: string;
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <div className="flex h-16 w-full items-end justify-center">
        <div
          className={`w-6 rounded-t-md ${colorClass} transition-[height] duration-700 ease-out`}
          style={{ height: show ? `${targetPx}px` : "0px" }}
        />
      </div>
      <span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

function ReportsSlide() {
  const active = useEntrance(200);

  return (
    <>
      <SlideHeader
        title="Financial Reports"
        subtitle="Analyze your income, outgoings, budget progress, debts, and PHP remittances."
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Income vs Outgoings
          </p>
          <div className="mt-3 flex items-end gap-4 border-b border-white/10 pb-2">
            <MiniBar
              show={active}
              targetPx={64}
              colorClass="bg-gradient-to-t from-emerald-500 to-emerald-400"
              label="Income"
            />
            <MiniBar
              show={active}
              targetPx={44}
              colorClass="bg-gradient-to-t from-rose-500 to-rose-400"
              label="Out"
            />
          </div>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Spending by Category
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-16 w-16 shrink-0 rounded-full transition-[background] duration-700"
              style={{
                background: active
                  ? "conic-gradient(#34d399 0% 38%, #818cf8 38% 63%, #22d3ee 63% 85%, #475569 85% 100%)"
                  : "conic-gradient(#475569 0% 100%)",
              }}
            >
              <div className="m-[6px] h-[52px] w-[52px] rounded-full bg-slate-900" />
            </div>
            <ul className="space-y-1 text-[10px] text-slate-400">
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Food
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                Bills
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                Transport
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                Other
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

const SLIDES = [
  { title: "Financial Overview", Slide: DashboardSlide },
  { title: "Monthly Budgets", Slide: BudgetsSlide },
  { title: "Savings Goals", Slide: SavingsSlide },
  { title: "Debt Tracker", Slide: DebtSlide },
  { title: "Financial Reports", Slide: ReportsSlide },
];

export function ProductCarousel({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (reducedMotion || paused) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), 2000);
    return () => clearTimeout(t);
  }, [index, paused, reducedMotion]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const goTo = (i: number) => setIndex((i + SLIDES.length) % SLIDES.length);

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-black/40 backdrop-blur-sm ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {SLIDES.map(({ Slide }, i) => (
        <div
          key={i}
          className={`absolute inset-0 flex flex-col p-5 pb-10 transition-opacity duration-500 ease-in-out sm:p-6 sm:pb-10 ${
            i === index ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={i !== index}
        >
          <Slide />
        </div>
      ))}

      <button
        type="button"
        onClick={() => goTo(index - 1)}
        aria-label="Previous screen"
        className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 p-1.5 text-slate-300 opacity-0 transition-opacity duration-200 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <LucideChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => goTo(index + 1)}
        aria-label="Next screen"
        className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 p-1.5 text-slate-300 opacity-0 transition-opacity duration-200 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <LucideChevronRight className="h-4 w-4" />
      </button>

      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-1.5">
        {SLIDES.map(({ title }, i) => (
          <button
            key={title}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${title}`}
            aria-current={i === index}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index
                ? "w-6 bg-gradient-to-r from-indigo-400 to-cyan-400"
                : "w-1.5 bg-white/25 hover:bg-white/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
