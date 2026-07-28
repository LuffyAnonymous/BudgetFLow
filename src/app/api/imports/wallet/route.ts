import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { importSettingService } from "@/server/services/import-setting.service";
import { accountService } from "@/server/services/account.service";
import {
  ImportSource,
  ImportStatus,
  ImportConfidence,
  TransactionType,
  TransactionOrigin,
  CashFlowDirection,
  AccountType,
  CategoryType,
} from "@prisma/client";

const AppleWalletBodySchema = z.object({
  merchant: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().length(3).optional().default("AED"),
  card: z.string().trim().optional(),
  date: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
}).refine(data => data.merchant || data.name, {
  message: "At least one of 'merchant' or 'name' must be provided",
  path: ["merchant", "name"]
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Apple Wallet Import] Request received");

  // 1. Authenticate
  const authHeader = req.headers.get("authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!rawToken) {
    console.log("[Apple Wallet Import] Unauthorized: missing or malformed Authorization header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await importSettingService.resolveUserFromToken(rawToken);
  if (!userId) {
    console.log("[Apple Wallet Import] Unauthorized: invalid token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse & Validate Body
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.log("[Apple Wallet Import] 400 Bad Request: Failed to parse request body as JSON", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AppleWalletBodySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.log("[Apple Wallet Import] 400 Bad Request: Zod validation failed", fieldErrors);
    return NextResponse.json({ error: "Invalid request", fieldErrors }, { status: 400 });
  }

  const { merchant, name, amount, currency, card, date: dateStr, idempotencyKey } = parsed.data;
  const normalizedMerchant = merchant || name || "Unknown Merchant";
  const cardLower = card ? card.toLowerCase() : "";

  // Safe structured logging
  console.log("[Apple Wallet Import] Parsed payload metadata:", {
    merchantLength: normalizedMerchant.length,
    amount,
    currency,
    hasCard: !!card,
    hasDate: !!dateStr,
    hasIdempotencyKey: !!idempotencyKey,
  });

  try {
    // 3. Duplicate Detection
    // Priority 1: idempotencyKey
    if (idempotencyKey) {
      const existing = await db.importedTransaction.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) {
        console.log("[Apple Wallet Import] 409 Conflict: Duplicate request detected by idempotencyKey", { idempotencyKey });
        return NextResponse.json({ error: "Duplicate transaction detected (idempotency)" }, { status: 409 });
      }
    }

    // Priority 2: fingerprint
    let fingerprintDateStr = "";
    if (dateStr) {
      fingerprintDateStr = new Date(dateStr).toISOString();
    } else {
      // Bounded duplicate strategy: round current time to nearest 5 minutes
      const now = new Date();
      const ms = 5 * 60 * 1000;
      const roundedDate = new Date(Math.round(now.getTime() / ms) * ms);
      fingerprintDateStr = roundedDate.toISOString();
    }

    const rawFingerprint = `${userId}_${amount.toFixed(2)}_${currency.toUpperCase()}_${normalizedMerchant.toLowerCase()}_${fingerprintDateStr}_${cardLower}`;
    const fingerprint = createHash("sha256").update(rawFingerprint).digest("hex");

    const existingByFingerprint = await db.importedTransaction.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true },
    });

    if (existingByFingerprint) {
      console.log("[Apple Wallet Import] 409 Conflict: Duplicate transaction detected by fingerprint", { fingerprintPrefix: fingerprint.slice(0, 10) });
      return NextResponse.json({ error: "Duplicate transaction detected (fingerprint)" }, { status: 409 });
    }

    const payloadHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const dateObj = dateStr ? new Date(dateStr) : new Date();

    // 4. Resolve Account mapping
    const result = await db.$transaction(async (tx) => {
      await accountService.ensureDefaultAccounts(userId, tx);
      const accounts = await tx.account.findMany({ where: { userId } });
      const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;

      let primaryAccId: string | null = null;
      if (cardLower.includes("emirates nbd") || cardLower.includes("enbd")) {
        primaryAccId = enbdAcc.id;
      } else {
        const walletAcc = accounts.find((a) => a.name.toLowerCase() === "wallet import");
        if (walletAcc) {
          primaryAccId = walletAcc.id;
        }
      }

      if (!primaryAccId) {
        // Unknown card: Save as REVIEW_REQUIRED
        console.log("[Apple Wallet Import] Card is unmapped/unknown. Saving as review required.", { card });
        
        const importedTx = await tx.importedTransaction.create({
          data: {
            userId,
            source: ImportSource.APPLE_WALLET,
            institution: card || "Unknown Wallet",
            status: ImportStatus.REVIEW_REQUIRED,
            confidence: ImportConfidence.LOW,
            rawPayload: JSON.stringify(parsed.data),
            payloadHash,
            fingerprint,
            idempotencyKey: idempotencyKey || null,
            receivedAt: dateObj,
            financialDate: dateObj,
            parsedAmount: amount,
            parsedCurrency: currency.toUpperCase(),
            parsedDescription: normalizedMerchant,
            failureCode: "UNKNOWN_CARD",
            failureMessage: "The card associated with the wallet transaction is unknown.",
          },
        });

        return { outcome: "review_required" as const, importedTransactionId: importedTx.id };
      }

      // Auto-Post Expense
      console.log("[Apple Wallet Import] Auto-posting transaction", { primaryAccId });

      // Resolve category: Uncategorized or fallback
      let categoryId: string;
      const dbCategory = await tx.category.findFirst({
        where: { userId, name: { equals: "Uncategorized", mode: "insensitive" } }
      });
      if (dbCategory) {
        categoryId = dbCategory.id;
      } else {
        const fallback = await tx.category.findFirst({
          where: { userId, type: { in: [CategoryType.VARIABLE_EXPENSE, CategoryType.FIXED_EXPENSE] } }
        });
        if (!fallback) {
          throw new Error("No expense category found for user");
        }
        categoryId = fallback.id;
      }

      // Create Ledger Transaction
      const ledgerTx = await tx.transaction.create({
        data: {
          userId,
          date: dateObj,
          categoryId,
          description: normalizedMerchant,
          amount,
          paymentMethod: card || "Apple Wallet",
          type: TransactionType.EXPENSE,
          cashFlowDirection: CashFlowDirection.OUTFLOW,
          origin: TransactionOrigin.APPLE_WALLET,
          accountId: primaryAccId,
        },
      });

      // Update balance using normal transaction creation flow (updates account balance)
      await accountService.updateAccountBalance(userId, primaryAccId, tx);

      // Create ImportedTransaction tracking record
      const importedTx = await tx.importedTransaction.create({
        data: {
          userId,
          source: ImportSource.APPLE_WALLET,
          institution: card || "Apple Wallet",
          status: ImportStatus.PROCESSED,
          confidence: ImportConfidence.HIGH,
          rawPayload: JSON.stringify(parsed.data),
          payloadHash,
          fingerprint,
          idempotencyKey: idempotencyKey || null,
          receivedAt: dateObj,
          financialDate: dateObj,
          parsedAmount: amount,
          parsedCurrency: currency.toUpperCase(),
          parsedDescription: normalizedMerchant,
          transactionId: ledgerTx.id,
          processedAt: new Date(),
        },
      });

      return {
        outcome: "processed" as const,
        transactionId: ledgerTx.id,
        importedTransactionId: importedTx.id,
      };
    });

    if (result.outcome === "review_required") {
      return NextResponse.json({
        success: true,
        outcome: "review_required",
        importedTransactionId: result.importedTransactionId,
        merchant: normalizedMerchant,
        amount,
        currency: currency.toUpperCase(),
      }, { status: 202 });
    }

    return NextResponse.json({
      success: true,
      outcome: "processed",
      transactionId: result.transactionId,
      merchant: normalizedMerchant,
      amount,
      currency: currency.toUpperCase(),
    }, { status: 200 });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Apple Wallet Import] 500 Internal Server Error", err);
    return NextResponse.json({ error: "Internal server error occurred", reason: errorMsg }, { status: 500 });
  }
}
