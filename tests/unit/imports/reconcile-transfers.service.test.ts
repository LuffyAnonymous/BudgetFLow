import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { reconcileTransfers } from "../../../src/imports/reconciliation/reconcile-transfers.service";
import { mergeTransferPair } from "../../../src/imports/reconciliation/transfer-matching";
import { AuditAction, AuditEntityType } from "@prisma/client";

describe("reconcileTransfers", () => {
  let userId: string;
  let enbdId: string;
  let mashreqId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "reconcile_transfers_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "reconcile_transfers_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Reconcile Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
    const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    enbdId = enbd.id;
    mashreqId = mashreq.id;

    const category = await db.category.create({ data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;
  });

  async function createLeg(overrides: {
    accountId: string;
    amount: number;
    type: "EXPENSE" | "INCOME";
    cashFlowDirection: "OUTFLOW" | "INFLOW";
    createdAt: Date;
  }) {
    return db.transaction.create({
      data: {
        userId,
        accountId: overrides.accountId,
        categoryId,
        date: overrides.createdAt,
        amount: overrides.amount,
        description: "test leg",
        paymentMethod: "SMS Import",
        type: overrides.type,
        cashFlowDirection: overrides.cashFlowDirection,
        origin: "SMS_IMPORT",
        createdAt: overrides.createdAt,
      },
    });
  }

  it("excludes transactions outside the match window even if they'd otherwise pair", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 60 * 60 * 1000); // 60 minutes ago

    await createLeg({ accountId: enbdId, amount: 100, type: "EXPENSE", cashFlowDirection: "OUTFLOW", createdAt: stale });
    await createLeg({ accountId: mashreqId, amount: 100, type: "INCOME", cashFlowDirection: "INFLOW", createdAt: now });

    const result = await reconcileTransfers(userId, 45);
    expect(result.matched).toBe(0);
    // Only the recent leg falls inside the 45-minute window.
    expect(result.scanned).toBe(1);
  });

  it("writes two AuditLog entries (before/after) for a merged pair", async () => {
    const now = new Date();
    const out = await createLeg({ accountId: enbdId, amount: 200, type: "EXPENSE", cashFlowDirection: "OUTFLOW", createdAt: now });
    const inc = await createLeg({ accountId: mashreqId, amount: 200, type: "INCOME", cashFlowDirection: "INFLOW", createdAt: now });

    await reconcileTransfers(userId, 45);

    const logs = await db.auditLog.findMany({
      where: { userId, action: AuditAction.UPDATE, entityType: AuditEntityType.TRANSACTION },
      orderBy: { createdAt: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.entityId).sort()).toEqual([out.id, inc.id].sort());
  });

  it("is race-safe: calling mergeTransferPair twice concurrently for the same pair only merges once", async () => {
    const now = new Date();
    const out = await createLeg({ accountId: enbdId, amount: 300, type: "EXPENSE", cashFlowDirection: "OUTFLOW", createdAt: now });
    const inc = await createLeg({ accountId: mashreqId, amount: 300, type: "INCOME", cashFlowDirection: "INFLOW", createdAt: now });

    const [first, second] = await Promise.all([
      mergeTransferPair(userId, out.id, inc.id),
      mergeTransferPair(userId, out.id, inc.id),
    ]);

    // Exactly one of the two concurrent attempts wins; the other loses the race.
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const outAfter = await db.transaction.findUniqueOrThrow({ where: { id: out.id } });
    expect(outAfter.transferMatchStatus).toBe("MATCHED");
    expect(outAfter.type).toBe("TRANSFER");

    const logs = await db.auditLog.findMany({ where: { userId, entityId: out.id } });
    expect(logs).toHaveLength(1); // not double-logged
  });

  it("returns { matched: 0, scanned: 0 } when there's nothing UNMATCHED", async () => {
    const result = await reconcileTransfers(userId, 45);
    expect(result).toEqual({ matched: 0, scanned: 0 });
  });
});
