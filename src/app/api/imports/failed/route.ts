/**
 * DELETE /api/imports/failed
 *
 * Permanently deletes all of the current user's FAILED ImportedTransaction
 * records (both SMS- and email-sourced) — the "Failed" tab on the Imports
 * page. This is a real delete, not a status change: unlike reject (which
 * keeps a REVIEW_REQUIRED record around as REJECTED), a FAILED record has
 * no further use once dismissed, and an email-sourced one may hold content
 * from a message that was never a bank transaction in the first place.
 * Never touches PROCESSED/REVIEW_REQUIRED/RECEIVED records — those still
 * have a live transaction or a pending user action.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, ImportStatus } from "@prisma/client";

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { count } = await db.importedTransaction.deleteMany({
    where: { userId, status: ImportStatus.FAILED },
  });

  if (count > 0) {
    await db.auditLog.create({
      data: {
        userId,
        action: AuditAction.IMPORT_FAILED_RECORDS_DELETED,
        entityType: AuditEntityType.IMPORTED_TRANSACTION,
        entityId: userId,
        metadata: { count },
      },
    });
  }

  return NextResponse.json({ data: { deletedCount: count } });
}
