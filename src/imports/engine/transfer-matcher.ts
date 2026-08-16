import { db } from "@/lib/db";
import { TransactionType } from "@prisma/client";
import { Decimal } from "decimal.js";
import { SupportedBank } from "./sender-normalizer";

const MATCH_WINDOW_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function matchInternalTransfer(
  userId: string,
  amount: Decimal,
  date: Date,
  sourceBank: SupportedBank,
  isIncoming: boolean
): Promise<string | null> {
  // If we are looking at an incoming transfer, we search for an outgoing transfer of the same amount in the last 24h
  // If we are looking at an outgoing transfer, we search for an incoming transfer of the same amount in the last 24h

  // Find recent transactions with exact same amount that might be the other side of this transfer
  const minDate = new Date(date.getTime() - MATCH_WINDOW_MS);
  const maxDate = new Date(date.getTime() + MATCH_WINDOW_MS);

  const potentialMatches = await db.transaction.findMany({
    where: {
      userId,
      amount,
      type: TransactionType.TRANSFER,
      date: {
        gte: minDate,
        lte: maxDate,
      }
    },
    include: { account: true, toAccount: true }
  });

  for (const tx of potentialMatches) {
    if (isIncoming) {
      // We received money. We need a tx where money left an account and went to us.
      if (tx.toAccountId) return tx.id; // It's already an internal transfer
      if (tx.cashFlowDirection === "OUTFLOW") return tx.id;
    } else {
      // We sent money. We need a tx where money entered an account.
      if (tx.toAccountId) return tx.id;
      if (tx.cashFlowDirection === "INFLOW") return tx.id;
    }
  }

  return null;
}
