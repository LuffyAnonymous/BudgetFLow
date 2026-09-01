/**
 * POST /api/accounts/recalculate — recomputes every one of the caller's
 * accounts from the ledger and returns the refreshed list. A manual escape
 * hatch for a balance left wrong by any prior recompute bug (same-day
 * transactions dropped, an out-of-order backfill clobbering a newer bank
 * snapshot with an older one, etc.) — those fixes only prevent new drift,
 * they don't retroactively correct a currentBalance already snapped to
 * the wrong number. Forces a full from-zero ledger sum (not anchored on
 * latestImportedBalance/latestImportedBalanceAt) specifically so this is
 * always a genuine fix regardless of whether the anchor itself is what's
 * corrupted.
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

  await accountService.updateAllBalances(userId, undefined, true);

  const accounts = await accountService.getAccounts(userId);
  const serialized = await Promise.all(accounts.map((acc) => serializeAccountWithReconciliation(userId, acc)));

  return NextResponse.json({ data: serialized });
}
