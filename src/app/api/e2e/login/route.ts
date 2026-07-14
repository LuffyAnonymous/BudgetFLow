/**
 * POST /api/e2e/login
 *
 * E2E-only authentication endpoint.
 * Logs in a user by email without a password check and returns a session cookie.
 *
 * SECURITY: This endpoint is ONLY available when NODE_ENV=test or E2E_ENABLED=1.
 * It must never be deployed to production.
 *
 * The JWT payload must include:
 *   - sub: user ID (read by session callback as token.id via jwt callback)
 *   - id: user ID (populated by the jwt callback from user.id on sign-in)
 *   - sessionVersion: must match db.user.sessionVersion (checked in session callback)
 *
 * Without sessionVersion, the session callback invalidates the session.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { encode } from "next-auth/jwt";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Guard: only allow in test/e2e environments
  if (process.env.NODE_ENV !== "test" && process.env.E2E_ENABLED !== "1") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { email } = body;

  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  // Fetch user including sessionVersion — required by auth.config session callback
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, sessionVersion: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AUTH_SECRET not configured" }, { status: 500 });
  }

  // Build the JWT payload that matches what the auth.config jwt callback produces.
  //
  // The jwt callback does:
  //   if (user) { token.id = user.id; token.sessionVersion = user.sessionVersion; }
  //
  // The session callback checks:
  //   session.user.id = token.id
  //   db.user.sessionVersion === token.sessionVersion
  //
  // If sessionVersion is missing or mismatched, the session callback returns null.
  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      // Must include id and sessionVersion for auth.config session callback
      id: user.id,
      sessionVersion: user.sessionVersion,
    },
    secret,
    salt: "authjs.session-token",
  });

  const response = NextResponse.json({ data: { userId: user.id } }, { status: 200 });
  response.cookies.set("authjs.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
