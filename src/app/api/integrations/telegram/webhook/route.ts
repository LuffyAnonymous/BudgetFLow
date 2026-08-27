import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";

interface TelegramMessage {
  text?: string;
  chat?: { id: number | string };
  message_id?: number;
  date?: number;
}

interface TelegramUpdate {
  update_id?: number;
  edited_message?: unknown;
  message?: TelegramMessage;
}

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

  // 1. Check for prefix override (e.g., "ENBD:\n...", "Tabby: ...")
  const prefixMatch = trimmed.match(/^(enbd|emirates nbd|tabby)\s*:\s*([\s\S]+)$/i);
  if (prefixMatch) {
    const rawBank = prefixMatch[1].toLowerCase();
    const cleanText = prefixMatch[2].trim();
    let bank = "Unknown";
    if (rawBank === "enbd" || rawBank === "emirates nbd") {
      bank = "ENBD";
    } else if (rawBank === "tabby") {
      bank = "Tabby";
    }
    return { bank, cleanText };
  }

  // 2. Automatic detection based on keywords
  if (lowerText.includes("emirates nbd") || lowerText.includes("enbd")) {
    return { bank: "ENBD", cleanText: trimmed };
  } else if (lowerText.includes("tabby")) {
    return { bank: "Tabby", cleanText: trimmed };
  }

  return { bank: "Unknown", cleanText: trimmed };
}

async function sendTelegramReply(chatId: number | string, text: string, replyToMessageId: number): Promise<boolean> {
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
  let body: TelegramUpdate;
  try {
    body = await req.json();
  } catch (err) {
    console.log("[Telegram Webhook] 400 Bad Request: Failed to parse body as JSON", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateId = body.update_id;

  // Ignore edited_message updates (only process new message updates)
  if (body.edited_message) {
    console.log("[Telegram Webhook] Ignored update: edited_message is ignored", { updateId });
    return NextResponse.json({ success: true, ignored: true, reason: "edited_message ignored" });
  }

  const messageObj = body.message;
  if (
    !messageObj ||
    typeof messageObj.text !== "string" ||
    messageObj.chat?.id === undefined ||
    typeof messageObj.message_id !== "number"
  ) {
    console.log("[Telegram Webhook] Ignored update: no message text found", { updateId });
    return NextResponse.json({ success: true, ignored: true });
  }

  const chatId = messageObj.chat.id;
  const messageId = messageObj.message_id;
  const dateUnix = messageObj.date;
  const chatIdStr = String(chatId);

  // 3. "/link <code>" — self-serve linking. A user generates a one-time code
  // in Settings, then DMs the bot to associate their chat with their account.
  const linkMatch = messageObj.text.trim().match(/^\/link\s+(\S+)/i);
  if (linkMatch) {
    const code = linkMatch[1].trim();
    const setting = await db.importSetting.findUnique({
      where: { telegramLinkCode: code },
      select: { userId: true, telegramLinkCodeExpiresAt: true },
    });

    if (!setting || !setting.telegramLinkCodeExpiresAt || setting.telegramLinkCodeExpiresAt < new Date()) {
      await sendTelegramReply(chatId, "That code is invalid or has expired. Generate a new one from Settings.", messageId);
      return NextResponse.json({ success: true, ignored: true, reason: "invalid_link_code" });
    }

    await db.importSetting.update({
      where: { userId: setting.userId },
      data: { telegramChatId: chatIdStr, telegramLinkCode: null, telegramLinkCodeExpiresAt: null },
    });
    await db.auditLog.create({
      data: {
        userId: setting.userId,
        action: "TELEGRAM_LINKED",
        entityType: "IMPORT_SETTING",
        source: "TELEGRAM",
        metadata: { chatId: chatIdStr },
      },
    });

    await sendTelegramReply(chatId, "Telegram connected. Forward bank SMS text here and it'll be imported into your account.", messageId);
    return NextResponse.json({ success: true, linked: true });
  }

  // 4. Resolve BudgetFlow user from the chat this message came from
  const setting = await db.importSetting.findUnique({
    where: { telegramChatId: chatIdStr },
    select: { userId: true },
  });
  const userId = setting?.userId;

  if (!userId) {
    console.log("[Telegram Webhook] Unlinked chat ID:", { chatId });
    await sendTelegramReply(chatId, "This Telegram chat isn't connected to a BudgetFlow account yet. Generate a link code from Settings and send \"/link <code>\" here.", messageId);
    return NextResponse.json({ success: true, ignored: true, reason: "unlinked chat ID" });
  }

  // Safe logging
  console.log("[Telegram Webhook] Message metadata:", {
    updateId,
    messageId,
    chatId,
    userId,
    textLength: messageObj.text.length,
  });

  // 5. Bank & Text Extraction
  const { bank, cleanText } = detectBankAndCleanText(messageObj.text);
  console.log("[Telegram Webhook] Bank detection result:", { bank });

  // 6. Deduplication Idempotency Key (telegram:<chatId>:<messageId>)
  const idempotencyKey = `telegram:${chatId}:${messageId}`;

  // 7. Run SMS Engine
  const receivedAt = dateUnix ? new Date(dateUnix * 1000) : new Date();

  let replyText = "";
  try {
    const result = await importService.processSms(userId, {
      sender: bank,
      message: cleanText,
      receivedAt,
      idempotencyKey,
    });

    console.log("[Telegram Webhook] SMS processing outcome:", {
      outcome: result.outcome,
      importedTransactionId: "importedTransactionId" in result ? result.importedTransactionId : undefined,
    });

    if (result.outcome === "auto_posted") {
      const ledgerTx = await db.transaction.findUnique({
        where: { id: result.transactionId },
        include: { category: true, account: true },
      });

      const needsSecondLook = result.confidence !== "HIGH" || result.directionAmbiguous;
      const flagLine = needsSecondLook
        ? `\n⚠️ Needs a second look: ${result.directionAmbiguous ? "direction was ambiguous" : `${result.confidence.toLowerCase()} confidence`}`
        : "";

      if (ledgerTx) {
        const amountVal = Number(ledgerTx.amount).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const bankName = ledgerTx.account?.name || "Unknown Bank";
        const typeName = ledgerTx.category?.name || "Expense";
        replyText = `✅ Imported\nBank: ${bankName}\nType: ${typeName}\nAmount: AED ${amountVal}\nAccount: ${bankName}${flagLine}`;
      } else {
        replyText = `✅ Imported\nDetails: Transaction was successfully posted.${flagLine}`;
      }
    } else if (result.outcome === "duplicate" || result.outcome === "idempotent") {
      replyText = "ℹ️ Already imported";
    } else if (result.outcome === "failed") {
      replyText = `❌ Import failed\nReason: ${result.reason}`;
    } else {
      const reason = "reason" in result && result.reason ? result.reason : "Message was not imported.";
      replyText = `ℹ️ Not imported\nReason: ${reason}`;
    }
  } catch (err) {
    console.error("[Telegram Webhook] Server error while processing import:", err);
    replyText = "❌ Import failed\nReason: Internal server error occurred.";
  }

  // 8. Send Telegram Reply
  await sendTelegramReply(chatId, replyText, messageId);

  return NextResponse.json({ success: true });
}
