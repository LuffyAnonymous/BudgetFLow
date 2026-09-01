/**
 * scripts/repair-half-linked-transfers.ts
 *
 * One-time historical backfill for the two-phase transfer rebuild: scans
 * ALL of a user's (or every user's) UNMATCHED transactions — no time
 * window, unlike reconcile-transfers.service.ts's bounded 45-minute scan —
 * and merges exact-amount, different-account pairs the same way. Reuses
 * findTransferMatchPairs()/mergeTransferPair() from
 * src/imports/reconciliation/transfer-matching.ts rather than
 * re-implementing the matching logic here, so this script and the ongoing
 * reconciliation job can never drift apart.
 *
 * Defaults to --dry-run (prints every proposed match, writes nothing).
 * Pass --apply to actually merge and write AuditLog entries.
 * Pass --userId=<id> to scope to one user; omit to scan every user.
 *
 * Usage:
 *   npx tsx scripts/repair-half-linked-transfers.ts
 *   npx tsx scripts/repair-half-linked-transfers.ts --userId=abc123
 *   npx tsx scripts/repair-half-linked-transfers.ts --apply
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { TransferMatchStatus } from "@prisma/client";
import { findTransferMatchPairs, mergeTransferPair, type CandidateTransaction } from "../src/imports/reconciliation/transfer-matching";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const userIdArg = args.find((a) => a.startsWith("--userId="));
  const userIdFilter = userIdArg ? userIdArg.split("=")[1] : null;

  console.log(`=== Repair half-linked transfers (${apply ? "APPLY" : "DRY RUN"}) ===`);
  if (userIdFilter) console.log(`Scoped to userId=${userIdFilter}`);

  const userIds = userIdFilter
    ? [userIdFilter]
    : (await db.user.findMany({ select: { id: true } })).map((u) => u.id);

  let totalScanned = 0;
  let totalProposed = 0;
  let totalApplied = 0;

  for (const userId of userIds) {
    const rows = await db.transaction.findMany({
      where: { userId, transferMatchStatus: TransferMatchStatus.UNMATCHED },
      select: { id: true, accountId: true, amount: true, createdAt: true, type: true, cashFlowDirection: true },
    });

    if (rows.length === 0) continue;

    const candidates: CandidateTransaction[] = rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      amount: r.amount,
      createdAt: r.createdAt,
      type: r.type,
      cashFlowDirection: r.cashFlowDirection,
    }));

    const pairs = findTransferMatchPairs(candidates);
    totalScanned += candidates.length;
    totalProposed += pairs.length;

    if (pairs.length === 0) continue;

    console.log(`\nUser ${userId}: ${candidates.length} unmatched, ${pairs.length} proposed pair(s)`);
    for (const pair of pairs) {
      console.log(`  outflow ${pair.outflowId}  <->  inflow ${pair.inflowId}`);

      if (apply) {
        const merged = await mergeTransferPair(userId, pair.outflowId, pair.inflowId);
        if (merged) {
          totalApplied++;
          console.log(`    merged.`);
        } else {
          console.log(`    skipped (lost the race — already claimed since this scan started).`);
        }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Users scanned: ${userIds.length}`);
  console.log(`Unmatched transactions scanned: ${totalScanned}`);
  console.log(`Pairs proposed: ${totalProposed}`);
  if (apply) {
    console.log(`Pairs merged: ${totalApplied}`);
  } else {
    console.log(`Nothing written — this was a dry run. Re-run with --apply to merge these pairs.`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal error during transfer repair:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
