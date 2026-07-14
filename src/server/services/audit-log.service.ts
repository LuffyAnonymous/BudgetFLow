import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, Prisma } from "@prisma/client";
import { computeAuditDiff } from "@/server/utils/audit-redaction";

type AuditLogOptions = {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

/**
 * AuditLogService
 *
 * Writes immutable audit log entries for sensitive operations.
 *
 * IMPORTANT: For any sensitive financial write (debt payment, remittance reversal,
 * savings transaction, password change, settings update), always pass a Prisma
 * transaction context (tx) so the audit entry commits atomically with the parent
 * operation. If audit creation fails inside a transaction, the parent is rolled back.
 *
 * For lower-risk reads or informational events where audit failure must not block
 * the operation, call `logAsync()` which swallows errors and logs to stderr.
 */
export const AuditLogService = {
  /**
   * Creates a single audit log entry inside an existing database transaction.
   * Audit failure rolls back the entire parent transaction.
   */
  async log(
    options: AuditLogOptions,
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const { before, after, ...rest } = options;
    const diff = computeAuditDiff(before, after);

    await tx.auditLog.create({
      data: {
        userId: rest.userId,
        action: rest.action,
        entityType: rest.entityType,
        entityId: rest.entityId ?? null,
        before: diff.before ? (diff.before as Prisma.JsonObject) : Prisma.JsonNull,
        after: diff.after ? (diff.after as Prisma.JsonObject) : Prisma.JsonNull,
        requestId: rest.requestId ?? null,
        source: rest.source ?? "WEB",
        metadata: rest.metadata ? (rest.metadata as Prisma.JsonObject) : Prisma.JsonNull,
      },
    });
  },

  /**
   * Creates an audit log entry outside a transaction (fire-and-log).
   * Should only be used for non-financial, low-risk informational events.
   * Errors are logged to stderr and do NOT propagate to the caller.
   */
  async logAsync(options: AuditLogOptions): Promise<void> {
    try {
      const { before, after, ...rest } = options;
      const diff = computeAuditDiff(before, after);

      await db.auditLog.create({
        data: {
          userId: rest.userId,
          action: rest.action,
          entityType: rest.entityType,
          entityId: rest.entityId ?? null,
          before: diff.before ? (diff.before as Prisma.JsonObject) : Prisma.JsonNull,
          after: diff.after ? (diff.after as Prisma.JsonObject) : Prisma.JsonNull,
          requestId: rest.requestId ?? null,
          source: rest.source ?? "WEB",
          metadata: rest.metadata ? (rest.metadata as Prisma.JsonObject) : Prisma.JsonNull,
        },
      });
    } catch (err) {
      // logAsync: audit failures are non-fatal but must be surfaced in logs
      console.error("[AuditLogService] logAsync failed:", err);
    }
  },

  /**
   * Retrieve paginated audit logs for a user.
   */
  async list(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      entityType?: AuditEntityType;
      entityId?: string;
    } = {}
  ) {
    const { page = 1, pageSize = 25, entityType, entityId } = options;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {
      userId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    };

    const [items, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  },
};
