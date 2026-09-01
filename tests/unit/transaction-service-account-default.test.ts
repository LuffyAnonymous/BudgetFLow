import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { TransactionService } from "@/server/services/transaction.service";
import { Decimal } from "decimal.js";

describe("TransactionService.createTransaction — resolves accountId when none is given", () => {
  const transactionService = new TransactionService();
  let userId: string;
  let enbdId: string;
  let mashreqId: string;
  let cashId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({
      where: { email: { in: ["tx_account_default_test@budgetflow.ae", "tx_account_default_other@budgetflow.ae"] } },
    });

    const user = await db.user.create({
      data: { email: "tx_account_default_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Account Default Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", isPrimary: true } });
    const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    const cash = await db.account.create({ data: { userId, name: "Cash", type: "CASH" } });
    enbdId = enbd.id;
    mashreqId = mashreq.id;
    cashId = cash.id;

    const category = await db.category.create({ data: { userId, name: "Rent", type: "FIXED_EXPENSE" } });
    categoryId = category.id;
  });

  it("falls back to the primary account when payment method names none of the user's accounts", async () => {
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

  it("attaches to the Cash account when the payment method says CASH, even though Emirates NBD is primary", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Room Rent",
      amount: new Decimal(2000),
      paymentMethod: "CASH",
      type: "EXPENSE",
    });

    expect(created.accountId).toBe(cashId);

    const cashAfter = await db.account.findUniqueOrThrow({ where: { id: cashId } });
    expect(cashAfter.currentBalance.toFixed(2)).toBe("-2000.00");

    const enbdAfter = await db.account.findUniqueOrThrow({ where: { id: enbdId } });
    expect(enbdAfter.currentBalance.toFixed(2)).toBe("0.00");
  });

  it("matches payment method case-insensitively and by substring (e.g. 'Mashreq Debit Card')", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Coffee",
      amount: new Decimal(15),
      paymentMethod: "Mashreq Debit Card",
      type: "EXPENSE",
    });

    expect(created.accountId).toBe(mashreqId);
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

  it("derives paymentMethod from the explicitly-selected account (the form's AccountSelect), ignoring any free-text sent for it", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Coffee",
      amount: new Decimal(15),
      paymentMethod: "this text should be ignored",
      type: "EXPENSE",
      accountId: cashId,
    });

    expect(created.accountId).toBe(cashId);
    expect(created.paymentMethod).toBe("Cash");
  });

  it("rejects an accountId that belongs to a different user", async () => {
    const otherUser = await db.user.create({
      data: { email: "tx_account_default_other@budgetflow.ae", passwordHash: "dummy-hash", name: "Other User" },
    });
    const otherAccount = await db.account.create({
      data: { userId: otherUser.id, name: "Emirates NBD", type: "EMIRATES_NBD" },
    });

    await expect(
      transactionService.createTransaction(userId, {
        date: new Date(),
        categoryId,
        description: "Coffee",
        amount: new Decimal(15),
        paymentMethod: "Manual",
        type: "EXPENSE",
        accountId: otherAccount.id,
      })
    ).rejects.toThrow("INVALID_ACCOUNT");

    await db.account.deleteMany({ where: { userId: otherUser.id } });
    await db.user.delete({ where: { id: otherUser.id } });
  });
});

describe("TransactionService.updateTransaction — moving a transaction between accounts", () => {
  const transactionService = new TransactionService();
  let userId: string;
  let enbdId: string;
  let cashId: string;
  let categoryId: string;
  let transactionId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({
      where: { email: { in: ["tx_move_account_test@budgetflow.ae", "tx_move_account_other@budgetflow.ae"] } },
    });

    const user = await db.user.create({
      data: { email: "tx_move_account_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Move Account Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", isPrimary: true } });
    const cash = await db.account.create({ data: { userId, name: "Cash", type: "CASH" } });
    enbdId = enbd.id;
    cashId = cash.id;

    const category = await db.category.create({ data: { userId, name: "Rent", type: "FIXED_EXPENSE" } });
    categoryId = category.id;

    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Room Rent",
      amount: new Decimal(2000),
      paymentMethod: "Manual",
      type: "EXPENSE",
      accountId: enbdId,
    });
    transactionId = created.id;
  });

  it("reverses the balance on the old account and applies it to the new one, updating paymentMethod to match", async () => {
    const updated = await transactionService.updateTransaction(transactionId, userId, { accountId: cashId });

    expect(updated.accountId).toBe(cashId);
    expect(updated.paymentMethod).toBe("Cash");

    const enbdAfter = await db.account.findUniqueOrThrow({ where: { id: enbdId } });
    expect(enbdAfter.currentBalance.toFixed(2)).toBe("0.00");

    const cashAfter = await db.account.findUniqueOrThrow({ where: { id: cashId } });
    expect(cashAfter.currentBalance.toFixed(2)).toBe("-2000.00");
  });

  it("rejects moving a transaction to an account that belongs to a different user", async () => {
    const otherUser = await db.user.create({
      data: { email: "tx_move_account_other@budgetflow.ae", passwordHash: "dummy-hash", name: "Other User" },
    });
    const otherAccount = await db.account.create({
      data: { userId: otherUser.id, name: "Mashreq", type: "MASHREQ" },
    });

    await expect(
      transactionService.updateTransaction(transactionId, userId, { accountId: otherAccount.id })
    ).rejects.toThrow("INVALID_ACCOUNT");

    await db.account.deleteMany({ where: { userId: otherUser.id } });
    await db.user.delete({ where: { id: otherUser.id } });
  });
});

describe("TransactionService.deleteTransaction — audit logging", () => {
  const transactionService = new TransactionService();
  let userId: string;
  let enbdId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "tx_delete_audit_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "tx_delete_audit_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Delete Audit Tester" },
    });
    userId = user.id;

    const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD", isPrimary: true } });
    enbdId = enbd.id;

    const category = await db.category.create({ data: { userId, name: "Rent", type: "FIXED_EXPENSE" } });
    categoryId = category.id;
  });

  it("writes a DELETE AuditLog entry and reverses the account balance", async () => {
    const created = await transactionService.createTransaction(userId, {
      date: new Date(),
      categoryId,
      description: "Room Rent",
      amount: new Decimal(2000),
      paymentMethod: "Manual",
      type: "EXPENSE",
      accountId: enbdId,
    });

    await transactionService.deleteTransaction(created.id, userId);

    const enbdAfter = await db.account.findUniqueOrThrow({ where: { id: enbdId } });
    expect(enbdAfter.currentBalance.toFixed(2)).toBe("0.00");

    const logs = await db.auditLog.findMany({
      where: { userId, entityId: created.id, action: "DELETE" },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].before as Record<string, unknown>).accountId).toBe(enbdId);
  });
});
