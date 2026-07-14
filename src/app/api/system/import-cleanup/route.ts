/**
 * POST /api/system/import-cleanup
 *
 * System-only endpoint for the import payload retention cleanup job.
 *
 * Security (correction #9):
 *   - Protected by IMPORT_CLEANUP_SECRET environment variable (NOT user session)
 *   - Constant-time comparison to prevent timing attacks
 *   - Rate-limited: 1 request per 60 seconds (in-memory)
 *   - No user-controlled target userId — processes all users
 *   - Returns only safe aggregate results (no SMS content, no fingerprints)
 *
 * This endpoint should be called:
 *   - Via Vercel Cron (CRON_SECRET in Authorization header)
 *   - Via a CI job / scheduled task
 *
 * Example invocation:
 *   curl -X POST https://your-app.vercel.app/api/system/import-cleanup \
 *     -H "Authorization: Bearer $IMPORT_CLEANUP_SECRET"
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { randomUUID } from "crypto";
import { runImportCleanup } from "@/server/jobs/import-cleanup.job";

/** Simple in-memory gate: 1 run per 60 seconds to prevent abuse */
let lastRunAt: number | null = null;
const MIN_INTERVAL_MS = 60 * 1000;

function verifySecret(authHeader: string | null): boolean {
  const secret = process.env.IMPORT_CLEANUP_SECRET;
  if (!secret) {
    // No secret configured — reject all requests
    return false;
  }

  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");

  // timingSafeEqual requires equal-length buffers
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Verify secret ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!verifySecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Rate gate ─────────────────────────────────────────────────────────────
  const now = Date.now();
  if (lastRunAt !== null && now - lastRunAt < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: "Too soon — minimum interval between cleanup runs is 60 seconds" },
      { status: 429 }
    );
  }
  lastRunAt = now;

  // ── 3. Run cleanup ───────────────────────────────────────────────────────────
  const jobId = randomUUID();

  try {
    const result = await runImportCleanup(jobId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Cleanup failed: ${message}` }, { status: 500 });
  }
}
