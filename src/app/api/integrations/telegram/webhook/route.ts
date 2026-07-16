import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function detectBankAndCleanText(text: string): { bank: string; cleanText: string } {
  const trimmed = text.trim();
  const lowerText = trimmed.toLowerCase();

  // 1. Check for prefix override (e.g., "ENBD:\n...", "Mashreq: ...", "Tabby: ...")
  const prefixMatch = trimmed.match(/^(enbd|emirates nbd|mashreq|tabby)\s*:\s*([\s\S]+)$/i);
  if (prefixMatch) {
    const rawBank = prefixMatch[1].toLowerCase();
    const cleanText = prefixMatch[2].trim();
    let bank = "Unknown";
    if (rawBank === "enbd" || rawBank === "emirates nbd") {
      bank = "ENBD";
    } else if (rawBank === "mashreq") {
      bank = "MASHREQ";
    } else if (rawBank === "tabby") {
      bank = "Tabby";
    }
    return { bank, cleanText };
  }

  // 2. Automatic detection based on keywords
  if (lowerText.includes("emirates nbd") || lowerText.includes("enbd")) {
    return { bank: "ENBD", cleanText: trimmed };
  } else if (lowerText.includes("mashreq")) {
    return { bank: "MASHREQ", cleanText: trimmed };
  } else if (lowerText.includes("tabby")) {
    return { bank: "Tabby", cleanText: trimmed };
  }

  return { bank: "Unknown", cleanText: trimmed };
}

async function sendTelegramReply(chatId: number, text: string, replyToMessageId: number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "mock-bot-token") {
    console.warn("[Telegram Bot] Bot token not configured or is mock-bot-token. Skipping reply.");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_to_message_id: replyToMessageId,
      }),
    });
    if (!res.ok) {
      console.error("[Telegram Bot] Failed to send reply to Telegram:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Telegram Bot] Exception sending reply to Telegram:", err);
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Telegram Webhook] Request received");

  // 1. Verify Secret Token Header
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

  if (!expectedSecret || !safeCompare(secretHeader, expectedSecret)) {
    console.log("[Telegram Webhook] Unauthorized: missing or invalid secret token header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse payload
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    console.log("[Telegram Webhook] 400 Bad Request: Failed to parse body as JSON", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateId = body.update_id;
  const messageObj = body.message || body.edited_message;

  if (!messageObj || typeof messageObj.text !== "string") {
    console.log("[Telegram Webhook] Ignored update: no message text found", { updateId });
    return NextResponse.json({ success: true, ignored: true });
  }

  const chatId = messageObj.chat?.id;
  const messageId = messageObj.message_id;
  const dateUnix = messageObj.date;

  // 3. Verify Chat ID
  const allowedIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  const isAllowed = allowedIds.includes(String(chatId));

  // Safe logging
  console.log("[Telegram Webhook] Message metadata:", {
    updateId,
    messageId,
    chatId,
    isAllowed,
    textLength: messageObj.text.length,
  });

  if (!isAllowed) {
    console.log("[Telegram Webhook] Chat not authorized:", { chatId });
    return NextResponse.json({ success: true, ignored: true, reason: "unauthorized" });
  }

  // 4. Bank & Text Extraction
  const { bank, cleanText } = detectBankAndCleanText(messageObj.text);
  console.log("[Telegram Webhook] Bank detection result:", { bank });

  // 5. Deduplication Idempotency Key
  const idempotencyKey = `telegram_${updateId}`;

  // 6. Run SMS Engine
  const receivedAt = dateUnix ? new Date(dateUnix * 1000) : new Date();

  let replyText = "";
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) {
      console.error("[Telegram Webhook] No user found in database");
      replyText = "❌ Import failed\nReason: No user account found on the server.";
    } else {
      const result = await importService.processSms(user.id, {
        sender: bank,
        message: cleanText,
        receivedAt,
        idempotencyKey,
      });

      console.log("[Telegram Webhook] SMS processing outcome:", {
        outcome: result.outcome,
        importedTransactionId: "importedTransactionId" in result ? result.importedTransactionId : undefined,
      });

      if (result.outcome === "auto_posted" && "transactionId" in result) {
        const ledgerTx = await db.transaction.findUnique({
          where: { id: result.transactionId },
          include: { category: true, account: true },
        });

        if (ledgerTx) {
          const amountVal = Number(ledgerTx.amount).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const bankName = ledgerTx.account?.name || "Unknown Bank";
          const typeName = ledgerTx.category?.name || "Expense";
          replyText = `✅ Imported\nBank: ${bankName}\nType: ${typeName}\nAmount: AED ${amountVal}\nAccount: ${bankName}`;
        } else {
          replyText = "✅ Imported\nDetails: Transaction was successfully posted.";
        }
      } else if (result.outcome === "review_required") {
        const reason = "reason" in result && result.reason ? result.reason : "Could not confidently identify the transaction type.";
        replyText = `⚠️ Saved for review\nReason: ${reason}`;
      } else if (result.outcome === "duplicate" || result.outcome === "idempotent") {
        replyText = "ℹ️ Already imported";
      } else {
        const reason = "reason" in result && result.reason ? result.reason : "Could not extract transaction amount.";
        replyText = `❌ Import failed\nReason: ${reason}`;
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Telegram Webhook] Server error while processing import:", err);
    replyText = "❌ Import failed\nReason: Internal server error occurred.";
  }

  // 7. Send Telegram Reply
  await sendTelegramReply(chatId, replyText, messageId);

  return NextResponse.json({ success: true });
}
