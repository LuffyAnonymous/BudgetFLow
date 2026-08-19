/**
 * POST /api/integrations/n8n/sms-relay
 *
 * Public-facing relay so an iPhone Shortcut (or any external client) can
 * reach the n8n SMS Import webhook, which now runs on an always-on Oracle
 * Cloud instance (behind Caddy for HTTPS via sslip.io) rather than the
 * developer's laptop — so imports keep working regardless of whether any
 * local machine is on.
 *
 * Auth is a shared secret (X-BudgetFlow-Webhook-Secret / N8N_SMS_WEBHOOK_SECRET),
 * the same secret n8n's own "Check Secret" node validates — checked here too
 * so unauthenticated traffic never reaches n8n at all. This route does not
 * parse, validate, categorize, or create anything — it only forwards.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

const N8N_SMS_WEBHOOK_URL = "https://n8n.139-185-51-120.sslip.io/webhook/budgetflow/sms-import";
const RELAY_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 10 * 1024; // 10 KB

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const configuredSecret = process.env.N8N_SMS_WEBHOOK_SECRET;
  const incomingSecret = request.headers.get("x-budgetflow-webhook-secret") ?? "";

  if (!configuredSecret || !incomingSecret || !safeCompare(incomingSecret, configuredSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // The caller's own bf_import_... token — n8n's "Normalize Payload" node
  // reads this straight off the incoming request headers and forwards it
  // unchanged to /api/imports/sms to identify whose account to post to.
  // Without relaying it here, every request reaches n8n with no token at
  // all and is rejected downstream with no trace (a 401 there happens
  // before any ImportedTransaction row or audit log entry is created).
  const authorization = request.headers.get("authorization") ?? "";

  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const n8nResponse = await fetch(N8N_SMS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BudgetFlow-Webhook-Secret": incomingSecret,
        "Authorization": authorization,
      },
      body: bodyText,
      signal: controller.signal,
    });

    const responseText = await n8nResponse.text();
    let responseJson: unknown;
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseJson = { ok: false, error: "n8n returned a non-JSON response" };
    }

    return NextResponse.json(responseJson, { status: n8nResponse.status });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.error("[sms-relay] Failed to reach n8n:", error);
    return NextResponse.json(
      { ok: false, error: isAbort ? "n8n request timed out" : "Failed to reach n8n" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
