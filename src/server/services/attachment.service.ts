import { db } from "@/lib/db";
import { getStorageProvider } from "@/server/storage";
import { validateFileMagicBytes, AllowedMimeType } from "@/server/utils/file-magic";
import { AuditLogService } from "@/server/services/audit-log.service";
import { AuditAction, AuditEntityType, AttachmentStatus, Prisma, Attachment } from "@prisma/client";
import { createHash } from "crypto";

// ─── Limits ────────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;       // 5 MB per file
export const MAX_ATTACHMENTS_PER_RECORD = 5;               // 5 files per parent record
export const MAX_COMBINED_SIZE_BYTES = 20 * 1024 * 1024;  // 20 MB combined per record
export const MAX_QUOTA_PER_USER_BYTES = 100 * 1024 * 1024; // 100 MB per user

export type AttachmentParent =
  | { type: "transaction"; id: string }
  | { type: "debtPayment"; id: string }
  | { type: "savingTx"; id: string }
  | { type: "remittance"; id: string };

function parentToFieldName(parent: AttachmentParent): keyof Prisma.AttachmentCreateInput {
  const map: Record<string, keyof Prisma.AttachmentCreateInput> = {
    transaction: "transaction",
    debtPayment: "debtPayment",
    savingTx: "savingTx",
    remittance: "remittance",
  };
  return map[parent.type];
}

function parentToWhereField(parent: AttachmentParent): Prisma.AttachmentWhereInput {
  switch (parent.type) {
    case "transaction":  return { transactionId: parent.id };
    case "debtPayment":  return { debtPaymentId: parent.id };
    case "savingTx":     return { savingTxId: parent.id };
    case "remittance":   return { remittanceId: parent.id };
  }
}

/**
 * Verifies that the parent record exists and belongs to the given user.
 */
async function verifyParentOwnership(userId: string, parent: AttachmentParent): Promise<void> {
  let found: { userId: string } | null = null;

  if (parent.type === "transaction") {
    found = await db.transaction.findUnique({ where: { id: parent.id }, select: { userId: true } });
  } else if (parent.type === "debtPayment") {
    found = await db.debtPayment.findUnique({ where: { id: parent.id }, select: { userId: true } });
  } else if (parent.type === "savingTx") {
    found = await db.savingTransaction.findUnique({ where: { id: parent.id }, select: { userId: true } });
  } else if (parent.type === "remittance") {
    found = await db.remittance.findUnique({ where: { id: parent.id }, select: { userId: true } });
  }

  if (!found || found.userId !== userId) {
    throw new Error("FORBIDDEN: Parent record not found or does not belong to the current user.");
  }
}

export const AttachmentService = {
  /**
   * Upload a file attachment and link it to a parent financial record.
   * Enforces all size, count, quota, type limits, and parent integrity.
   */
  async upload(
    userId: string,
    parent: AttachmentParent,
    originalName: string,
    buffer: Buffer,
    requestId?: string
  ) {
    // 0. Validate parent type and integrity (service-level, before hitting DB)
    const VALID_PARENT_TYPES = ["transaction", "debtPayment", "savingTx", "remittance"] as const;
    if (!VALID_PARENT_TYPES.includes(parent.type as typeof VALID_PARENT_TYPES[number])) {
      throw new Error(`INVALID_PARENT_TYPE: '${parent.type}' is not a supported attachment parent.`);
    }
    if (!parent.id || typeof parent.id !== "string" || parent.id.trim() === "") {
      throw new Error("INVALID_PARENT: parent.id must be a non-empty string.");
    }

    // 1. Verify parent ownership
    await verifyParentOwnership(userId, parent);


    // 2. Check per-file size limit
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(`FILE_TOO_LARGE: Maximum file size is 5 MB.`);
    }

    // 3. Detect file type via magic bytes (ignores browser-supplied MIME type)
    const detectedMimeType: AllowedMimeType = validateFileMagicBytes(buffer);

    // 4. Compute SHA-256 checksum
    const checksum = createHash("sha256").update(buffer).digest("hex");

    // 5. Count current attachments for this record and check limits
    const parentWhere = parentToWhereField(parent);
    const existingAttachments = await db.attachment.findMany({
      where: {
        ...parentWhere,
        status: { notIn: [AttachmentStatus.DELETED] },
      },
      select: { id: true, fileSize: true },
    });

    if (existingAttachments.length >= MAX_ATTACHMENTS_PER_RECORD) {
      throw new Error(`ATTACHMENT_LIMIT: Maximum ${MAX_ATTACHMENTS_PER_RECORD} attachments per record.`);
    }

    const combinedSize = existingAttachments.reduce((sum: number, a: { fileSize: number }) => sum + a.fileSize, 0) + buffer.length;
    if (combinedSize > MAX_COMBINED_SIZE_BYTES) {
      throw new Error(`COMBINED_SIZE_LIMIT: Maximum 20 MB combined per record.`);
    }

    // 6. Check per-user quota
    const userQuotaResult = await db.attachment.aggregate({
      where: {
        userId,
        status: { notIn: [AttachmentStatus.DELETED] },
      },
      _sum: { fileSize: true },
    });
    const userUsed = userQuotaResult._sum.fileSize ?? 0;
    if (userUsed + buffer.length > MAX_QUOTA_PER_USER_BYTES) {
      throw new Error(`QUOTA_EXCEEDED: Storage quota of 100 MB exceeded.`);
    }

    // 7. Generate a unique storage key
    const ext = originalName.includes(".")
      ? originalName.substring(originalName.lastIndexOf(".")).toLowerCase()
      : "";
    const storageKey = `attachments/${userId}/${crypto.randomUUID()}${ext}`;

    // 8. Upload to storage provider (before DB record to avoid orphaned DB rows)
    const storage = getStorageProvider();
    await storage.upload(storageKey, buffer, detectedMimeType);

    // 9. Create DB record and audit log atomically
    const attachment = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.attachment.create({
        data: {
          originalName,
          storageKey,
          mimeType: detectedMimeType,
          fileSize: buffer.length,
          checksum,
          status: AttachmentStatus.READY,
          userId,
          [parentToFieldName(parent)]: { connect: { id: parent.id } },
        },
      });

      await AuditLogService.log(
        {
          userId,
          action: AuditAction.UPLOAD_ATTACHMENT,
          entityType: AuditEntityType.ATTACHMENT,
          entityId: record.id,
          after: {
            id: record.id,
            originalName,
            mimeType: detectedMimeType,
            fileSize: buffer.length,
            parent: { type: parent.type, id: parent.id },
          },
          requestId,
        },
        tx
      );

      return record;
    });

    return attachment;
  },

  /**
   * Retrieve metadata for a single attachment, validating user ownership.
   */
  async get(userId: string, attachmentId: string): Promise<Attachment> {
    const attachment = await db.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.userId !== userId) {
      throw new Error("FORBIDDEN: Attachment not found or does not belong to the current user.");
    }

    if (attachment.status === AttachmentStatus.DELETED) {
      throw new Error("NOT_FOUND: Attachment has been deleted.");
    }

    return attachment;
  },

  /**
   * Open a readable stream for a file, validating user ownership.
   */
  async openStream(userId: string, attachmentId: string) {
    const attachment = await this.get(userId, attachmentId);
    const storage = getStorageProvider();
    const stream = await storage.openStream(attachment.storageKey);
    return { stream, attachment };
  },

  /**
   * Soft-delete an attachment (marks as DELETED and removes the storage object).
   * The database record is retained for audit trail.
   */
  async delete(userId: string, attachmentId: string, requestId?: string) {
    const attachment = await this.get(userId, attachmentId);

    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.attachment.update({
        where: { id: attachmentId },
        data: {
          status: AttachmentStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      await AuditLogService.log(
        {
          userId,
          action: AuditAction.DELETE_ATTACHMENT,
          entityType: AuditEntityType.ATTACHMENT,
          entityId: attachmentId,
          before: {
            id: attachment.id,
            originalName: attachment.originalName,
            status: attachment.status,
          },
          after: {
            id: attachment.id,
            status: AttachmentStatus.DELETED,
          },
          requestId,
        },
        tx
      );
    });

    // Delete from storage after DB update succeeds
    try {
      const storage = getStorageProvider();
      await storage.delete(attachment.storageKey);
    } catch {
      // Storage deletion failure is logged but does not undo the DB soft-delete
      console.error(`Failed to delete storage object ${attachment.storageKey}`);
    }
  },

  /**
   * List attachments for a parent record.
   */
  async listForParent(userId: string, parent: AttachmentParent) {
    await verifyParentOwnership(userId, parent);

    const parentWhere = parentToWhereField(parent);
    return db.attachment.findMany({
      where: {
        ...parentWhere,
        userId,
        status: { notIn: [AttachmentStatus.DELETED] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        createdAt: true,
      },
    });
  },
};
