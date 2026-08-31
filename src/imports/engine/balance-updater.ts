import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { TransactionDirection } from "./direction-classifier";

import { Prisma } from "@prisma/client";

export async function updateBalance(
  accountId: string,
  amount: Decimal | null,
  direction: TransactionDirection,
  authoritativeAvailableBalance: Decimal | null,
  tx?: Prisma.TransactionClient,
  // A full ledger recompute (accountService.updateAccountBalance) anchors on
  // latestImportedBalance and re-sums only Transaction rows with
  // createdAt > lastSMSImportedAt. If this call runs (as it does in
  // autoPostTransaction) *before* that same message's own Transaction row
  // is inserted, that row's DB-assigned createdAt lands a few milliseconds
  // after lastSMSImportedAt's JS-side timestamp — passing every future
  // recompute's "since" filter and double-counting a transaction the
  // anchor balance already includes. Callers that also create a Transaction
  // row for this same message must pass the exact same Date used for that
  // row's createdAt, so the two line up and the row is correctly excluded.
  timestamp: Date = new Date()
): Promise<void> {
  const client = tx || db;
  const account = await client.account.findUnique({ where: { id: accountId } });
  if (!account) return;

  let newBalance = account.currentBalance;

  if (authoritativeAvailableBalance !== null) {
    newBalance = authoritativeAvailableBalance;
  } else if (amount !== null) {
    if (direction === TransactionDirection.INFLOW) {
      newBalance = newBalance.plus(amount);
    } else if (direction === TransactionDirection.OUTFLOW) {
      newBalance = newBalance.minus(amount);
    }
  }

  await client.account.update({
    where: { id: accountId },
    data: {
      currentBalance: newBalance,
      latestImportedBalance: authoritativeAvailableBalance !== null ? authoritativeAvailableBalance : account.latestImportedBalance,
      lastSMSImportedAt: timestamp,
    }
  });
}
