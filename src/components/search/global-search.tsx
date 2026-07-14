"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LucideSearch,
  LucideX,
  LucideArrowRight,
  LucideReceipt,
  LucideTarget,
  LucideCreditCard,
  LucidePiggyBank,
  LucideSend,
  LucideTag,
  LucideRepeat,
} from "lucide-react";

type SearchResultItem = {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

type SearchResults = {
  transactions?: { id: string; description: string; amount: number | null; date: string; category: { name: string } }[];
  budgets?: { id: string; month: string; amount: number | null; category: { name: string } }[];
  debts?: { id: string; name: string; currentBalance: number | null; status: string }[];
  savings?: { id: string; name: string; targetAmount: number | null; currentAmount: number | null; status: string }[];
  remittances?: { id: string; recipient: string; amountSentAed: number | null; status: string; transferDate: string }[];
  categories?: { id: string; name: string; type: string }[];
  recurringTemplates?: { id: string; name: string; notes?: string | null; amount: number | null }[];
};

type Group = {
  label: string;
  icon: React.ReactNode;
  items: SearchResultItem[];
};

function formatAED(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  return `AED ${amount.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildGroups(results: SearchResults): Group[] {
  const groups: Group[] = [];

  if (results.transactions?.length) {
    groups.push({
      label: "Transactions",
      icon: <LucideReceipt className="h-4 w-4" />,
      items: results.transactions.map((t) => ({
        id: t.id,
        label: t.description,
        sublabel: `${t.category.name} · ${formatAED(t.amount)} · ${new Date(t.date).toLocaleDateString()}`,
        href: `/transactions?highlight=${t.id}`,
      })),
    });
  }

  if (results.budgets?.length) {
    groups.push({
      label: "Budgets",
      icon: <LucideTarget className="h-4 w-4" />,
      items: results.budgets.map((b) => ({
        id: b.id,
        label: b.category.name,
        sublabel: `${b.month} · ${formatAED(b.amount)}`,
        href: `/budgets`,
      })),
    });
  }

  if (results.debts?.length) {
    groups.push({
      label: "Debts",
      icon: <LucideCreditCard className="h-4 w-4" />,
      items: results.debts.map((d) => ({
        id: d.id,
        label: d.name,
        sublabel: `Balance: ${formatAED(d.currentBalance)} · ${d.status}`,
        href: `/debts`,
      })),
    });
  }

  if (results.savings?.length) {
    groups.push({
      label: "Savings",
      icon: <LucidePiggyBank className="h-4 w-4" />,
      items: results.savings.map((s) => ({
        id: s.id,
        label: s.name,
        sublabel: `${formatAED(s.currentAmount)} / ${formatAED(s.targetAmount)} · ${s.status}`,
        href: `/savings`,
      })),
    });
  }

  if (results.remittances?.length) {
    groups.push({
      label: "Remittances",
      icon: <LucideSend className="h-4 w-4" />,
      items: results.remittances.map((r) => ({
        id: r.id,
        label: r.recipient,
        sublabel: `${formatAED(r.amountSentAed)} · ${r.status} · ${new Date(r.transferDate).toLocaleDateString()}`,
        href: `/remittances`,
      })),
    });
  }

  if (results.categories?.length) {
    groups.push({
      label: "Categories",
      icon: <LucideTag className="h-4 w-4" />,
      items: results.categories.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.type,
        href: `/categories`,
      })),
    });
  }

  if (results.recurringTemplates?.length) {
    groups.push({
      label: "Recurring",
      icon: <LucideRepeat className="h-4 w-4" />,
      items: results.recurringTemplates.map((rt) => ({
        id: rt.id,
        label: rt.name,
        sublabel: rt.notes ?? (rt.amount !== null ? formatAED(rt.amount) : undefined),
        href: `/recurring`,
      })),
    });
  }

  return groups;
}

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({});
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = buildGroups(results);
  const allItems = groups.flatMap((g) => g.items);

  const openModal = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setResults({});
    setActiveIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults({});
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          closeModal();
        } else {
          openModal();
        }
      }
      if (e.key === "Escape" && isOpen) {
        closeModal();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, openModal, closeModal]);

  // Debounced search — all setState calls are inside async setTimeout callbacks,
  // never in the synchronous effect body, to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!query || query.length < 2) {
        setResults({});
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? {});
          setActiveIndex(0);
        }
      } finally {
        setLoading(false);
      }
    }, query.length < 2 ? 0 : 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);


  // Keyboard navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && allItems[activeIndex]) {
      router.push(allItems[activeIndex].href);
      closeModal();
    }
  };

  return (
    <>
      {/* Trigger button */}
      <button
        id="global-search-trigger"
        onClick={openModal}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
        title="Search (⌘K)"
      >
        <LucideSearch className="h-4 w-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden rounded bg-slate-700 px-1 text-xs text-slate-500 sm:inline">⌘K</kbd>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[10vh]"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onKeyDown={handleKeyDown}
          >
            {/* Search Input Row */}
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
              <LucideSearch className="h-5 w-5 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                id="global-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transactions, debts, savings…"
                className="flex-1 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm"
              />
              {loading && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
              )}
              <button onClick={closeModal} className="text-slate-500 hover:text-slate-300">
                <LucideX className="h-4 w-4" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {query.length >= 2 && !loading && groups.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">
                  No results for &quot;{query}&quot;
                </p>
              )}

              {query.length < 2 && (
                <p className="py-6 text-center text-sm text-slate-600">
                  Type at least 2 characters to search
                </p>
              )}

              {groups.map((group) => {
                const groupOffset = allItems.indexOf(group.items[0]);
                return (
                  <div key={group.label} className="mb-2">
                    <div className="flex items-center gap-2 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {group.icon}
                      {group.label}
                    </div>
                    {group.items.map((item, idx) => {
                      const globalIdx = groupOffset + idx;
                      const isActive = globalIdx === activeIndex;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            router.push(item.href);
                            closeModal();
                          }}
                          onMouseEnter={() => setActiveIndex(globalIdx)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                            isActive ? "bg-slate-800" : "hover:bg-slate-800/50"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-200">
                              {item.label}
                            </p>
                            {item.sublabel && (
                              <p className="truncate text-xs text-slate-500">{item.sublabel}</p>
                            )}
                          </div>
                          {isActive && (
                            <LucideArrowRight className="h-4 w-4 shrink-0 text-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2 text-xs text-slate-600">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
