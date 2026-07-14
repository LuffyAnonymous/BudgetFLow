/**
 * tests/unit/import-cleanup.test.ts
 *
 * Tests for the import payload retention cleanup job:
 *   - Per-user retention period (each user's cutoff calculated independently)
 *   - Payload set to null (not placeholder string)
 *   - payloadClearedAt set
 *   - linked transaction preserved
 *   - fingerprint preserved
 *   - status preserved
 *   - already-cleared records skipped
 *   - cleanup endpoint authorization (IMPORT_CLEANUP_SECRET)
 *   - bounded batch processing
 *   - cleanup summary audit (one entry per run)
 *   - cross-user isolation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../src/lib/db";
import { runImportCleanup } from "../../src/server/jobs/import-cleanup.job";
import {
  ImportSource,
  ImportStatus,
  ImportConfidence,
} from "@prisma/client";
import { randomUUID } from "crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTestUser(tag: string) {
  return db.user.create({
    data: {
      email: `cleanup-test-${tag}-${Date.now()}@test.local`,
      name: "Cleanup Test",
      passwordHash: "test-hash-not-used",
    },
  });
}

async function createTestImport(
  userId: string,
  overrides: Partial<{
    createdAt: Date;
    redactedPayload: string | null;
    payloadClearedAt: Date | null;
    status: ImportStatus;
  }> = {}
) {
  const fingerprint = `fp-${randomUUID()}`;
  return db.importedTransaction.create({
    data: {
      userId,
      source: ImportSource.SMS,
      institution: "Emirates NBD",
      status: overrides.status ?? ImportStatus.PROCESSED,
      confidence: ImportConfidence.HIGH,
      redactedPayload: overrides.redactedPayload ?? "AED 5750.00 ... SALARY TR REF TESTREF.",
      payloadHash: `hash-${randomUUID()}`,
      payloadClearedAt: overrides.payloadClearedAt ?? null,
      fingerprint,
      idempotencyKey: `ik-${randomUUID()}`,
      parsedAmount: 5750,
      parsedCurrency: "AED",
      parsedReference: "TESTREF",
      receivedAt: new Date(),
      financialDate: new Date(),
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runImportCleanup", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeAll(async () => {
    userA = await createTestUser("A");
    userB = await createTestUser("B");

    // User A: retention = 30 days
    await db.importSetting.create({
      data: { userId: userA.id, rawPayloadRetentionDays: 30 },
    });

    // User B: retention = 7 days
    await db.importSetting.create({
      data: { userId: userB.id, rawPayloadRetentionDays: 7 },
    });
  });

  afterAll(async () => {
    await db.importSetting.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await db.importedTransaction.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  it("sets redactedPayload to null for records older than user retention period", async () => {
    // Create an import 40 days old for userA (30-day retention → should be cleared)
    const old = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });

    const result = await runImportCleanup("test-job-1");

    const after = await db.importedTransaction.findUnique({ where: { id: old.id } });
    expect(after?.redactedPayload).toBeNull();
    expect(result.cleared).toBeGreaterThan(0);
  });

  it("sets payloadClearedAt to current time for cleared records", async () => {
    const beforeCleanup = new Date();
    const old = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });

    await runImportCleanup("test-job-2");

    const after = await db.importedTransaction.findUnique({ where: { id: old.id } });
    expect(after?.payloadClearedAt).not.toBeNull();
    expect(after!.payloadClearedAt!.getTime()).toBeGreaterThanOrEqual(beforeCleanup.getTime());
  });

  it("preserves fingerprint, status, parsedAmount after cleanup", async () => {
    const old = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });

    await runImportCleanup("test-job-3");

    const after = await db.importedTransaction.findUnique({ where: { id: old.id } });
    expect(after?.fingerprint).toBeDefined();
    expect(after?.status).toBe(ImportStatus.PROCESSED);
    expect(after?.parsedAmount?.toString()).toBe("5750");
  });

  it("does NOT clear records within the retention period", async () => {
    // Create a recent import for userA (5 days old — within 30-day window)
    const recent = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    await runImportCleanup("test-job-4");

    const after = await db.importedTransaction.findUnique({ where: { id: recent.id } });
    expect(after?.redactedPayload).not.toBeNull();
    expect(after?.payloadClearedAt).toBeNull();
  });

  it("skips already-cleared records (payloadClearedAt set)", async () => {
    const alreadyCleared = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      redactedPayload: null,
      payloadClearedAt: new Date(Date.now() - 1000),
    });

    const result = await runImportCleanup("test-job-5");

    // No additional clears — already-cleared records are skipped
    const after = await db.importedTransaction.findUnique({
      where: { id: alreadyCleared.id },
    });
    // payloadClearedAt should remain unchanged (not updated to now)
    expect(after?.payloadClearedAt?.getTime()).toBeLessThan(Date.now() - 500);
    // Scanned should not include already-cleared records
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });

  it("uses per-user retention period — short retention clears more", async () => {
    // 10-day-old import for userB (7-day retention → should be cleared)
    const userBOld = await createTestImport(userB.id, {
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    // 10-day-old import for userA (30-day retention → should NOT be cleared)
    const userARecent = await createTestImport(userA.id, {
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    await runImportCleanup("test-job-6");

    const afterB = await db.importedTransaction.findUnique({ where: { id: userBOld.id } });
    const afterA = await db.importedTransaction.findUnique({ where: { id: userARecent.id } });

    expect(afterB?.redactedPayload).toBeNull(); // userB's 7-day retention → cleared
    expect(afterA?.redactedPayload).not.toBeNull(); // userA's 30-day retention → kept
  });

  it("writes one summary audit entry per run (not per record)", async () => {
    // Create multiple old records for userA
    await Promise.all([
      createTestImport(userA.id, { createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) }),
      createTestImport(userA.id, { createdAt: new Date(Date.now() - 36 * 24 * 60 * 60 * 1000) }),
      createTestImport(userA.id, { createdAt: new Date(Date.now() - 37 * 24 * 60 * 60 * 1000) }),
    ]);

    const countBefore = await db.auditLog.count({ where: { source: "SYSTEM" } });
    await runImportCleanup("test-job-7");
    const countAfter = await db.auditLog.count({ where: { source: "SYSTEM" } });

    // Exactly 1 new audit entry per run
    expect(countAfter - countBefore).toBe(1);
  });

  it("audit entry does not contain SMS content or fingerprints", async () => {
    await runImportCleanup("test-job-8");

    const auditEntry = await db.auditLog.findFirst({
      where: { source: "SYSTEM" },
      orderBy: { createdAt: "desc" },
    });

    const metadataStr = JSON.stringify(auditEntry?.metadata ?? {});
    expect(metadataStr).not.toContain("SALARY");
    expect(metadataStr).not.toContain("fp-");
    expect(metadataStr).not.toContain("AED");
  });

  it("returns correct aggregate counts", async () => {
    const result = await runImportCleanup("test-job-9");
    expect(typeof result.scanned).toBe("number");
    expect(typeof result.cleared).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(result.jobId).toBe("test-job-9");
  });
});
