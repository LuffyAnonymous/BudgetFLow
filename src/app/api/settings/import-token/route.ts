/**
 * POST   /api/settings/import-token  — generate a new token (plaintext shown once)
 * PATCH  /api/settings/import-token  — rotate token atomically (old token immediately invalid)
 * DELETE /api/settings/import-token  — revoke the current token
 *
 * All routes require an Auth.js session.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSettingService } from "@/server/services/import-setting.service";

/** POST — generate token */
export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plaintext } = await importSettingService.generateToken(session.user.id);

  return NextResponse.json({
    data: {
      token: plaintext,
      warning:
        "This token will not be shown again. Store it securely. " +
        "Anyone with this token can import transactions to your account.",
    },
  });
}

/** PATCH — rotate token atomically (old token is invalid the moment this responds) */
export async function PATCH(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { plaintext } = await importSettingService.rotateToken(session.user.id);
    return NextResponse.json({
      data: {
        token: plaintext,
        warning:
          "This token will not be shown again. Your previous token is now invalid. " +
          "Update your iPhone Shortcut immediately.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "IMPORT_SETTING_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** DELETE — revoke current token */
export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await importSettingService.revokeToken(session.user.id);
  return NextResponse.json({ data: { revoked: true } });
}
