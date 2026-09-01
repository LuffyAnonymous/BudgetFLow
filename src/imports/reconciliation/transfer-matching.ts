// Deliberately no "import server-only" here — this module is shared with
// scripts/repair-half-linked-transfers.ts, a plain Node CLI script with no
// Next.js server context, and that guard would break it (see Step 6 report
// in the transfer-reconciliation rebuild for the concrete failure this
// caused before the import was removed).
import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, TransactionType, TransferMatchStatus, Prisma } from "@prisma/client";
import { accountService } from "@/server/services/account.service";
import { AuditLogService } from "@/server/services/audit-log.service";
import { matchAccountByDescription } from "../engine/account-name-matcher";
import { Decimal } from "decimal.js";

/**
 * src/imports/reconciliation/transfer-matching.ts
 *
 * Phase 2 of the two-phase transfer design (see import.service.ts's
 * autoPostTransaction doc comment for Phase 1): the pure pairing algorithm
 * and the actual DB merge, shared by both reconcile-transfers.service.ts
 * (a bounded recent window, run on a schedule) and
 * scripts/repair-half-linked-transfers.ts (an unbounded historical
 * backfill) — so the two never drift apart the way the pre-rebuild
 * ingestion-time matcher and the repair tool eventually would have.
 */

export const OUTFLOW_TX_TYPE = TransactionType.EXPENSE;
export const INFLOW_TX_TYPE = TransactionType.INCOME;

export interface CandidateTransaction {
  id: string;
  accountId: string | null;
  amount: Decimal;
  /// The real-world event instant (Transaction.occurredAt), not createdAt
  /// (DB insert/processing time) — a backfilled/resynced import can process
  /// two real legs of the same transfer in whatever order Gmail happens to
  /// return matching messages, which has no relationship to when those
  /// legs actually happened. occurredAt does.
  occurredAt: Date;
  type: TransactionType;
  cashFlowDirection: "OUTFLOW" | "INFLOW" | null;
}

export interface TransferMatchPair {
  outflowId: string;
  inflowId: string;
}

/**
 * Greedy pairing: for each outflow (oldest first), the closest-in-time
 * unclaimed inflow with the exact same amount and a different account
 * becomes its match. Amount matching is exact only — no tolerance, no
 * fuzzy matching, per the non-negotiable this whole design is built on.
 * Pure function — no DB access, so it's cheap to unit test exhaustively.
 */
export function findTransferMatchPairs(candidates: CandidateTransaction[]): TransferMatchPair[] {
  const outflows = candidates
    .filter((c) => c.type === OUTFLOW_TX_TYPE && c.cashFlowDirection === "OUTFLOW" && c.accountId)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const inflows = candidates.filter(
    (c) => c.type === INFLOW_TX_TYPE && c.cashFlowDirection === "INFLOW" && c.accountId
  );

  const claimedInflowIds = new Set<string>();
  const pairs: TransferMatchPair[] = [];

  for (const outflow of outflows) {
    let best: CandidateTransaction | null = null;
    let bestDeltaMs = Infinity;

    for (const inflow of inflows) {
      if (claimedInflowIds.has(inflow.id)) continue;
      if (inflow.accountId === outflow.accountId) continue;
      if (!inflow.amount.equals(outflow.amount)) continue;

      const deltaMs = Math.abs(inflow.occurredAt.getTime() - outflow.occurredAt.getTime());
      if (deltaMs < bestDeltaMs) {
        bestDeltaMs = deltaMs;
        best = inflow;
      }
    }

    if (best) {
      claimedInflowIds.add(best.id);
      pairs.push({ outflowId: outflow.id, inflowId: best.id });
    }
  }

  return pairs;
}

const RACE_LOST = "RACE_LOST" as const;

/**
 * Merges one matched pair inside a single Prisma transaction:
 *   - Re-checks both rows are still UNMATCHED via a conditional updateMany
 *     (0 rows affected = someone else already claimed it) — safe under
 *     concurrent/overlapping reconciliation runs without needing explicit
 *     row locks.
 *   - Outflow becomes the canonical TRANSFER row (type + toAccountId).
 *   - Inflow is marked MERGED (mergedIntoTransactionId), never deleted —
 *     its own ImportedTransaction links and history stay intact.
 *   - Both accounts' cached balances are recomputed from the ledger, which
 *     now excludes MERGED rows (see account.service.ts's computeLedgerBalance).
 *   - Two AuditLog rows (before/after) — one per leg.
 * Returns true if the merge happened, false if it lost the race (the pair
 * is simply skipped, not retried — the next reconciliation run will pick
 * up whatever's still UNMATCHED, if anything is).
 */
export async function mergeTransferPair(userId: string, outflowId: string, inflowId: string): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      const [outflow, inflow] = await Promise.all([
        tx.transaction.findUniqueOrThrow({ where: { id: outflowId } }),
        tx.transaction.findUniqueOrThrow({ where: { id: inflowId } }),
      ]);

      if (outflow.userId !== userId || inflow.userId !== userId) {
        throw new Error(RACE_LOST);
      }
      if (!outflow.accountId || !inflow.accountId || outflow.accountId === inflow.accountId) {
        throw new Error(RACE_LOST);
      }
      if (outflow.transferMatchStatus !== TransferMatchStatus.UNMATCHED) {
        throw new Error(RACE_LOST);
      }
      if (inflow.transferMatchStatus !== TransferMatchStatus.UNMATCHED) {
        throw new Error(RACE_LOST);
      }

      const outflowClaim = await tx.transaction.updateMany({
        where: { id: outflowId, transferMatchStatus: TransferMatchStatus.UNMATCHED },
        data: {
          type: TransactionType.TRANSFER,
          toAccountId: inflow.accountId,
          transferMatchStatus: TransferMatchStatus.MATCHED,
        },
      });
      if (outflowClaim.count !== 1) throw new Error(RACE_LOST);

      const inflowClaim = await tx.transaction.updateMany({
        where: { id: inflowId, transferMatchStatus: TransferMatchStatus.UNMATCHED },
        data: {
          transferMatchStatus: TransferMatchStatus.MERGED,
          mergedIntoTransactionId: outflowId,
        },
      });
      if (inflowClaim.count !== 1) throw new Error(RACE_LOST);

      await accountService.updateAccountBalance(userId, outflow.accountId, tx);
      await accountService.updateAccountBalance(userId, inflow.accountId, tx);

      await AuditLogService.log(
        {
          userId,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TRANSACTION,
          entityId: outflowId,
          before: { type: outflow.type, toAccountId: outflow.toAccountId, transferMatchStatus: outflow.transferMatchStatus },
          after: { type: TransactionType.TRANSFER, toAccountId: inflow.accountId, transferMatchStatus: TransferMatchStatus.MATCHED },
          source: "TRANSFER_RECONCILIATION",
        },
        tx
      );

      await AuditLogService.log(
        {
          userId,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TRANSACTION,
          entityId: inflowId,
          before: { transferMatchStatus: inflow.transferMatchStatus, mergedIntoTransactionId: inflow.mergedIntoTransactionId },
          after: { transferMatchStatus: TransferMatchStatus.MERGED, mergedIntoTransactionId: outflowId },
          source: "TRANSFER_RECONCILIATION",
        },
        tx
      );
    });

    return true;
  } catch (err) {
    if (err instanceof Error && err.message === RACE_LOST) return false;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return false; // findUniqueOrThrow lost a race entirely (row gone from a concurrent... never actually deleted, but defensive)
    throw err;
  }
}

/**
 * Fallback for an unmatched outflow that findTransferMatchPairs will never
 * pair: a wire/SWIFT transfer whose receiving bank doesn't send its own
 * "money received" notification has no second leg to ever match against by
 * amount+time, and would otherwise sit as a plain EXPENSE forever —
 * incorrectly counted as real spending instead of an internal transfer, and
 * leaving the destination account's balance permanently short. Resolves it
 * from its own message text alone (e.g. "...MASHREQBANK PSC...") using
 * matchAccountByDescription — the same logic import.service.ts used to run
 * inline at ingestion, before the two-phase rebuild moved all matching
 * here. Only ever proposes the user's OWN other tracked accounts, so an
 * external payment naming some other bank never gets misattributed as an
 * internal transfer just because a name happens to appear in it.
 */
export async function resolveNamedOutflow(userId: string, transactionId: string): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      const outflow = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });

      if (outflow.userId !== userId) return false;
      if (outflow.transferMatchStatus !== TransferMatchStatus.UNMATCHED) return false;
      if (outflow.type !== OUTFLOW_TX_TYPE || outflow.cashFlowDirection !== "OUTFLOW" || !outflow.accountId) return false;

      const otherAccounts = await tx.account.findMany({
        where: { userId, id: { not: outflow.accountId } },
        select: { id: true, name: true },
      });
      const matchedAccount = matchAccountByDescription(otherAccounts, outflow.description);
      if (!matchedAccount) return false;

      const claim = await tx.transaction.updateMany({
        where: { id: transactionId, transferMatchStatus: TransferMatchStatus.UNMATCHED },
        data: {
          type: TransactionType.TRANSFER,
          toAccountId: matchedAccount.id,
          transferMatchStatus: TransferMatchStatus.MATCHED,
        },
      });
      if (claim.count !== 1) return false;

      await accountService.updateAccountBalance(userId, outflow.accountId, tx);
      await accountService.updateAccountBalance(userId, matchedAccount.id, tx);

      await AuditLogService.log(
        {
          userId,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TRANSACTION,
          entityId: transactionId,
          before: { type: outflow.type, toAccountId: outflow.toAccountId, transferMatchStatus: outflow.transferMatchStatus },
          after: { type: TransactionType.TRANSFER, toAccountId: matchedAccount.id, transferMatchStatus: TransferMatchStatus.MATCHED },
          source: "TRANSFER_RECONCILIATION_NAMED",
        },
        tx
      );

      return true;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return false;
    throw err;
  }
}
