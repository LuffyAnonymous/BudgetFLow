import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { TransactionDirection } from "./direction-classifier";
import { SupportedBank } from "./sender-normalizer";

import { Prisma } from "@prisma/client";

export async function updateBalance(
  accountId: string,
  amount: Decimal | null,
  direction: TransactionDirection,
  authoritativeAvailableBalance: Decimal | null,
  tx?: Prisma.TransactionClient
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
      lastSMSImportedAt: new Date(),
    }
  });
}
