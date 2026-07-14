/**
 * src/server/jobs/import-cleanup.job.ts
 *
 * Retention cleanup job for ImportedTransaction.redactedPayload.
 *
 * Rules (corrections #10, #11, #12):
 *   - Per-user retention period from ImportSetting.rawPayloadRetentionDays
 *   - redactedPayload is set to NULL (not a placeholder string)
 *   - payloadClearedAt is set to the current timestamp
 *   - Already-cleared records (payloadClearedAt IS NOT NULL) are skipped
 *   - Financial fields (amount, reference, fingerprint, status, transactionId) are NEVER touched
 *   - Processes in bounded batches (default 200 records per batch)
 *   - Writes ONE summary audit entry per run (not per record)
 *   - Cross-user isolation: each user's cutoff is calculated independently
 *   - Returns a safe aggregate result object
 *
 * Security:
 *   - This job processes all users. It must only be invoked by a system endpoint
 *     protected with a server-side secret (IMPORT_CLEANUP_SECRET).
 *   - No user-controlled target userId is accepted.
 *   - SMS content and fingerprints are NEVER included in audit entries.
 */

import "server-only";

import { db } from "@/lib/db";
import { AuditAction, AuditEntityType } from "@prisma/client";

const BATCH_SIZE = parseInt(process.env.IMPORT_CLEANUP_BATCH_SIZE ?? "200", 10);

export interface CleanupRunResult {
  scanned: number;
  cleared: number;
  failed: number;
  durationMs: number;
  jobId: string;
}

export async function runImportCleanup(jobId: string): Promise<CleanupRunResult> {
  const startedAt = Date.now();
  let scanned = 0;
  let cleared = 0;
  let failed = 0;

  // Load all users who have import settings with a configured retention period
  const settings = await db.importSetting.findMany({
    select: { userId: true, rawPayloadRetentionDays: true },
    where: { rawPayloadRetentionDays: { gt: 0 } },
  });

  for (const setting of settings) {
    const cutoff = new Date(
      Date.now() - setting.rawPayloadRetentionDays * 24 * 60 * 60 * 1000
    );

    // Find ImportedTransactions for this user older than their retention cutoff
    // that still have a payload to clear
    let cursor: string | undefined;

    while (true) {
      const batch = await db.importedTransaction.findMany({
        where: {
          userId: setting.userId,
          createdAt: { lt: cutoff },
          payloadClearedAt: null,     // skip already-cleared records
          redactedPayload: { not: null }, // only process records with payload
        },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      });

      if (batch.length === 0) break;

      scanned += batch.length;
      cursor = batch[batch.length - 1].id;

      const ids = batch.map((r) => r.id);

      try {
        const updated = await db.importedTransaction.updateMany({
          where: { id: { in: ids }, userId: setting.userId },
          data: {
            redactedPayload: null,
            payloadClearedAt: new Date(),
          },
        });
        cleared += updated.count;
      } catch (err) {
        failed += batch.length;
        console.error(
          `[import-cleanup] Failed to clear batch for user ${setting.userId}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  // Write one summary audit entry for the entire run (correction #12)
  // Use the first user's ID — AuditLog requires a valid FK userId
  const auditUserId = settings[0]?.userId;
  if (auditUserId) {
    await db.auditLog.create({
      data: {
        userId: auditUserId,
        action: AuditAction.IMPORT_TOKEN_REVOKED,
        entityType: AuditEntityType.IMPORT_SETTING,
        source: "SYSTEM",
        metadata: {
          jobType: "import_payload_cleanup",
          jobId,
          scanned,
          cleared,
          failed,
          durationMs,
          ranAt: new Date().toISOString(),
        },
      },
    }).catch((err) => {
      console.error("[import-cleanup] Audit write failed:", err);
    });
  }

  return { scanned, cleared, failed, durationMs, jobId };
}
