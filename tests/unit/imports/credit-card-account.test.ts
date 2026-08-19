import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";

/**
 * A credit card purchase increases what's owed rather than spending cash out
 * of a checking account. This must (a) post to its own account, distinct
 * from the same bank's checking account, (b) never treat a reported credit
 * limit / outstanding balance figure as if it were cash on hand, and (c)
 * track its balance as a liability the same way a BNPL account already does.
 */
describe("Credit card SMS handling", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "credit_card_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "credit_card_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Credit Card Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    await db.category.createMany({
      data: [
        { userId, name: "Groceries", type: "VARIABLE_EXPENSE" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  it("posts a credit card purchase to its own liability account, ignoring the reported credit limit", async () => {
    const message = "Purchase of AED 250.00 with Credit Card ending 4521 at Carrefour on 15-08-2026. Available Credit Limit: AED 9,750.00.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome !== "auto_posted") return;

    const tx = await db.transaction.findUnique({ where: { id: res.transactionId }, include: { account: true, category: true } });
    expect(tx?.account?.name).toBe("Emirates NBD Credit Card");
    expect(tx?.account?.isCreditCard).toBe(true);
    expect(tx?.category.name).toBe("Groceries");

    // The reported "Available Credit Limit" (9,750) must never be treated as
    // cash on hand — the account's balance is derived purely from the
    // ledger (0 - 250 = -250, i.e. AED 250 owed), not set to 9,750.
    expect(tx?.account?.currentBalance.toFixed(2)).toBe("-250.00");
  });

  it("keeps a credit card purchase on a separate account from the same bank's checking account", async () => {
    // First: an ordinary debit purchase creates the checking account.
    await importService.processSms(userId, {
      sender: "ENBD",
      message: "Purchase of AED 50.00 with Debit Card ending 1111 at Spinneys on 15-08-2026. Avl Balance is AED 4,000.00.",
      receivedAt: new Date(),
    });

    // Then: a credit card purchase from the same bank.
    await importService.processSms(userId, {
      sender: "ENBD",
      message: "Purchase of AED 250.00 with Credit Card ending 4521 at Carrefour on 15-08-2026. Available Credit Limit: AED 9,750.00.",
      receivedAt: new Date(),
    });

    const accounts = await db.account.findMany({ where: { userId }, orderBy: { name: "asc" } });
    const names = accounts.map((a) => a.name);
    expect(names).toContain("Emirates NBD");
    expect(names).toContain("Emirates NBD Credit Card");

    const checking = accounts.find((a) => a.name === "Emirates NBD")!;
    const creditCard = accounts.find((a) => a.name === "Emirates NBD Credit Card")!;
    expect(checking.isCreditCard).toBe(false);
    expect(checking.currentBalance.toFixed(2)).toBe("4000.00"); // trusted the reported Avl Balance
    expect(creditCard.isCreditCard).toBe(true);
    expect(creditCard.currentBalance.toFixed(2)).toBe("-250.00"); // ledger-derived, not the credit limit
  });
});
