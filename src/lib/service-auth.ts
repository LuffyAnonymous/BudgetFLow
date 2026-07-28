/**
 * src/lib/service-auth.ts
 *
 * Resolves the acting userId for endpoints that must be callable both from
 * the browser (Auth.js session) and from trusted automation clients like n8n
 * (a per-user ServiceApiKey passed as `Authorization: Bearer bf_svc_...`).
 *
 * Usage:
 *   const authResult = await resolveRequestAuth(request, "transactions:write");
 *   if (!authResult) return apiError("UNAUTHORIZED", "...", 401);
 *   const userId = authResult.userId;
 *
 * A browser session always succeeds regardless of the requested scope — the
 * signed-in human is the account owner. A service key must carry the
 * requested scope; keys are least-privilege by default.
 */

import "server-only";

import { auth } from "@/auth";
import { serviceApiKeyService, type ServiceApiScope } from "@/server/services/service-api-key.service";

export interface RequestAuthResult {
  userId: string;
  authMethod: "session" | "service_key";
  keyId?: string;
}

export async function resolveRequestAuth(
  req: Request,
  requiredScope?: ServiceApiScope
): Promise<RequestAuthResult | null> {
  // 1. Browser session (existing behavior) — always fully authorized.
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, authMethod: "session" };
  }

  // 2. Service API key.
  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawKey) return null;

  const resolved = await serviceApiKeyService.resolveFromKey(rawKey);
  if (!resolved) return null;

  if (requiredScope && !resolved.scopes.includes(requiredScope)) {
    return null;
  }

  // Fire-and-forget usage stamp — never block or fail the request on this.
  void serviceApiKeyService.touchLastUsed(resolved.keyId).catch((err) => {
    console.error("[service-auth] touchLastUsed failed (non-fatal):", err);
  });

  return { userId: resolved.userId, authMethod: "service_key", keyId: resolved.keyId };
}
