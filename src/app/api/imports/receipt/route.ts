import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportSource, ImportStatus, Prisma } from "@prisma/client";
import { validateFileMagicBytes } from "@/server/utils/file-magic";
import { MAX_FILE_SIZE_BYTES, AttachmentService } from "@/server/services/attachment.service";
import { extractReceiptTransaction } from "@/imports/engine/ai-receipt-extractor";

/**
 * POST /api/imports/receipt
 * Upload a photographed/scanned receipt or PDF invoice. The transaction is
 * extracted via AI vision and always lands as a REVIEW_REQUIRED import —
 * unlike a bank SMS, there's no available-balance to cross-check a receipt
 * against, so this never auto-posts.
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

  // Same content re-uploaded — treat as a duplicate of the existing review item.
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

  const importedTx = await db.importedTransaction.create({
    data: {
      userId,
      source: ImportSource.DOCUMENT,
      institution: extraction?.vendor || "Receipt Upload",
      status: ImportStatus.REVIEW_REQUIRED,
      extractionMethod: "AI_VISION",
      payloadHash,
      fingerprint: payloadHash,
      receivedAt: now,
      financialDate: extraction?.transactionDate ?? now,
      parsedAmount: extraction ? new Prisma.Decimal(extraction.amount.toFixed(2)) : null,
      parsedCurrency: extraction?.currency ?? null,
      parsedDescription: extraction?.description ?? extraction?.vendor ?? null,
      failureCode: extraction ? null : "EXTRACTION_FAILED",
      failureMessage: extraction
        ? null
        : "Could not automatically read this receipt/invoice. Fill in the details manually below.",
    },
  });

  try {
    await AttachmentService.upload(userId, { type: "importedTransaction", id: importedTx.id }, file.name, buffer);
  } catch (err) {
    // The extraction (or extraction-failed placeholder) is still useful on
    // its own — degrade gracefully rather than losing the review item over
    // a storage-quota/limit error on the attachment itself.
    console.error("[imports/receipt] Failed to attach uploaded file to import", err);
  }

  return NextResponse.json({
    outcome: extraction ? "review_required" : "extraction_failed",
    importedTransactionId: importedTx.id,
    parsedAmount: extraction?.amount.toFixed(2) ?? null,
    currency: extraction?.currency ?? null,
    vendor: extraction?.vendor ?? null,
  }, { status: 202 });
}
