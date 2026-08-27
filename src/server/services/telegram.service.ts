import "server-only";

import { db } from "@/lib/db";

/**
 * Sends a Telegram message to a user's linked chat (ImportSetting.telegramChatId,
 * set via the "/link <code>" self-serve flow in telegram/webhook/route.ts).
 *
 * Used for passive, system-initiated notifications (a SMS auto-import that
 * needs a second look, or one that failed to parse). The Telegram webhook
 * route itself never calls this — it already replies to every message a
 * user sends the bot directly, and wiring both would double-send.
 */
async function sendToUser(userId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "mock-bot-token") {
    console.warn("[Telegram Service] Bot token not configured or is mock-bot-token. Skipping send.");
    return false;
  }

  const setting = await db.importSetting.findUnique({
    where: { userId },
    select: { telegramChatId: true },
  });

  if (!setting?.telegramChatId) {
    console.warn("[Telegram Service] User has no linked Telegram chat. Skipping send.", { userId });
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: setting.telegramChatId, text }),
    });
    if (!res.ok) {
      console.error("[Telegram Service] Failed to send message:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Telegram Service] Exception sending message:", err);
    return false;
  }
}

export const telegramService = { sendToUser };
