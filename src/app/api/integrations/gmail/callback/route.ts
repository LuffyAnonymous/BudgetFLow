/**
 * GET /api/integrations/gmail/callback
 *
 * Completes the Gmail OAuth flow: verifies the CSRF state cookie set by
 * /api/settings/gmail-link/authorize, exchanges the authorization code for
 * tokens, encrypts + stores the refresh token, and redirects back to
 * Settings. This is a browser top-level navigation from Google, not an
 * XHR/fetch call — the session cookie is still present (same browser), but
 * unlike the other settings routes this can't just return a 401 JSON body
 * on failure, since there's no client-side code here to read it; it
 * redirects to Settings with an error query param instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createGmailOAuthClient } from "@/lib/gmail/oauth-client";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { GmailClient } from "@/lib/gmail/gmail-client";
import { syncGmailIntegration } from "@/lib/gmail/sync-integration";

const STATE_COOKIE = "gmail_oauth_state";

function redirectToSettings(req: NextRequest, error?: string): NextResponse {
  const url = new URL("/settings", req.nextUrl.origin);
  if (error) url.searchParams.set("gmail_error", error);
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSettings(req, "unauthenticated");
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    // User declined consent, or Google returned an error — not a bug.
    return redirectToSettings(req, oauthError === "access_denied" ? "access_denied" : "oauth_error");
  }

  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToSettings(req, "invalid_state");
  }

  try {
    const client = createGmailOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      // Can happen if the user previously connected and Google doesn't
      // consider this a fresh grant — prompt=consent should prevent this,
      // but fail loudly rather than silently keep a stale/absent token.
      return redirectToSettings(req, "no_refresh_token");
    }

    let googleAccountEmail: string | null = null;
    if (tokens.access_token) {
      try {
        const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userinfoRes.ok) {
          const userinfo = (await userinfoRes.json()) as { email?: string };
          googleAccountEmail = userinfo.email ?? null;
        }
      } catch (err) {
        // Non-fatal — the connection still works without a display email,
        // Settings just won't be able to show which account is connected.
        console.warn("[Gmail Callback] Failed to fetch userinfo email (non-fatal):", err);
      }
    }

    await gmailIntegrationService.saveConnection(session.user.id, {
      refreshToken: tokens.refresh_token,
      googleAccountEmail,
    });

    // Start push notifications immediately rather than waiting for the
    // next weekly renewal sweep — best-effort: a missing/misconfigured
    // Pub/Sub topic shouldn't fail the whole connection, since the topic
    // is set up separately in Google Cloud Console (see
    // docs/gmail-bank-email-import.md) and can be added moments later.
    const gmailClient = new GmailClient(tokens.refresh_token);
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (topicName) {
      try {
        const { historyId, expiration } = await gmailClient.watch(topicName);
        await gmailIntegrationService.saveWatch(session.user.id, { historyId, expiration });
      } catch (err) {
        console.warn("[Gmail Callback] watch() failed (non-fatal, will retry on next renewal sweep):", err);
      }
    } else {
      console.warn("[Gmail Callback] GOOGLE_PUBSUB_TOPIC not configured — skipping watch() setup.");
    }

    // Sync once now so the user sees results immediately instead of
    // waiting for the first push notification.
    try {
      const integration = await db.gmailIntegration.findUnique({ where: { userId: session.user.id } });
      if (integration) await syncGmailIntegration(integration);
    } catch (err) {
      console.warn("[Gmail Callback] Initial sync failed (non-fatal — the connection itself succeeded):", err);
    }

    return redirectToSettings(req);
  } catch (err) {
    console.error("[Gmail Callback] Token exchange failed:", err);
    return redirectToSettings(req, "token_exchange_failed");
  }
}
