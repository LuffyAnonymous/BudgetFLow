/**
 * POST /api/auth/resend-verification
 *
 * Issues a fresh verification email. Always returns the same generic
 * success response regardless of whether the email exists or is already
 * verified — same email-enumeration guard as the rest of the auth flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationEmail } from "@/server/services/email-verification.service";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address"),
});

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

const GENERIC_MESSAGE =
  "If an account with that email exists and isn't verified yet, we've sent a new verification link.";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(`resend-verification:${ip}`, 5, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
      return apiError("RATE_LIMITED", "Too many requests. Please try again later.", 429);
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }

    const user = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, name: true, emailVerified: true },
    });

    if (user && !user.emailVerified) {
      await sendVerificationEmail(user.id, user.email, user.name ?? "there");
    }

    return apiSuccess({ message: GENERIC_MESSAGE });
  } catch (error) {
    return handleApiError(error);
  }
}
