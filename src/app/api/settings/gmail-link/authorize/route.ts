/**
 * GET /api/settings/gmail-link/authorize
 *
 * Starts the Gmail OAuth flow — redirects to Google's consent screen.
 * A random nonce is stored in a short-lived signed-equivalent httpOnly
 * cookie and echoed back as the `state` param; the callback route verifies
 * they match before exchanging anything, the standard CSRF guard for an
 * OAuth authorization-code flow.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { buildGmailAuthorizeUrl } from "@/lib/gmail/oauth-client";

const STATE_COOKIE = "gmail_oauth_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildGmailAuthorizeUrl(state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
