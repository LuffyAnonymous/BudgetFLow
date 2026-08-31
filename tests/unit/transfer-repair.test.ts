import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { TransferRepairService } from "../../src/server/services/transfer-repair.service";

const transferRepairService = new TransferRepairService();

describe("TransferRepairService", () => {
  let userId: string;
  let enbdAccountId: string;
  let mashreqAccountId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "transfer_repair@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "transfer_repair@budgetflow.ae", passwordHash: "dummy-hash", name: "Repair Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
    enbdAccountId = enbd.id;
    const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    mashreqAccountId = mashreq.id;

    const category = await db.category.create({ data: { userId, name: "Transfers", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;
  });

  async function makeHalfLinkedTransfer(opts: { accountId?: string | null; toAccountId?: string | null } = {}) {
    const tx = await db.transaction.create({
      data: {
        userId,
        date: new Date(),
        categoryId,
        description: "Mashreq",
        amount: "500.00",
        paymentMethod: "SMS Import",
        type: "TRANSFER",
        cashFlowDirection: "OUTFLOW",
        accountId: opts.accountId === undefined ? enbdAccountId : opts.accountId,
        toAccountId: opts.toAccountId === undefined ? null : opts.toAccountId,
      },
    });

    await db.importedTransaction.create({
      data: {
        userId,
        source: "SMS",
        institution: "Emirates NBD",
        status: "PROCESSED",
        payloadHash: "hash-out",
        fingerprint: "fp-out",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "500.00",
        parsedDescription: "Mashreq",
        transactionId: tx.id,
      },
    });
    await db.importedTransaction.create({
      data: {
        userId,
        source: "SMS",
        institution: "Mashreq",
        status: "PROCESSED",
        payloadHash: "hash-in",
        fingerprint: "fp-in",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "500.00",
        parsedDescription: "Emirates NBD",
        transactionId: tx.id,
      },
    });

    return tx;
  }

  it("diagnoses a half-linked transfer as FIXABLE with the correct resolved accounts", async () => {
    const tx = await makeHalfLinkedTransfer();
    const results = await transferRepairService.diagnose(userId);

    expect(results).toHaveLength(1);
    expect(results[0].transactionId).toBe(tx.id);
    expect(results[0].status).toBe("FIXABLE");
    expect(results[0].resolvedAccountId).toBe(enbdAccountId);
    expect(results[0].resolvedToAccountId).toBe(mashreqAccountId);
  });

  it("repairs a FIXABLE transfer, fills only the missing side, and updates both account balances", async () => {
    const tx = await makeHalfLinkedTransfer();

    const result = await transferRepairService.repair(userId, [tx.id]);
    expect(result.repaired).toEqual([tx.id]);
    expect(result.skipped).toHaveLength(0);

    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(updated.accountId).toBe(enbdAccountId);
    expect(updated.toAccountId).toBe(mashreqAccountId);

    const mashreq = await db.account.findUniqueOrThrow({ where: { id: mashreqAccountId } });
    expect(Number(mashreq.currentBalance)).toBe(500);

    const auditEntries = await db.auditLog.findMany({ where: { userId, entityId: tx.id } });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].source).toBe("TRANSFER_REPAIR");
  });

  it("never overwrites an already-populated accountId/toAccountId", async () => {
    // Both sides already set correctly — shouldn't appear in diagnosis at all
    // (the WHERE clause only looks at rows missing a side), but repair()
    // must also no-op safely if called directly on a fully-linked id.
    const tx = await makeHalfLinkedTransfer({ accountId: enbdAccountId, toAccountId: mashreqAccountId });
    const results = await transferRepairService.diagnose(userId);
    expect(results).toHaveLength(0);

    const result = await transferRepairService.repair(userId, [tx.id]);
    expect(result.repaired).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);

    const unchanged = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(unchanged.accountId).toBe(enbdAccountId);
    expect(unchanged.toAccountId).toBe(mashreqAccountId);
  });

  it("flags a transfer as WRONG_LEG_COUNT when it doesn't have exactly 2 linked legs", async () => {
    const tx = await db.transaction.create({
      data: {
        userId,
        date: new Date(),
        categoryId,
        description: "Solo leg",
        amount: "200.00",
        paymentMethod: "SMS Import",
        type: "TRANSFER",
        cashFlowDirection: "OUTFLOW",
        accountId: enbdAccountId,
        toAccountId: null,
      },
    });
    await db.importedTransaction.create({
      data: {
        userId,
        source: "SMS",
        institution: "Emirates NBD",
        status: "PROCESSED",
        payloadHash: "hash-solo",
        fingerprint: "fp-solo",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "200.00",
        parsedDescription: "Somewhere",
        transactionId: tx.id,
      },
    });

    const results = await transferRepairService.diagnose(userId);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("WRONG_LEG_COUNT");

    const repairResult = await transferRepairService.repair(userId, [tx.id]);
    expect(repairResult.repaired).toHaveLength(0);
    expect(repairResult.skipped).toHaveLength(1);
  });

  it("flags a transfer as ACCOUNT_NOT_FOUND when a leg's institution has no matching account", async () => {
    const tx = await db.transaction.create({
      data: {
        userId,
        date: new Date(),
        categoryId,
        description: "Unknown Bank",
        amount: "150.00",
        paymentMethod: "SMS Import",
        type: "TRANSFER",
        cashFlowDirection: "OUTFLOW",
        accountId: enbdAccountId,
        toAccountId: null,
      },
    });
    await db.importedTransaction.create({
      data: {
        userId,
        source: "SMS",
        institution: "Emirates NBD",
        status: "PROCESSED",
        payloadHash: "hash-a",
        fingerprint: "fp-a",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "150.00",
        parsedDescription: "Unknown Bank",
        transactionId: tx.id,
      },
    });
    await db.importedTransaction.create({
      data: {
        userId,
        source: "SMS",
        institution: "Some Bank That Was Never Created As An Account",
        status: "PROCESSED",
        payloadHash: "hash-b",
        fingerprint: "fp-b",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "150.00",
        parsedDescription: "Emirates NBD",
        transactionId: tx.id,
      },
    });

    const results = await transferRepairService.diagnose(userId);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ACCOUNT_NOT_FOUND");
  });

  it("scopes diagnosis strictly to the requesting user — never touches another user's transfers", async () => {
    await makeHalfLinkedTransfer();

    const otherUser = await db.user.create({
      data: { email: "transfer_repair_other@budgetflow.ae", passwordHash: "dummy-hash", name: "Other" },
    });
    const otherResults = await transferRepairService.diagnose(otherUser.id);
    expect(otherResults).toHaveLength(0);

    await db.user.delete({ where: { id: otherUser.id } });
  });
});
