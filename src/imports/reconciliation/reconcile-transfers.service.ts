import "server-only";

import { db } from "@/lib/db";
import { TransferMatchStatus } from "@prisma/client";
import { findTransferMatchPairs, mergeTransferPair, type CandidateTransaction } from "./transfer-matching";

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

  // Windowed on createdAt (the real arrival timestamp), not `date` — `date`
  // is the midnight-truncated financialDate the ledger reports by, shared
  // by every transaction posted on the same calendar day, so it carries no
  // usable time-of-day signal for a same-day match window.
  const rows = await db.transaction.findMany({
    where: {
      userId,
      transferMatchStatus: TransferMatchStatus.UNMATCHED,
      createdAt: { gte: since },
    },
    select: { id: true, accountId: true, amount: true, createdAt: true, type: true, cashFlowDirection: true },
  });

  const candidates: CandidateTransaction[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    amount: r.amount,
    createdAt: r.createdAt,
    type: r.type,
    cashFlowDirection: r.cashFlowDirection,
  }));

  const pairs = findTransferMatchPairs(candidates);

  let matched = 0;
  for (const pair of pairs) {
    const merged = await mergeTransferPair(userId, pair.outflowId, pair.inflowId);
    if (merged) matched++;
  }

  return { matched, scanned: candidates.length };
}
