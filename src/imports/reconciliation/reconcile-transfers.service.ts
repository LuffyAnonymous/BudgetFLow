import "server-only";

import { db } from "@/lib/db";
import { TransferMatchStatus } from "@prisma/client";
import { findTransferMatchPairs, mergeTransferPair, resolveNamedOutflow, OUTFLOW_TX_TYPE, type CandidateTransaction } from "./transfer-matching";

export interface ReconciliationResult {
  matched: number;
  scanned: number;
}

/**
 * Phase 2 of the two-phase transfer design. Scans this user's recent
 * UNMATCHED transactions (both legs of a real internal transfer arrive as
 * independent EXPENSE/INCOME rows at ingestion — see
 * import.service.ts's autoPostTransaction) and merges exact-amount,
 * different-account, opposite-direction pairs into one canonical TRANSFER
 * row. An unmatched leg past the window is left exactly as it was posted —
 * expected steady-state, not a failure mode; nothing flags it or blocks on
 * it. Safe to call repeatedly and concurrently for the same user (see
 * mergeTransferPair's race handling).
 */
export async function reconcileTransfers(
  userId: string,
  matchWindowMinutes = 45
): Promise<ReconciliationResult> {
  const since = new Date(Date.now() - matchWindowMinutes * 60 * 1000);

  // Windowed on occurredAt (the real event instant), not `date` (midnight-
  // truncated — no usable time-of-day signal) and not createdAt (DB
  // insert/processing time, which can lag badly behind the real event for
  // a backfilled/resynced import — see CandidateTransaction's doc comment).
  const rows = await db.transaction.findMany({
    where: {
      userId,
      transferMatchStatus: TransferMatchStatus.UNMATCHED,
      occurredAt: { gte: since },
    },
    select: { id: true, accountId: true, amount: true, occurredAt: true, date: true, type: true, cashFlowDirection: true },
  });

  const candidates: CandidateTransaction[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    amount: r.amount,
    // occurredAt is nullable only for rows that somehow predate both the
    // column and its migration backfill — shouldn't happen, but `date`
    // (same instant, just day-precision) is the correct fallback if it did.
    occurredAt: r.occurredAt ?? r.date,
    type: r.type,
    cashFlowDirection: r.cashFlowDirection,
  }));

  const pairs = findTransferMatchPairs(candidates);

  let matched = 0;
  const pairedIds = new Set<string>();
  for (const pair of pairs) {
    const merged = await mergeTransferPair(userId, pair.outflowId, pair.inflowId);
    if (merged) {
      matched++;
      pairedIds.add(pair.outflowId);
      pairedIds.add(pair.inflowId);
    }
  }

  // Deliberately UNBOUNDED, unlike the windowed query above: a wire/SWIFT
  // transfer whose receiving bank never sends its own confirmation has no
  // second leg to ever pair against, so it would otherwise sit as a plain
  // EXPENSE forever, past this run's window and every run after it —
  // resolveNamedOutflow resolves it from its own message text instead (see
  // its doc comment). This means every scheduled run also sweeps up
  // anything still stuck from before this fallback existed, not just
  // transactions from the last matchWindowMinutes.
  const unresolvedOutflows = await db.transaction.findMany({
    where: { userId, transferMatchStatus: TransferMatchStatus.UNMATCHED, type: OUTFLOW_TX_TYPE, cashFlowDirection: "OUTFLOW" },
    select: { id: true },
  });

  for (const outflow of unresolvedOutflows) {
    if (pairedIds.has(outflow.id)) continue;
    const resolved = await resolveNamedOutflow(userId, outflow.id);
    if (resolved) matched++;
  }

  return { matched, scanned: candidates.length };
}
