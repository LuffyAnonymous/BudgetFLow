import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  ImportSource,
  ImportStatus,
  NotificationType,
  NotificationSeverity,
  Prisma,
  TransactionOrigin,
  TransactionType,
  CashFlowDirection,
  AccountType,
  CategoryType,
} from "@prisma/client";
import { validateFileMagicBytes } from "@/server/utils/file-magic";
import { MAX_FILE_SIZE_BYTES, AttachmentService } from "@/server/services/attachment.service";
import { extractReceiptTransaction } from "@/imports/engine/ai-receipt-extractor";
import { accountService } from "@/server/services/account.service";

/**
 * POST /api/imports/receipt
 * Upload a photographed/scanned receipt or PDF invoice. The transaction is
 * extracted via AI vision.
 *
 * A successful extraction auto-posts straight to the ledger — attributed to
 * your primary account if you've set one (Accounts page), else a shared
 * "Receipts" fallback account — and raises an IMPORT_AUTO_POSTED
 * notification so a misread amount is still catchable after the fact,
 * rather than blocking on manual review before anything lands.
 *
 * Only a genuine extraction failure (nothing readable on the receipt at
 * all) still lands as REVIEW_REQUIRED — there's no amount/vendor to auto-
 * post in that case, unlike a bank SMS this never has a balance line to
 * fall back on.
 *
 * Body: multipart/form-data — file: File
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE: Maximum file size is 5 MB." }, { status: 422 });
  }

  let mimeType;
  try {
    mimeType = validateFileMagicBytes(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid file type";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const payloadHash = createHash("sha256").update(buffer).digest("hex");

  // Same content re-uploaded — treat as a duplicate of the existing item.
  const existingByFingerprint = await db.importedTransaction.findUnique({
    where: { userId_fingerprint: { userId, fingerprint: payloadHash } },
    select: { id: true },
  });
  if (existingByFingerprint) {
    return NextResponse.json(
      { outcome: "duplicate", importedTransactionId: existingByFingerprint.id },
      { status: 409 }
    );
  }

  const extraction = await extractReceiptTransaction(buffer, mimeType);
  const now = new Date();

  if (!extraction) {
    // Nothing readable at all — there's no amount/vendor to auto-post, so
    // this is the one case that still genuinely needs manual entry.
    const importedTx = await db.importedTransaction.create({
      data: {
        userId,
        source: ImportSource.DOCUMENT,
        institution: "Receipt Upload",
        status: ImportStatus.REVIEW_REQUIRED,
        extractionMethod: "AI_VISION",
        payloadHash,
        fingerprint: payloadHash,
        receivedAt: now,
        financialDate: now,
        failureCode: "EXTRACTION_FAILED",
        failureMessage: "Could not automatically read this receipt/invoice. Fill in the details manually below.",
      },
    });

    try {
      await AttachmentService.upload(userId, { type: "importedTransaction", id: importedTx.id }, file.name, buffer);
    } catch (err) {
      console.error("[imports/receipt] Failed to attach uploaded file to import", err);
    }

    return NextResponse.json({
      outcome: "extraction_failed",
      importedTransactionId: importedTx.id,
      parsedAmount: null,
      currency: null,
      vendor: null,
    }, { status: 202 });
  }

  const result = await db.$transaction(async (tx) => {
    const primaryAccount = await accountService.getPrimaryAccount(userId, tx);
    const account = primaryAccount ?? (await accountService.ensureAccountForInstitution(
      userId,
      { type: AccountType.OTHER_BANK, name: "Receipts" },
      tx
    ));

    let category = await tx.category.findFirst({
      where: { userId, name: { equals: "Uncategorized", mode: "insensitive" } },
    });
    if (!category) {
      category = await tx.category.create({
        data: { userId, name: "Uncategorized", type: CategoryType.VARIABLE_EXPENSE },
      });
    }

    const financialDate = extraction.transactionDate ?? now;

    const ledgerTx = await tx.transaction.create({
      data: {
        userId,
        date: financialDate,
        categoryId: category.id,
        description: extraction.description || extraction.vendor || "Receipt Upload",
        amount: new Prisma.Decimal(extraction.amount.toFixed(2)),
        paymentMethod: "Receipt Upload",
        type: TransactionType.EXPENSE,
        cashFlowDirection: CashFlowDirection.OUTFLOW,
        origin: TransactionOrigin.DOCUMENT_IMPORT,
        accountId: account.id,
      },
    });

    await accountService.updateAccountBalance(userId, account.id, tx);

    const importedTx = await tx.importedTransaction.create({
      data: {
        userId,
        source: ImportSource.DOCUMENT,
        institution: extraction.vendor || "Receipt Upload",
        status: ImportStatus.PROCESSED,
        extractionMethod: "AI_VISION",
        payloadHash,
        fingerprint: payloadHash,
        receivedAt: now,
        financialDate,
        parsedAmount: new Prisma.Decimal(extraction.amount.toFixed(2)),
        parsedCurrency: extraction.currency,
        parsedDescription: extraction.description ?? extraction.vendor ?? null,
        transactionId: ledgerTx.id,
        processedAt: now,
      },
    });

    await tx.notification.create({
      data: {
        userId,
        type: NotificationType.IMPORT_AUTO_POSTED,
        severity: NotificationSeverity.INFO,
        title: "Receipt imported",
        message: `${extraction.currency} ${extraction.amount.toFixed(2)} at ${extraction.vendor || "unknown vendor"} was read from your receipt and posted to ${account.name}. Check the amount if it looks off.`,
        eventKey: `receipt-auto-posted-${importedTx.id}`,
        relatedEntityType: "Transaction",
        relatedEntityId: ledgerTx.id,
        destinationPath: "/transactions",
      },
    });

    return { transactionId: ledgerTx.id, importedTransactionId: importedTx.id };
  });

  try {
    await AttachmentService.upload(userId, { type: "importedTransaction", id: result.importedTransactionId }, file.name, buffer);
  } catch (err) {
    // The transaction already posted successfully — degrade gracefully
    // rather than losing that over a storage-quota/limit error on the
    // attachment itself.
    console.error("[imports/receipt] Failed to attach uploaded file to import", err);
  }

  return NextResponse.json({
    outcome: "processed",
    transactionId: result.transactionId,
    importedTransactionId: result.importedTransactionId,
    parsedAmount: extraction.amount.toFixed(2),
    currency: extraction.currency,
    vendor: extraction.vendor ?? null,
  }, { status: 200 });
}
