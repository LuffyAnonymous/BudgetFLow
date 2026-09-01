import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { TransactionDirection } from "./direction-classifier";

import { Prisma } from "@prisma/client";

export async function updateBalance(
  accountId: string,
  amount: Decimal | null,
  direction: TransactionDirection,
  authoritativeAvailableBalance: Decimal | null,
  // The real-world event time of THIS message (Transaction.occurredAt) —
  // distinct from `timestamp` below. Used to guard against an out-of-order
  // backfilled/resynced message (older real event, processed later)
  // clobbering or double-applying on top of a balance snapshot that's
  // already more current in real time. See the isStaleRelativeToAnchor
  // comment below.
  occurredAt: Date,
  tx?: Prisma.TransactionClient,
  // A full ledger recompute (accountService.updateAccountBalance) anchors on
  // latestImportedBalance and re-sums only Transaction rows with
  // occurredAt > latestImportedBalanceAt. If this call runs (as it does in
  // autoPostTransaction) *before* that same message's own Transaction row
  // is inserted, that row's DB-assigned createdAt lands a few milliseconds
  // after this call's own timestamp — passing every future recompute's
  // "since" filter and double-counting a transaction the anchor balance
  // already includes. Callers that also create a Transaction row for this
  // same message must pass the exact same Date used for that row's
  // createdAt, so the two line up and the row is correctly excluded.
  timestamp: Date = new Date()
): Promise<void> {
  const client = tx || db;
  const account = await client.account.findUnique({ where: { id: accountId } });
  if (!account) return;

  // A message whose real event time is strictly before the current
  // authoritative-balance anchor already happened before that snapshot was
  // taken — the bank's own reported balance already reflects it. Applying
  // it here too (as an overwrite OR an increment) would double-count it.
  // This is what makes balances resilient to backfilled/resynced messages
  // arriving in whatever order they happen to get processed in, rather
  // than the order they actually happened in: only a message genuinely
  // newer than the anchor ever mutates currentBalance via this fast path.
  // A skipped message's own Transaction row is still created by the
  // caller regardless — a later full ledger recompute
  // (accountService.updateAccountBalance) picks it up correctly.
  const isStaleRelativeToAnchor =
    account.latestImportedBalanceAt !== null && occurredAt < account.latestImportedBalanceAt;

  let newBalance = account.currentBalance;
  let newLatestImportedBalance = account.latestImportedBalance;
  let newLatestImportedBalanceAt = account.latestImportedBalanceAt;

  if (!isStaleRelativeToAnchor) {
    if (authoritativeAvailableBalance !== null) {
      newBalance = authoritativeAvailableBalance;
      newLatestImportedBalance = authoritativeAvailableBalance;
      newLatestImportedBalanceAt = occurredAt;
    } else if (amount !== null) {
      if (direction === TransactionDirection.INFLOW) {
        newBalance = newBalance.plus(amount);
      } else if (direction === TransactionDirection.OUTFLOW) {
        newBalance = newBalance.minus(amount);
      }
    }
  }

  await client.account.update({
    where: { id: accountId },
    data: {
      currentBalance: newBalance,
      latestImportedBalance: newLatestImportedBalance,
      latestImportedBalanceAt: newLatestImportedBalanceAt,
      lastSMSImportedAt: timestamp,
    }
  });
}
