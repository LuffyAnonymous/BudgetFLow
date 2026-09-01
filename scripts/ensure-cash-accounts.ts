/**
 * scripts/ensure-cash-accounts.ts
 *
 * Every new signup already gets a CASH account automatically (see
 * AccountService.ensureDefaultAccounts, called from
 * user-provisioning.service.ts) — this is a one-off backfill for any
 * existing user who predates that guarantee, or otherwise ended up
 * without one. Idempotent: skips any user who already has a CASH-type
 * account.
 *
 * Defaults to --dry-run (prints who would get one, writes nothing).
 * Pass --apply to actually create accounts and write AuditLog entries.
 *
 * Usage:
 *   npx tsx scripts/ensure-cash-accounts.ts
 *   npx tsx scripts/ensure-cash-accounts.ts --apply
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { AccountType, AuditAction, AuditEntityType, Prisma } from "@prisma/client";
import { AuditLogService } from "../src/server/services/audit-log.service";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`=== Ensure Cash Accounts (${apply ? "APPLY" : "DRY RUN"}) ===`);

  const users = await db.user.findMany({ select: { id: true, email: true } });
  let created = 0;

  for (const user of users) {
    const existingCash = await db.account.findFirst({
      where: { userId: user.id, type: AccountType.CASH },
    });
    if (existingCash) continue;

    console.log(`${user.email}: no Cash account.`);
    if (!apply) continue;

    const account = await db.$transaction(async (tx) => {
      const acc = await tx.account.create({
        data: {
          userId: user.id,
          name: "Cash",
          type: AccountType.CASH,
          currentBalance: new Prisma.Decimal(0),
        },
      });
      await AuditLogService.log(
        {
          userId: user.id,
          action: AuditAction.CREATE,
          entityType: AuditEntityType.ACCOUNT,
          entityId: acc.id,
          after: { id: acc.id, name: acc.name, type: acc.type },
          source: "BACKFILL_ENSURE_CASH_ACCOUNTS",
        },
        tx
      );
      return acc;
    });

    console.log(`  created Cash account ${account.id}.`);
    created++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Users scanned: ${users.length}`);
  console.log(apply ? `Cash accounts created: ${created}` : `Would create: ${created} — re-run with --apply to write.`);
}

main()
  .catch((err) => {
    console.error("Fatal error during Cash account backfill:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
