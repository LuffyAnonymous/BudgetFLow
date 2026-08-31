import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { DELETE } from "../../../src/app/api/imports/failed/route";
import { AuditAction, ImportSource, ImportStatus } from "@prisma/client";

let currentTestUserId = "";

vi.mock("@/auth", () => ({
  auth: async () => (currentTestUserId ? { user: { id: currentTestUserId, email: "test@budgetflow.ae" } } : null),
}));

describe("DELETE /api/imports/failed", () => {
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.user.deleteMany({ where: { email: { in: ["failed_imports_delete_test@budgetflow.ae", "failed_imports_delete_other@budgetflow.ae"] } } });

    const user = await db.user.create({
      data: { email: "failed_imports_delete_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Failed Imports Delete Tester" },
    });
    userId = user.id;
    currentTestUserId = userId;

    const otherUser = await db.user.create({
      data: { email: "failed_imports_delete_other@budgetflow.ae", passwordHash: "dummy-hash", name: "Other User" },
    });
    otherUserId = otherUser.id;
  });

  async function seedImportedTransaction(ownerId: string, status: ImportStatus, source: ImportSource, suffix: string) {
    return db.importedTransaction.create({
      data: {
        userId: ownerId,
        source,
        institution: "Test Bank",
        status,
        rawPayload: "raw content",
        redactedPayload: "redacted content",
        payloadHash: `hash-${ownerId}-${suffix}`,
        fingerprint: `fp-${ownerId}-${suffix}`,
        receivedAt: new Date(),
      },
    });
  }

  it("returns 401 when unauthenticated", async () => {
    currentTestUserId = "";
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("deletes only FAILED records for the current user, across both SMS and Email sources", async () => {
    await seedImportedTransaction(userId, ImportStatus.FAILED, ImportSource.SMS, "sms-failed");
    await seedImportedTransaction(userId, ImportStatus.FAILED, ImportSource.EMAIL, "email-failed");
    const processed = await seedImportedTransaction(userId, ImportStatus.PROCESSED, ImportSource.SMS, "processed");
    const reviewRequired = await seedImportedTransaction(userId, ImportStatus.REVIEW_REQUIRED, ImportSource.DOCUMENT, "review");
    const otherUsersFailed = await seedImportedTransaction(otherUserId, ImportStatus.FAILED, ImportSource.SMS, "other-user-failed");

    const res = await DELETE();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deletedCount).toBe(2);

    const remaining = await db.importedTransaction.findMany({ where: { userId } });
    expect(remaining.map((r) => r.id).sort()).toEqual([processed.id, reviewRequired.id].sort());

    // Untouched: another user's FAILED record must never be deleted.
    const stillThere = await db.importedTransaction.findUnique({ where: { id: otherUsersFailed.id } });
    expect(stillThere).not.toBeNull();
  });

  it("writes one audit log entry summarizing the deleted count", async () => {
    await seedImportedTransaction(userId, ImportStatus.FAILED, ImportSource.EMAIL, "a");
    await seedImportedTransaction(userId, ImportStatus.FAILED, ImportSource.EMAIL, "b");

    await DELETE();

    const logs = await db.auditLog.findMany({ where: { userId, action: AuditAction.IMPORT_FAILED_RECORDS_DELETED } });
    expect(logs).toHaveLength(1);
    expect((logs[0].metadata as { count: number }).count).toBe(2);
  });

  it("does not write an audit log entry when there was nothing to delete", async () => {
    const res = await DELETE();
    const json = await res.json();
    expect(json.data.deletedCount).toBe(0);

    const logs = await db.auditLog.findMany({ where: { userId, action: AuditAction.IMPORT_FAILED_RECORDS_DELETED } });
    expect(logs).toHaveLength(0);
  });
});
