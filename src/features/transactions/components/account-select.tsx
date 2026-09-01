"use client";

import { useQuery } from "@tanstack/react-query";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  currentBalance: string;
}

/**
 * Account picker for the manual transaction form — replaces the old
 * free-text Payment Method input. Built from the signed-in user's real
 * Account rows (GET /api/accounts), so a new bank connected in Settings
 * shows up here automatically with zero code changes. "Cash" is always
 * labeled that way regardless of what the account's own `name` happens to
 * be; every other account uses its own name as-is.
 */
export function AccountSelect({
  id,
  value,
  onChange,
  enabled,
}: {
  id: string;
  value: string;
  onChange: (accountId: string) => void;
  enabled: boolean;
}) {
  const { data: accounts = [], isLoading } = useQuery<AccountOption[]>({
    queryKey: ["accounts", "select"],
    queryFn: async () => {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      return json.data || [];
    },
    enabled,
  });

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-50"
    >
      <option value="">{isLoading ? "Loading accounts…" : "Select account"}</option>
      {accounts.map((acc) => (
        <option key={acc.id} value={acc.id}>
          {acc.type === "CASH" ? "Cash" : acc.name} (AED {acc.currentBalance})
        </option>
      ))}
    </select>
  );
}
