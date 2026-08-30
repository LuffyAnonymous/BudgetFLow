import "server-only";

import { google } from "googleapis";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Non-sensitive — just enough to show "connected as x@gmail.com" in
// Settings, so a reconnect with the wrong account is visible immediately
// rather than silently switching which mailbox gets polled.
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

function resolveBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function getGmailRedirectUri(): string {
  return `${resolveBaseUrl().replace(/\/$/, "")}/api/integrations/gmail/callback`;
}

export function createGmailOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getGmailRedirectUri());
}

export function buildGmailAuthorizeUrl(state: string): string {
  const client = createGmailOAuthClient();
  return client.generateAuthUrl({
    // "offline" + "consent" are both required to reliably get a refresh
    // token back — without prompt=consent, Google skips re-issuing one for
    // a user who already granted this scope once.
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE, USERINFO_EMAIL_SCOPE],
    state,
  });
}

export { GMAIL_READONLY_SCOPE };
