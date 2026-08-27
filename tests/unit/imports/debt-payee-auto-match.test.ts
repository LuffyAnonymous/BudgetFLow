import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";

/**
 * A personal transfer to an unrecognized name would normally take the
 * uncategorized-merchant confidence penalty (LOW confidence, flagged for a
 * second look, but still auto-posted). Registering the recipient as a
 * debt's payeeAlias exempts it from that penalty (confidence-evaluator.ts)
 * and, once posted, auto-applies the payment to the matching debt
 * (debt-linkage.ts) instead of requiring a separate manual "Record
 * Payment" click.
 */
describe("Debt payee auto-match", () => {
  let userId: string;

  beforeEach(async () => {
    await db.notification.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "debt_payee_match@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "debt_payee_match@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Payee Match Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    await db.category.create({
      data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
    });
  });

  it("auto-posts a transfer to a registered payee and applies it to the matching debt", async () => {
    const debt = await db.debt.create({
      data: {
        userId,
        name: "Ahmed Loan",
        originalBalance: 1000,
        currentBalance: 1000,
        monthlyPayment: 250,
        dueDay: 1,
        rolloverFeeRate: 0,
        payeeAliases: ["Ahmed Ali"],
      },
    });

    const message = "Transfer of AED 250.00 to Ahmed Ali. Available balance is AED 5,000.00. Ref TXN998877";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome !== "auto_posted") return;

    const updatedDebt = await db.debt.findUniqueOrThrow({ where: { id: debt.id } });
    expect(updatedDebt.currentBalance.toString()).toBe("750");
    expect(updatedDebt.status).toBe("ACTIVE");

    const payments = await db.debtPayment.findMany({ where: { debtId: debt.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].transactionId).toBe(res.transactionId);
    expect(payments[0].amount.toString()).toBe("250");

    const notifications = await db.notification.findMany({ where: { userId, type: "DEBT_PAYMENT_AUTO_APPLIED" } });
    expect(notifications).toHaveLength(1);
  });

  it("sends a payoff notification instead when the payment clears the balance", async () => {
    const debt = await db.debt.create({
      data: {
        userId,
        name: "Ahmed Loan",
        originalBalance: 250,
        currentBalance: 250,
        monthlyPayment: 250,
        dueDay: 1,
        rolloverFeeRate: 0,
        payeeAliases: ["Ahmed Ali"],
      },
    });

    const message = "Transfer of AED 250.00 to Ahmed Ali. Available balance is AED 5,000.00. Ref TXN998878";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");

    const updatedDebt = await db.debt.findUniqueOrThrow({ where: { id: debt.id } });
    expect(updatedDebt.currentBalance.toString()).toBe("0");
    expect(updatedDebt.status).toBe("PAID");

    const paidOffNotifications = await db.notification.findMany({ where: { userId, type: "DEBT_PAID_OFF" } });
    expect(paidOffNotifications).toHaveLength(1);
    const appliedNotifications = await db.notification.findMany({ where: { userId, type: "DEBT_PAYMENT_AUTO_APPLIED" } });
    expect(appliedNotifications).toHaveLength(0);
  });

  it("does not touch any debt when the transfer recipient matches no registered payee", async () => {
    await db.debt.create({
      data: {
        userId,
        name: "Ahmed Loan",
        originalBalance: 1000,
        currentBalance: 1000,
        monthlyPayment: 250,
        dueDay: 1,
        rolloverFeeRate: 0,
        payeeAliases: ["Ahmed Ali"],
      },
    });

    const message = "Transfer of AED 250.00 to Someone Else. Ref TXN998879";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    // Unrecognized merchant, no payee match -> takes the uncategorized
    // penalty (LOW confidence) but still auto-posts, same as any other
    // unrecognized expense — it just never matches tryApplyDebtLinkage.
    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      expect(res.confidence).toBe("LOW");
    }

    const debts = await db.debt.findMany({ where: { userId } });
    expect(debts[0].currentBalance.toString()).toBe("1000");
  });
});
