import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";
import { ImportSource, ImportStatus, TransactionType, CashFlowDirection } from "@prisma/client";
import { Decimal } from "decimal.js";

describe("DOCUMENT-sourced imports (receipt/invoice uploads) — confirmImport behavior", () => {
  let userId: string;

  beforeEach(async () => {
    await db.attachment.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "document_import_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Document Import Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    await db.category.createMany({
      data: [
        { userId, name: "Dining", type: "VARIABLE_EXPENSE" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  async function createDocumentImport(overrides: Partial<{ parsedAmount: Decimal | null; parsedDescription: string | null; failureCode: string | null }> = {}) {
    const payloadHash = `test-hash-${Math.random()}`;
    const parsedAmount = "parsedAmount" in overrides ? overrides.parsedAmount : new Decimal("42.50");
    const parsedDescription = "parsedDescription" in overrides ? overrides.parsedDescription : "Coffee and pastry";
    return db.importedTransaction.create({
      data: {
        userId,
        source: ImportSource.DOCUMENT,
        institution: "Corniche Cafe",
        status: ImportStatus.REVIEW_REQUIRED,
        extractionMethod: "AI_VISION",
        payloadHash,
        fingerprint: payloadHash,
        receivedAt: new Date(),
        financialDate: new Date(),
        parsedAmount,
        parsedCurrency: "AED",
        parsedDescription,
        failureCode: overrides.failureCode ?? null,
      },
    });
  }

  it("confirms without fabricating a bank account — accountId stays null", async () => {
    const importedTx = await createDocumentImport();
    const result = await importService.confirmImport(userId, importedTx.id);

    const ledgerTx = await db.transaction.findUnique({ where: { id: result.transactionId } });
    expect(ledgerTx).not.toBeNull();
    expect(ledgerTx!.accountId).toBeNull();
    expect(ledgerTx!.type).toBe(TransactionType.EXPENSE);
    expect(ledgerTx!.cashFlowDirection).toBe(CashFlowDirection.OUTFLOW);
    expect(ledgerTx!.amount.toFixed(2)).toBe("42.50");
    expect(ledgerTx!.description).toBe("Coffee and pastry");

    // No Account row should exist at all for a pure-receipt user.
    const accounts = await db.account.findMany({ where: { userId } });
    expect(accounts.length).toBe(0);
  });

  it("re-points the uploaded attachment onto the confirmed transaction", async () => {
    const importedTx = await createDocumentImport();
    const attachment = await db.attachment.create({
      data: {
        userId,
        originalName: "receipt.jpg",
        storageKey: `attachments/${userId}/${importedTx.id}.jpg`,
        mimeType: "image/jpeg",
        fileSize: 1234,
        checksum: "fake-checksum",
        status: "READY",
        importedTransactionId: importedTx.id,
      },
    });

    const result = await importService.confirmImport(userId, importedTx.id);

    const updatedAttachment = await db.attachment.findUnique({ where: { id: attachment.id } });
    expect(updatedAttachment!.transactionId).toBe(result.transactionId);
    expect(updatedAttachment!.importedTransactionId).toBeNull();
  });

  it("requires an amount override when extraction failed (parsedAmount is null)", async () => {
    const importedTx = await createDocumentImport({ parsedAmount: null, parsedDescription: null, failureCode: "EXTRACTION_FAILED" });

    await expect(importService.confirmImport(userId, importedTx.id)).rejects.toThrow(
      /parsedAmount is missing/
    );

    const result = await importService.confirmImport(userId, importedTx.id, {
      amount: new Decimal("99.99"),
      description: "Manually entered lunch receipt",
    });

    const ledgerTx = await db.transaction.findUnique({ where: { id: result.transactionId } });
    expect(ledgerTx!.amount.toFixed(2)).toBe("99.99");
    expect(ledgerTx!.description).toBe("Manually entered lunch receipt");
  });
});
