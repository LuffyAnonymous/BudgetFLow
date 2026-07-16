import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
import { checkRateLimit } from "@/lib/rate-limiter";
import { TransactionType } from "@prisma/client";

const MAX_BODY_BYTES = 10 * 1024; // 10 KB

const ShortcutSmsSchema = z.object({
  sender: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
});

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function resolveUserFromShortcutToken(rawToken: string): Promise<string | null> {
  const configuredToken = process.env.IOS_SHORTCUT_IMPORT_TOKEN;
  if (!configuredToken) {
    console.error("[Shortcut Ingestion] Error: IOS_SHORTCUT_IMPORT_TOKEN is not set in environment.");
    return null;
  }

  // 1. Support map format token1:userId1,token2:userId2
  if (configuredToken.includes(":")) {
    const mappings = configuredToken.split(",");
    for (const mapping of mappings) {
      const parts = mapping.trim().split(":");
      if (parts.length === 2) {
        const [tok, uid] = parts;
        if (safeCompare(tok.trim(), rawToken)) {
          // Validate user exists
          const user = await db.user.findUnique({
            where: { id: uid.trim() },
            select: { id: true },
          });
          if (user) return user.id;
        }
      }
    }
    return null;
  }

  // 2. Support single token fallback mapping to the first user in system
  if (safeCompare(configuredToken.trim(), rawToken)) {
    const firstUser = await db.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return firstUser?.id || null;
  }

  return null;
}

async function sendTelegramConfirmation(userId: string, replyText: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatUserMapStr = process.env.TELEGRAM_CHAT_USER_MAP ?? "";
  if (!token || token === "mock-bot-token" || !chatUserMapStr) {
    return false;
  }

  // Find chatId for the user ID
  let chatId: string | null = null;
  const entries = chatUserMapStr.split(",");
  for (const entry of entries) {
    const parts = entry.trim().split(":");
    if (parts.length === 2) {
      const [cId, uId] = parts;
      if (uId.trim() === userId) {
        chatId = cId.trim();
        break;
      }
    }
  }

  if (!chatId) {
    console.warn(`[Shortcut Ingestion] Telegram mapping not found for user: ${userId}`);
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text: replyText,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Shortcut Ingestion] Exception sending Telegram confirmation:", err);
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Shortcut Ingestion] Request received");

  // 1. Authenticate
  const authHeader = req.headers.get("authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!rawToken) {
    console.log("[Shortcut Ingestion] Unauthorized: missing or malformed Authorization header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await resolveUserFromShortcutToken(rawToken);
  if (!userId) {
    console.log("[Shortcut Ingestion] Unauthorized: invalid token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limiting
  const tokenHashPrefix = createHash("sha256").update(rawToken).digest("hex").slice(0, 16);
  const rateLimit = await checkRateLimit(`shortcut_import:${tokenHashPrefix}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.resetInMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // 3. Body size guard
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  // 4. Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.log("[Shortcut Ingestion] 400 Bad Request: Failed to parse JSON", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ShortcutSmsSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.log("[Shortcut Ingestion] 400 Bad Request: Zod validation failed", fieldErrors);
    return NextResponse.json({ error: "Invalid request", fieldErrors }, { status: 400 });
  }

  const { sender, message } = parsed.data;

  // Safe structured logging (no token, raw text, card numbers, or account numbers)
  console.log("[Shortcut Ingestion] Processing SMS metadata:", {
    senderLength: sender.length,
    messageLength: message.length,
    userId,
  });

  try {
    const result = await importService.processSms(userId, {
      sender,
      message,
      receivedAt: new Date(),
    });

    console.log("[Shortcut Ingestion] ProcessSms outcome:", {
      outcome: result.outcome,
      importedTransactionId: "importedTransactionId" in result ? result.importedTransactionId : undefined,
    });

    let jsonResponse: Record<string, any>;
    let telegramMessage = "";

    if (result.outcome === "auto_posted" && "transactionId" in result) {
      const ledgerTx = await db.transaction.findUnique({
        where: { id: result.transactionId },
        include: { account: true, category: true },
      });

      if (ledgerTx) {
        const typeWord = ledgerTx.type === TransactionType.INCOME ? "Income"
                         : ledgerTx.type === TransactionType.TRANSFER ? "Transfer"
                         : "Expense";
        const bankName = ledgerTx.account?.name || sender;
        const amountStr = Number(ledgerTx.amount).toFixed(2);
        const balanceStr = ledgerTx.account?.currentBalance ? Number(ledgerTx.account.currentBalance).toFixed(2) : "0.00";

        telegramMessage = `✅ ${typeWord} imported\nBank: ${bankName}\nAmount: AED ${amountStr}\nBalance: AED ${balanceStr}`;

        jsonResponse = {
          outcome: "processed",
          bank: bankName,
          type: ledgerTx.type,
          amount: amountStr,
          balance: balanceStr,
        };
      } else {
        telegramMessage = "✅ Transaction imported successfully.";
        jsonResponse = { outcome: "processed" };
      }
    } else if (result.outcome === "review_required") {
      const reason = "reason" in result && result.reason ? result.reason : "Could not confidently identify the transaction type.";
      telegramMessage = `⚠️ Saved for review\nReason: ${reason}`;
      jsonResponse = { outcome: "review_required", reason };
    } else if (result.outcome === "duplicate" || result.outcome === "idempotent") {
      telegramMessage = "ℹ️ Already imported";
      jsonResponse = { outcome: "duplicate" };
    } else {
      const reason = "reason" in result && result.reason ? result.reason : "No supported parser matched the SMS format.";
      telegramMessage = `❌ Import rejected\nReason: ${reason}`;
      jsonResponse = { outcome: "rejected", reason };
    }

    // Try sending Telegram notification
    await sendTelegramConfirmation(userId, telegramMessage);

    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error("[Shortcut Ingestion] Server error while processing import:", err);
    const reason = err instanceof Error ? err.message : "Internal server error";
    const telegramMessage = `❌ Import failed\nReason: ${reason}`;
    await sendTelegramConfirmation(userId, telegramMessage);
    return NextResponse.json({ error: "Internal server error", details: reason }, { status: 500 });
  }
}
