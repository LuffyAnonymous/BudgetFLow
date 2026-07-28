/**
 * PATCH  /api/settings/service-api-key/[id]  — rotate a key atomically (old secret immediately invalid)
 * DELETE /api/settings/service-api-key/[id]  — revoke a key
 *
 * All routes require an Auth.js session and ownership of the key.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { serviceApiKeyService } from "@/server/services/service-api-key.service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { plaintext } = await serviceApiKeyService.rotateKey(session.user.id, id);
    return NextResponse.json({
      data: {
        key: plaintext,
        warning:
          "This key will not be shown again. The previous secret for this key is now invalid. " +
          "Update your n8n credential immediately.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "SERVICE_API_KEY_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await serviceApiKeyService.revokeKey(session.user.id, id);
  return NextResponse.json({ data: { revoked: true } });
}
