import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { TransactionService } from "@/server/services/transaction.service";
import { Decimal } from "decimal.js";

describe("TransactionService.createTransaction — defaults accountId to the primary account", () => {
  const transactionService = new TransactionService();
  let userId: string;
  let enbdId: string;
  let mashreqId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "tx_account_default_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "tx_account_default_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Account Default Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", isPrimary: true } });
    const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    enbdId = enbd.id;
    mashreqId = mashreq.id;

    const category = await db.category.create({ data: { userId, name: "Rent", type: "FIXED_EXPENSE" } });
    categoryId = category.id;
  });

  it("attaches a manually-entered expense (no accountId given) to the primary account, and debits it", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Room Rent",
      amount: new Decimal(2000),
      paymentMethod: "Manual",
      type: "EXPENSE",
    });

    expect(created.accountId).toBe(enbdId);

    const enbdAfter = await db.account.findUniqueOrThrow({ where: { id: enbdId } });
    expect(enbdAfter.currentBalance.toFixed(2)).toBe("-2000.00");
  });

  it("never overrides an explicitly-provided accountId", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Coffee",
      amount: new Decimal(15),
      paymentMethod: "Manual",
      type: "EXPENSE",
      accountId: mashreqId,
    });

    expect(created.accountId).toBe(mashreqId);
  });

  it("leaves accountId null when the user has no primary account set", async () => {
    await db.account.update({ where: { id: enbdId }, data: { isPrimary: false } });

    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Untracked expense",
      amount: new Decimal(10),
      paymentMethod: "Manual",
      type: "EXPENSE",
    });

    expect(created.accountId).toBeNull();
  });
});
