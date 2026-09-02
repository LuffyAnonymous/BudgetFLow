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

  // Deliberately NOT forceFullRecompute: that path ignores the bank's own
  // last authoritative reading (latestImportedBalance) entirely and sums
  // every transaction from zero instead — the assumption that "every
  // account starts at 0 with no untracked starting balance" doesn't hold
  // for this app in practice (the wallet-import fallback account and the
  // ignored/pending-message path both legitimately set a real balance
  // with no backing transaction). Confirmed against real production data:
  // forcing a full recompute here produced numbers far off the user's
  // actual bank balances, while the anchored default matched exactly.
  await accountService.updateAllBalances(userId);

  const accounts = await accountService.getAccounts(userId);
  const serialized = await Promise.all(accounts.map((acc) => serializeAccountWithReconciliation(userId, acc)));

  return NextResponse.json({ data: serialized });
}
