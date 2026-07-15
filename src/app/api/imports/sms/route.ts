/**
 * POST /api/imports/sms
 *
 * SMS import webhook endpoint.
 *
 * Authentication:
 *   Authorization: Bearer <import-token>
 *   userId is resolved from the token. Never from the request body.
 *
 * Request body (JSON, max 10 KB):
 *   {
 *     "sender":     string (required, max 100 chars)
 *     "message":    string (required, max 2000 chars)
 *     "receivedAt": string (required, ISO 8601 timestamp)
 *     "deviceId":   string | null (optional, metadata only, not trusted for auth)
 *   }
 *
 * Idempotency:
 *   Idempotency-Key: <uuid>  (optional header)
 *   Same key = same result returned without re-processing.
 *
 * Rate limiting: 20 requests / 60 s per token.
 *
 * Response:
 *   200 OK — processed | review_required | duplicate | idempotent
 *   400 — invalid request body
 *   401 — missing or invalid token
 *   429 — rate limit exceeded
 *   503 — import engine disabled for this user
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importSettingService } from "@/server/services/import-setting.service";
import { importService } from "@/imports/engine/import.service";
import { checkRateLimit } from "@/lib/rate-limiter";
import { createHash } from "crypto";

const MAX_BODY_BYTES = 10 * 1024; // 10 KB

const SmsWebhookBodySchema = z.object({
  sender: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
  receivedAt: z.string().nullish(),
  deviceId: z.string().max(100).nullish(),
});

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[Auth Debug] POST /api/imports/sms invoked");
  
  // ── 1. Extract Bearer token ─────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const xApiKey = req.headers.get("x-api-key");
  
  console.log("[Auth Debug] Headers check:", {
    hasAuthorization: !!authHeader,
    authorizationStartsWithBearer: authHeader.startsWith("Bearer "),
    hasXApiKey: !!xApiKey,
  });

  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  console.log("[Auth Debug] rawToken extracted:", !!rawToken);
  if (!rawToken) {
    console.log("[Auth Debug] Unauthorized: No rawToken extracted from Authorization header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Resolve user from token (timing-safe) ─────────────────────────────────
  const userId = await importSettingService.resolveUserFromToken(rawToken);
  console.log("[Auth Debug] resolved userId:", userId);
  if (!userId) {
    console.log("[Auth Debug] Unauthorized: Failed to resolve user from token");
    // Generic — do not reveal whether the token belongs to a valid account
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 3. Rate limiting (key = first 16 chars of token hash) ───────────────────
  const tokenHashPrefix = createHash("sha256").update(rawToken).digest("hex").slice(0, 16);
  const rateLimit = await checkRateLimit(`sms_import:${tokenHashPrefix}`);
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

  // ── 4. Body size guard ───────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  // ── 5. Parse and validate body ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.log("[SMS Webhook Debug] 400 Bad Request: Failed to parse request body as JSON", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body && typeof body === "object") {
    const rawBody = body as Record<string, unknown>;
    const keys = Object.keys(rawBody);
    const senderType = typeof rawBody.sender;
    const isSenderNonEmpty = typeof rawBody.sender === "string" ? rawBody.sender.trim().length > 0 : false;
    const messageType = typeof rawBody.message;
    const messageLength = typeof rawBody.message === "string" ? rawBody.message.length : 0;
    const receivedAtType = typeof rawBody.receivedAt;
    const receivedAtValue = rawBody.receivedAt;
    const deviceIdType = typeof rawBody.deviceId;

    console.log("[SMS Webhook Debug] Request body metadata:", {
      keys,
      senderType,
      isSenderNonEmpty,
      messageType,
      messageLength,
      receivedAtType,
      receivedAtValue,
      deviceIdType,
    });
  } else {
    console.log("[SMS Webhook Debug] Request body is not an object:", typeof body);
  }

  const parsed = SmsWebhookBodySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.log("[SMS Webhook Debug] 400 Bad Request: Zod validation failed", fieldErrors);
    return NextResponse.json(
      { error: "Invalid request", fieldErrors },
      { status: 400 }
    );
  }

  const { sender, message, receivedAt: receivedAtStr, deviceId } = parsed.data;

  // ── 6. Timestamp freshness check ─────────────────────────────────────────────
  let receivedAt: Date;
  if (!receivedAtStr || receivedAtStr.trim() === "") {
    receivedAt = new Date();
  } else {
    const parsedDate = new Date(receivedAtStr);
    if (isNaN(parsedDate.getTime())) {
      console.warn(
        `[sms-webhook]\n\nInvalid receivedAt.\n\nOriginal value:\n${receivedAtStr}\n\nUsing server timestamp instead.`
      );
      receivedAt = new Date();
    } else if (parsedDate.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      console.warn(
        `[sms-webhook]\n\nInvalid receivedAt.\n\nOriginal value:\n${receivedAtStr}\n\nUsing server timestamp instead.`
      );
      receivedAt = new Date();
    } else {
      receivedAt = parsedDate;
    }
  }

  // deviceId is metadata only — logged but not trusted for auth
  void deviceId;

  // ── 7. Idempotency key from header ───────────────────────────────────────────
  const idempotencyKey = req.headers.get("idempotency-key") ?? null;

  // ── 8. Stamp tokenLastUsedAt (throttled — only if >5 min old) ───────────────
  // Called here: token is valid, not revoked, not expired, body is valid.
  // Does NOT wait for import result — a valid message may correctly enter REVIEW_REQUIRED.
  void importSettingService.touchLastUsed(userId).catch((err) => {
    console.error("[sms-webhook] touchLastUsed failed (non-fatal):", err);
  });

  // ── 8. Run import engine ─────────────────────────────────────────────────────
  let result;
  try {
    result = await importService.processSms(userId, {
      sender,
      message,
      receivedAt,
      deviceId,
      idempotencyKey,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    console.error("[SMS Webhook Debug] 500 Internal Server Error in processSms", {
      sender,
      messageLength: message.length,
      error: errorMsg,
    });
    return NextResponse.json(
      {
        success: false,
        outcome: "failed",
        error: "Internal server error occurred during import processing",
        reason: errorMsg,
      },
      { status: 500 }
    );
  }

  if (result.outcome === "disabled") {
    return NextResponse.json(
      {
        success: false,
        outcome: "disabled",
        reason: "Import engine is not enabled for this account",
        error: "Import engine is not enabled for this account",
      },
      { status: 503 }
    );
  }

  // Outcome mapping for success & HTTP status
  let status = 200;
  let success = true;
  let reason: string | undefined = undefined;
  let importedTransactionId: string | undefined = undefined;

  if (result.outcome === "rejected") {
    status = 422;
    success = false;
    reason = "reason" in result ? result.reason : "No supported parser matched the SMS format";
  } else if (result.outcome === "review_required") {
    status = 202;
    success = true;
    reason = "The SMS could not be parsed automatically";
    importedTransactionId = "importedTransactionId" in result ? result.importedTransactionId : undefined;
  } else {
    // auto_posted, duplicate, idempotent, ignored, pending_event
    importedTransactionId = "importedTransactionId" in result ? result.importedTransactionId : undefined;
    if (result.outcome === "ignored") {
      reason = "reason" in result ? result.reason : "Message was ignored";
    }
  }

  return NextResponse.json(
    {
      success,
      outcome: result.outcome,
      reason,
      error: !success ? reason : undefined,
      importedTransactionId,
      data: result, // Keep for backward compatibility with E2E and unit tests
    },
    { status }
  );
}
