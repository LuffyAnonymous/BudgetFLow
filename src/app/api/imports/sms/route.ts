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
 *   Can have varied iOS Shortcut structures, normalized before validation.
 *
 * Every parseable SMS is posted as a Transaction immediately — there is no
 * manual review queue. Confidence and direction-ambiguity are post-hoc
 * signals only: anything other than a clean HIGH-confidence auto-post
 * triggers a Telegram notification for after-the-fact correction. A hard
 * parse failure (unrecognized sender, ambiguous parser match, or nothing
 * extractable) still creates a FAILED ImportedTransaction record and
 * notifies — it just never becomes a Transaction.
 *
 * Response:
 *   200 OK — auto_posted | duplicate | ignored | pending_event | idempotent
 *   400 — invalid request body
 *   401 — missing or invalid token
 *   422 — failed (nothing postable — see `reason`)
 *   429 — rate limit exceeded
 *   503 — import engine disabled for this user
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importSettingService } from "@/server/services/import-setting.service";
import { importService } from "@/imports/engine/import.service";
import { telegramService } from "@/server/services/telegram.service";
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

// Type-safe recursive SMS text extraction helper
export function extractSmsText(payload: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (payload === null || payload === undefined) return null;

  // 1. If primitive string
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 15) {
      return trimmed;
    }
    return null;
  }

  // 2. If array
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractSmsText(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // 3. If object
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    // Candidate keys to check first
    const candidateKeys = ["message", "text", "content", "input", "body", "value"];
    for (const key of candidateKeys) {
      if (key in obj) {
        const val = obj[key];
        if (typeof val === "string") {
          const trimmed = val.trim();
          if (trimmed.length > 15) return trimmed;
        } else if (val && typeof val === "object") {
          const found = extractSmsText(val, depth + 1);
          if (found) return found;
        }
      }
    }

    // Generic fallback: check all properties
    for (const key of Object.keys(obj)) {
      if (candidateKeys.includes(key)) continue;

      const val = obj[key];
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed.length > 15) {
          return trimmed;
        }
      } else if (val && typeof val === "object") {
        const found = extractSmsText(val, depth + 1);
        if (found) return found;
      }
    }
  }

  return null;
}

interface SafeShapeInfo {
  keys?: string[];
  types?: Record<string, string>;
  lengths?: Record<string, number>;
  nested?: Record<string, SafeShapeInfo | string>;
}

// Generate a safe representation of the payload layout
export function getSafeShape(payload: unknown, depth = 0): SafeShapeInfo | string {
  if (depth > 4) return "max-depth-reached";
  if (payload === null || payload === undefined) return "null-or-undefined";

  const valType = typeof payload;
  if (valType !== "object") {
    if (valType === "string") {
      return `string(len=${(payload as string).length})`;
    }
    return valType;
  }

  if (Array.isArray(payload)) {
    const arrayInfo: string[] = [];
    for (let i = 0; i < Math.min(payload.length, 3); i++) {
      const res = getSafeShape(payload[i], depth + 1);
      if (typeof res === "string") {
        arrayInfo.push(res);
      } else {
        arrayInfo.push("object");
      }
    }
    return `array[${arrayInfo.join(", ")}]`;
  }

  const obj = payload as Record<string, unknown>;
  const keys = Object.keys(obj);
  const types: Record<string, string> = {};
  const lengths: Record<string, number> = {};
  const nested: Record<string, SafeShapeInfo | string> = {};

  for (const key of keys) {
    if (/token|auth|key|password|secret|cred/i.test(key)) {
      types[key] = "redacted";
      continue;
    }

    const val = obj[key];
    const t = typeof val;
    types[key] = t;

    if (t === "string") {
      lengths[key] = (val as string).length;
    } else if (val && t === "object") {
      const res = getSafeShape(val, depth + 1);
      nested[key] = res;
    }
  }

  return { keys, types, lengths, nested };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Extract Bearer token ─────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!rawToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Resolve user from token ───────────────────────────────────────────────
  const userId = await importSettingService.resolveUserFromToken(rawToken);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 3. Rate limiting ────────────────────────────────────────────────────────
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

  // ── 5. Parse and normalize body ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const safeShape = getSafeShape(body);

  const receivedKeys = body && typeof body === "object" ? Object.keys(body as object) : [];

  // Extract SMS message text
  const extractedText = extractSmsText(body);
  if (!extractedText) {
    const responsePayload: Record<string, unknown> = {
      success: false,
      error: "SMS text could not be extracted",
      receivedKeys,
    };

    // If debug is requested via parameter or header, include safe shape in response JSON
    const isDebug = req.nextUrl.searchParams.get("debug") === "true" || req.headers.get("x-debug-payload") === "true";
    if (isDebug) {
      responsePayload.debugShape = safeShape;
    }

    return NextResponse.json(responsePayload, { status: 400 });
  }

  // Extract sender
  let sender = "";
  let receivedAtStr: string | null = null;
  let deviceId: string | null = null;

  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.sender === "string") {
      sender = obj.sender.trim();
    } else if (typeof obj.from === "string") {
      sender = obj.from.trim();
    }
    
    if (typeof obj.receivedAt === "string") {
      receivedAtStr = obj.receivedAt;
    }
    if (typeof obj.deviceId === "string") {
      deviceId = obj.deviceId;
    }
  }

  const normalizedPayload = {
    sender,
    message: extractedText,
    receivedAt: receivedAtStr,
    deviceId,
  };

  const parsed = SmsWebhookBodySchema.safeParse(normalizedPayload);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json(
      { error: "Invalid request", fieldErrors },
      { status: 400 }
    );
  }

  const { sender: validatedSender, message: validatedMessage, receivedAt: validatedReceivedAtStr } = parsed.data;

  // ── 6. Timestamp freshness check ─────────────────────────────────────────────
  let receivedAt: Date;
  if (!validatedReceivedAtStr || validatedReceivedAtStr.trim() === "") {
    receivedAt = new Date();
  } else {
    const parsedDate = new Date(validatedReceivedAtStr);
    if (isNaN(parsedDate.getTime())) {
      console.warn(
        `[sms-webhook]\n\nInvalid receivedAt.\n\nOriginal value:\n${validatedReceivedAtStr}\n\nUsing server timestamp instead.`
      );
      receivedAt = new Date();
    } else if (parsedDate.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      console.warn(
        `[sms-webhook]\n\nInvalid receivedAt.\n\nOriginal value:\n${validatedReceivedAtStr}\n\nUsing server timestamp instead.`
      );
      receivedAt = new Date();
    } else {
      receivedAt = parsedDate;
    }
  }

  // deviceId is metadata only
  void deviceId;

  // ── 7. Idempotency key from header ───────────────────────────────────────────
  const idempotencyKey = req.headers.get("idempotency-key") ?? null;

  // ── 8. Stamp tokenLastUsedAt ─────────────────────────────────────────────────
  void importSettingService.touchLastUsed(userId).catch((err) => {
    console.error("[sms-webhook] touchLastUsed failed (non-fatal):", err);
  });

  // ── 9. Run import engine ─────────────────────────────────────────────────────
  let result;
  try {
    result = await importService.processSms(userId, {
      sender: validatedSender,
      message: validatedMessage,
      receivedAt,
      deviceId,
      idempotencyKey,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    console.error("[SMS Webhook Debug] 500 Internal Server Error in processSms", {
      sender: validatedSender,
      messageLength: validatedMessage.length,
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

  if (result.outcome === "failed") {
    status = 422;
    success = false;
    reason = result.reason;
    importedTransactionId = result.importedTransactionId;
    void telegramService.sendToUser(
      userId,
      `❌ SMS import failed\nReason: ${result.reason}\nThe message was not posted — nothing to correct, but check the sender/format.`
    );
  } else {
    importedTransactionId = "importedTransactionId" in result ? result.importedTransactionId : undefined;
    if (result.outcome === "ignored") {
      reason = result.reason;
    }
    if (result.outcome === "auto_posted" && (result.confidence !== "HIGH" || result.directionAmbiguous)) {
      const flagReason = result.directionAmbiguous
        ? "the debit/credit direction was ambiguous"
        : `confidence was ${result.confidence.toLowerCase()}`;
      void telegramService.sendToUser(
        userId,
        `⚠️ Imported — needs a second look\nReason: ${flagReason}.\nThe transaction was posted automatically; please verify it's correct.`
      );
    }
  }

  const responsePayload: Record<string, unknown> = {
    success,
    outcome: result.outcome,
    reason,
    error: !success ? reason : undefined,
    importedTransactionId,
    data: result, // Keep for backward compatibility
  };

  const isDebug = req.nextUrl.searchParams.get("debug") === "true" || req.headers.get("x-debug-payload") === "true";
  if (isDebug) {
    responsePayload.debugShape = safeShape;
  }

  return NextResponse.json(responsePayload, { status });
}
