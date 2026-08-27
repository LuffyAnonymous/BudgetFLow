import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";
import { ImportSource, ImportStatus } from "@prisma/client";

/**
 * Regression coverage for the pre-existing category-based debt-linkage
 * behavior (confirming a REVIEW_REQUIRED import into a DEBT-type category
 * that's linked to a Debt) after refactoring it off a raw inline balance
 * mutation and onto the shared recordDebtPayment path. Confirms the fix for
 * the audit-trail gap: a DebtPayment row must now actually get created,
 * which the old inline code silently skipped.
 *
 * SMS never lands in REVIEW_REQUIRED any more (it always auto-posts or
 * fails), so this exercises confirmImport() via a DOCUMENT-source import —
 * the same fixture shape src/app/api/imports/receipt/route.ts creates —
 * which is the only path that still reaches REVIEW_REQUIRED today.
 */
describe("Debt category-linkage on confirmImport", () => {
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
    await db.user.deleteMany({ where: { email: "debt_category_link@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "debt_category_link@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Category Link Tester",
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

  it("applies the confirmed transaction to the linked debt and records a real DebtPayment", async () => {
    const debtCategory = await db.category.create({
      data: { userId, name: "Tabby Payment", type: "DEBT" },
    });
    const debt = await db.debt.create({
      data: {
        userId,
        name: "Tabby",
        originalBalance: 1000,
        currentBalance: 1000,
        monthlyPayment: 250,
        dueDay: 1,
        rolloverFeeRate: 0,
        categoryId: debtCategory.id,
      },
    });

    // A receipt upload — the flow that still lands in REVIEW_REQUIRED.
    const importedTx = await db.importedTransaction.create({
      data: {
        userId,
        source: ImportSource.DOCUMENT,
        institution: "Receipt Upload",
        status: ImportStatus.REVIEW_REQUIRED,
        extractionMethod: "AI_VISION",
        payloadHash: "test-payload-hash",
        fingerprint: "test-fingerprint",
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount: "100.00",
        parsedCurrency: "AED",
        parsedDescription: "Some Unlisted Shop",
      },
    });

    const confirmed = await importService.confirmImport(userId, importedTx.id, {
      categoryId: debtCategory.id,
    });
    expect(confirmed.transactionId).toBeTruthy();

    const updatedDebt = await db.debt.findUniqueOrThrow({ where: { id: debt.id } });
    expect(updatedDebt.currentBalance.toString()).toBe("900");

    const payments = await db.debtPayment.findMany({ where: { debtId: debt.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].transactionId).toBe(confirmed.transactionId);
    expect(payments[0].amount.toString()).toBe("100");
  });
});
