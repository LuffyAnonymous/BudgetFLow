"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CollapsibleSection, SectionBadge } from "@/components/shared/collapsible-section";
import {
  LucideLandmark,
  LucideWallet,
  LucideCreditCard,
  LucideSmartphone,
  LucideCircleCheck,
  LucideCircleAlert,
  LucideClock,
  LucideStar,
  LucideWrench,
  LucideArrowRight,
  type LucideIcon,
} from "lucide-react";

interface TransferRepairLeg {
  institution: string;
  amount: string | null;
  description: string | null;
  receivedAt: string;
}

interface TransferRepairCandidate {
  transactionId: string;
  date: string;
  amount: string;
  description: string;
  currentAccountName: string | null;
  currentToAccountName: string | null;
  legs: TransferRepairLeg[];
  status: "FIXABLE" | "WRONG_LEG_COUNT" | "ACCOUNT_NOT_FOUND" | "AMBIGUOUS";
  detail: string;
  resolvedAccountName: string | null;
  resolvedToAccountName: string | null;
}

interface AccountItem {
  id: string;
  type: string;
  name: string;
  isCreditCard: boolean;
  isPrimary: boolean;
  currentBalance: string;
  latestImportedBalance: string | null;
  lastSMSImported: string | null;
  lastSuccessfulSync: string | null;
  reconciliationStatus: "MATCHED" | "CACHE_MISMATCH" | "BANK_BALANCE_DIFFERENCE" | "REVIEW_REQUIRED";
  cacheDifference: string;
  bankDifference: string | null;
}

// BNPL balances and credit card balances are both money owed, not money the
// user has to spend — kept out of the "Total Available Money" headline so
// that figure stays trustworthy as an actual spendable-cash number.
const BNPL_TYPES = new Set(["TABBY", "TAMARA"]);
function isOwedAccount(a: AccountItem): boolean {
  return BNPL_TYPES.has(a.type) || a.isCreditCard;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  CASH: LucideWallet,
  BOTIM: LucideSmartphone,
  TABBY: LucideCreditCard,
  TAMARA: LucideCreditCard,
};

const TYPE_LABEL: Record<string, string> = {
  CASH: "Cash",
  BOTIM: "Wallet",
  TABBY: "Buy Now Pay Later",
  TAMARA: "Buy Now Pay Later",
  OTHER_BANK: "Bank",
};

function iconFor(a: AccountItem): LucideIcon {
  if (a.isCreditCard) return LucideCreditCard;
  return TYPE_ICON[a.type] ?? LucideLandmark;
}

function labelFor(a: AccountItem): string {
  if (a.isCreditCard) return "Credit Card";
  return TYPE_LABEL[a.type] ?? "Bank";
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Synced ${days}d ago`;
  return `Synced ${new Date(iso).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", month: "short", day: "numeric" })}`;
}

function formatAED(value: string): string {
  const n = parseFloat(value);
  return `AED ${n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountsClient() {
  const queryClient = useQueryClient();
  const [primaryError, setPrimaryError] = useState("");

  const { data: accounts = [], isLoading } = useQuery<AccountItem[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      return json.data || [];
    },
    refetchInterval: 2 * 60 * 1000,
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to set primary account");
      }
      return json.data as AccountItem[];
    },
    onMutate: async (accountId) => {
      setPrimaryError("");
      await queryClient.cancelQueries({ queryKey: ["accounts"] });
      const previous = queryClient.getQueryData<AccountItem[]>(["accounts"]);
      queryClient.setQueryData<AccountItem[]>(["accounts"], (old) =>
        (old ?? []).map((a) => ({ ...a, isPrimary: a.id === accountId }))
      );
      return { previous };
    },
    onError: (err: Error, _accountId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["accounts"], context.previous);
      }
      setPrimaryError(err.message);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["accounts"], data);
    },
  });

  const { data: repairCandidates = [] } = useQuery<TransferRepairCandidate[]>({
    queryKey: ["transfer-repair"],
    queryFn: async () => {
      const res = await fetch("/api/accounts/transfer-repair");
      const json = await res.json();
      return json.data || [];
    },
  });

  const [selectedRepairIds, setSelectedRepairIds] = useState<Set<string>>(new Set());
  const [repairResultSummary, setRepairResultSummary] = useState<{ repaired: number; skipped: number } | null>(null);

  const repairMutation = useMutation({
    mutationFn: async (transactionIds: string[]) => {
      const res = await fetch("/api/accounts/transfer-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Repair failed");
      return json.data as { repaired: string[]; skipped: { transactionId: string; reason: string }[] };
    },
    onSuccess: (data) => {
      setRepairResultSummary({ repaired: data.repaired.length, skipped: data.skipped.length });
      setSelectedRepairIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["transfer-repair"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const fixableCandidates = repairCandidates.filter((c) => c.status === "FIXABLE");

  const toggleRepairSelection = (transactionId: string) => {
    setSelectedRepairIds((prev) => {
      const next = new Set(prev);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });
  };

  const spendable = accounts.filter((a) => !isOwedAccount(a));
  const owed = accounts.filter(isOwedAccount);

  const totalAvailable = spendable.reduce((sum, a) => sum + parseFloat(a.currentBalance), 0);
  // Charges (OUTFLOW) push a BNPL or credit card balance negative as
  // installments/purchases accumulate; a negative balance is what's owed, so
  // flip the sign to show it as a positive amount. Any positive balance
  // means nothing is owed.
  const totalOwed = owed.reduce((sum, a) => sum + Math.max(0, -parseFloat(a.currentBalance)), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 text-slate-100">
      <PageHeader
        title="Accounts"
        description="Live balances across every bank, wallet, credit card, and BNPL app your SMS imports keep in sync — no manual entry, no laptop dependency."
      />

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading accounts...</div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={LucideLandmark}
          title="No accounts yet"
          description="Accounts appear automatically the first time a bank, wallet, or BNPL SMS is imported."
        />
      ) : (
        <>
          {/* Summary: asymmetric hero + secondary stat, not a repeated 3-card grid */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-slate-900/40 to-slate-900/40 p-6">
              <p className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-semibold">Total Available Money</p>
              <p className="mt-2 text-4xl font-bold text-white tabular-nums tracking-tight">
                {formatAED(totalAvailable.toFixed(2))}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Across {spendable.length} {spendable.length === 1 ? "account" : "accounts"} — updated the moment each bank or wallet SMS arrives.
              </p>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6">
              <p className="text-[10px] uppercase tracking-wider text-rose-300/80 font-semibold">Money You Owe</p>
              <p className="mt-2 text-2xl font-bold text-rose-300 tabular-nums tracking-tight">
                {formatAED(totalOwed.toFixed(2))}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {owed.length === 0 ? "No BNPL or credit card activity yet." : "Owed to Tabby, Tamara, or a credit card — not counted as spendable money."}
              </p>
            </div>
          </div>

          {primaryError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
              <LucideCircleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {primaryError}
            </div>
          )}

          {repairCandidates.length > 0 && (
            <CollapsibleSection
              id="transfer-repair"
              title="Transfer Link Issues Found"
              description="A transfer between two of your own accounts didn't fully link — the amount is still counted, but the destination side needs a one-time fix."
              icon={<LucideWrench className="h-5 w-5 text-amber-400" aria-hidden="true" />}
              badge={<SectionBadge tone="amber">{repairCandidates.length} found</SectionBadge>}
              defaultOpen
            >
              <div className="space-y-3">
                {repairResultSummary && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                    <LucideCircleCheck className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    Repaired {repairResultSummary.repaired}
                    {repairResultSummary.skipped > 0 ? `, skipped ${repairResultSummary.skipped} (see below)` : ""}.
                  </div>
                )}
                {repairMutation.error && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
                    <LucideCircleAlert className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {(repairMutation.error as Error).message}
                  </div>
                )}

                {repairCandidates.map((c) => (
                  <div key={c.transactionId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {c.status === "FIXABLE" && (
                          <input
                            type="checkbox"
                            checked={selectedRepairIds.has(c.transactionId)}
                            onChange={() => toggleRepairSelection(c.transactionId)}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                            aria-label={`Select transfer from ${new Date(c.date).toLocaleDateString()} for repair`}
                          />
                        )}
                        <span className="text-sm font-semibold text-white">{formatAED(c.amount)}</span>
                        <span className="text-xs text-slate-500">
                          {new Date(c.date).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      </div>
                      <SectionBadge tone={c.status === "FIXABLE" ? "emerald" : "amber"}>
                        {c.status === "FIXABLE" ? "Fixable" : "Needs review"}
                      </SectionBadge>
                    </div>

                    {c.status === "FIXABLE" ? (
                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <span>{c.resolvedAccountName}</span>
                        <LucideArrowRight className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                        <span>{c.resolvedToAccountName}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-300/90">{c.detail}</p>
                    )}

                    <div className="space-y-1 border-t border-slate-800 pt-2">
                      {c.legs.map((leg, i) => (
                        <p key={i} className="text-[11px] text-slate-500">
                          {leg.institution} — {leg.amount ? formatAED(leg.amount) : "?"} — &quot;{leg.description || "no description"}&quot;
                        </p>
                      ))}
                    </div>
                  </div>
                ))}

                {fixableCandidates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => repairMutation.mutate(Array.from(selectedRepairIds))}
                    disabled={selectedRepairIds.size === 0 || repairMutation.isPending}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <LucideWrench className="h-3.5 w-3.5" aria-hidden="true" />
                    {repairMutation.isPending
                      ? "Repairing..."
                      : `Repair Selected (${selectedRepairIds.size})`}
                  </button>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Per-institution cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((acc) => {
              const Icon = iconFor(acc);
              const hasSynced = !!acc.lastSMSImported;
              const isSynced = hasSynced && acc.reconciliationStatus === "MATCHED";
              const hasDiscrepancy = acc.reconciliationStatus === "BANK_BALANCE_DIFFERENCE" && acc.bankDifference && parseFloat(acc.bankDifference) !== 0;

              return (
                <div key={acc.id} className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800/60">
                        <Icon className="h-5 w-5 text-slate-300" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-white text-sm truncate">{acc.name}</h3>
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">{labelFor(acc)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => !acc.isPrimary && setPrimaryMutation.mutate(acc.id)}
                      disabled={acc.isPrimary || setPrimaryMutation.isPending}
                      title={acc.isPrimary ? "Your main account" : "Set as main account"}
                      aria-label={acc.isPrimary ? "Main account" : "Set as main account"}
                      aria-pressed={acc.isPrimary}
                      className="shrink-0 rounded-lg p-1.5 text-slate-600 transition-colors hover:text-indigo-400 disabled:cursor-default disabled:hover:text-slate-600"
                    >
                      <LucideStar
                        className={acc.isPrimary ? "h-4 w-4 text-indigo-400" : "h-4 w-4"}
                        fill={acc.isPrimary ? "currentColor" : "none"}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  <p className="text-2xl font-bold text-white tabular-nums tracking-tight">
                    {formatAED(acc.currentBalance)}
                  </p>

                  <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <LucideClock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatRelativeTime(acc.lastSMSImported)}
                    </span>
                    {!hasSynced ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">No activity yet</span>
                    ) : isSynced ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                        <LucideCircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-400" title={hasDiscrepancy ? `Bank reports a difference of ${formatAED(acc.bankDifference!)}` : "Recalculating from the ledger"}>
                        <LucideCircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {hasDiscrepancy ? "Differs from bank" : "Recalculating"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
