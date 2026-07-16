import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<NextResponse> {
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
