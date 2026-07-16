import dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const WEBHOOK_URL = "https://budgetflow-drab-nine.vercel.app/api/integrations/telegram/webhook";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "register";

  if (!BOT_TOKEN || BOT_TOKEN === "mock-bot-token") {
    console.error("Error: TELEGRAM_BOT_TOKEN is not configured or is mock-bot-token.");
    process.exit(1);
  }

  if (command === "register") {
    if (!WEBHOOK_SECRET || WEBHOOK_SECRET === "mock-webhook-secret") {
      console.error("Error: TELEGRAM_WEBHOOK_SECRET is not configured or is mock-webhook-secret.");
      process.exit(1);
    }
    console.log(`Registering webhook URL: ${WEBHOOK_URL}...`);
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
      console.log("Response from Telegram setWebhook:", data);
    } catch (err) {
      console.error("Failed to register webhook:", err);
    }
  } else if (command === "status") {
    console.log("Checking webhook status...");
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      console.log("Response from Telegram getWebhookInfo:", data);
    } catch (err) {
      console.error("Failed to get webhook status:", err);
    }
  } else {
    console.log("Unknown command. Supported commands: register, status");
  }
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
