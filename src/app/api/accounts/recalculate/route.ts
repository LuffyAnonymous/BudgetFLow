/**
 * POST /api/accounts/recalculate — recomputes every one of the caller's
 * accounts from the ledger and returns the refreshed list. A manual escape
 * hatch for balances left wrong by the same-day-transaction recompute bug
 * (fixed in account.service.ts, but that fix only prevents new drift — it
 * doesn't retroactively correct a currentBalance a prior buggy recompute
 * already snapped to the wrong number).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { accountService } from "@/server/services/account.service";
import { serializeAccountWithReconciliation } from "../serialize-account";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  await accountService.updateAllBalances(userId);

  const accounts = await accountService.getAccounts(userId);
  const serialized = await Promise.all(accounts.map((acc) => serializeAccountWithReconciliation(userId, acc)));

  return NextResponse.json({ data: serialized });
}
