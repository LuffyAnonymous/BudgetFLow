/**
 * GET  /api/settings/service-api-key       — list this user's automation keys (metadata only, never the secret)
 * POST /api/settings/service-api-key       — generate a new key (plaintext shown once)
 *
 * All routes require an Auth.js session — automation clients cannot self-provision keys.
 * A user may hold multiple keys (e.g. separate keys per n8n environment).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { serviceApiKeyService, SERVICE_API_SCOPES } from "@/server/services/service-api-key.service";

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(SERVICE_API_SCOPES)).min(1, "At least one scope is required"),
});

/** GET — list keys (metadata only) */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await serviceApiKeyService.listKeys(session.user.id);
  return NextResponse.json({ data: keys });
}

/** POST — generate a new key */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: "Invalid request", fieldErrors }, { status: 400 });
  }

  try {
    const { id, plaintext } = await serviceApiKeyService.generateKey(session.user.id, parsed.data);
    return NextResponse.json({
      data: {
        id,
        key: plaintext,
        warning:
          "This key will not be shown again. Store it securely (e.g. in your n8n credential store). " +
          "Anyone with this key can perform the actions covered by its scopes on your account.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("INVALID_SCOPE") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
