/**
 * POST /api/auth/verify-email
 *
 * Consumes a verification token from the link in the verification email.
 * Called by the /verify-email page after reading the token out of the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { verifyEmailToken } from "@/server/services/email-verification.service";

const schema = z.object({
  token: z.string().trim().min(1, "Missing verification token"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }

    const outcome = await verifyEmailToken(parsed.data.token);

    if (outcome === "invalid_or_expired") {
      return apiError(
        "INVALID_TOKEN",
        "This verification link is invalid or has expired. Request a new one from the login page.",
        400
      );
    }

    return apiSuccess({ outcome });
  } catch (error) {
    return handleApiError(error);
  }
}
