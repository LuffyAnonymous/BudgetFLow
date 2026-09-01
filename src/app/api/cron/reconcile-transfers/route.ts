/**
 * GET /api/cron/reconcile-transfers
 * GET /api/cron/reconcile-transfers?userId=<id>
 *
 * Phase 2 of the two-phase transfer design (see
 * src/imports/reconciliation/reconcile-transfers.service.ts) — runs
 * reconcileTransfers() for every user with import enabled, or a single
 * user when ?userId= is given. Triggered every 15 minutes by a GitHub
 * Actions workflow (.github/workflows/reconcile-transfers.yml, Bearer
 * $CRON_SECRET), not n8n or Vercel Cron — this needs to run on a fixed
 * schedule regardless of whether any other service happens to be up, which
 * rules out an n8n-triggered call unless the n8n instance itself is always
 * live. Same pattern as /api/cron/gmail-watch-renew.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reconcileTransfers } from "@/imports/reconciliation/reconcile-transfers.service";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdParam = req.nextUrl.searchParams.get("userId");

  const userIds = userIdParam
    ? [userIdParam]
    : (
        await db.user.findMany({
          where: { importSetting: { enabled: true } },
          select: { id: true },
        })
      ).map((u) => u.id);

  const results: { userId: string; matched: number; scanned: number; error?: string }[] = [];
  let totalMatched = 0;
  let totalScanned = 0;

  for (const userId of userIds) {
    try {
      const { matched, scanned } = await reconcileTransfers(userId);
      results.push({ userId, matched, scanned });
      totalMatched += matched;
      totalScanned += scanned;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Reconcile Transfers Cron] Failed for user", userId, message);
      results.push({ userId, matched: 0, scanned: 0, error: message });
    }
  }

  return NextResponse.json({
    success: true,
    usersProcessed: userIds.length,
    totalMatched,
    totalScanned,
    results,
  });
}
