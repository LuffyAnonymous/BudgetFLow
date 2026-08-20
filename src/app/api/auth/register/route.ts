/**
 * POST /api/auth/register
 *
 * Open self-serve account creation. Creates the User plus its default
 * categories/settings/accounts via provisionNewUser.
 *
 * Does not sign the user in — on success they're directed to /login.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getClientIp } from "@/lib/request-ip";
import { provisionNewUser } from "@/server/services/user-provisioning.service";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
      return apiError("RATE_LIMITED", "Too many sign-up attempts. Please try again later.", 429);
    }

    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { email, password, firstName, lastName } = parsed.data;

    // Generic error message — never reveal whether the email is taken beyond
    // what's strictly necessary for the user to self-correct.
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return apiError("EMAIL_TAKEN", "An account with this email already exists.", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const name = `${firstName} ${lastName}`.trim();

    const user = await provisionNewUser({ email, passwordHash, name });

    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "USER_REGISTERED",
        entityType: "USER",
        entityId: user.id,
        source: "WEB",
      },
    });

    return apiSuccess({ id: user.id, email: user.email }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
