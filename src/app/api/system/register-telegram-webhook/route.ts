import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

function verifySecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");

  // timingSafeEqual requires equal-length buffers
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifySecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
  const WEBHOOK_URL = "https://budgetflow-drab-nine.vercel.app/api/integrations/telegram/webhook";

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "register";

  if (!BOT_TOKEN || BOT_TOKEN === "mock-bot-token") {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not configured on Vercel." }, { status: 400 });
  }

  if (action === "status") {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      return NextResponse.json({ action: "status", webhookInfo: data });
    } catch (err) {
      return NextResponse.json({
        error: "Failed to get webhook status",
        details: err instanceof Error ? err.message : String(err)
      }, { status: 500 });
    }
  }

  if (!WEBHOOK_SECRET || WEBHOOK_SECRET === "mock-webhook-secret") {
    return NextResponse.json({ error: "TELEGRAM_WEBHOOK_SECRET is not configured on Vercel." }, { status: 400 });
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message", "edited_message"],
      }),
    });
    const data = await response.json();
    return NextResponse.json({ action: "register", telegramResponse: data });
  } catch (err) {
    return NextResponse.json({
      error: "Failed to register webhook",
      details: err instanceof Error ? err.message : String(err)
    }, { status: 500 });
  }
}
