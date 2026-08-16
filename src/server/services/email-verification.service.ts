/**
 * src/server/services/email-verification.service.ts
 *
 * Confirms a user owns the email address they registered with, before
 * letting them log in. Same hashed-token design as ImportSetting's
 * import tokens: random plaintext, SHA-256 hash stored, timing-safe
 * compare, expiry enforced. Plaintext only ever exists in the email sent.
 */

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

const TOKEN_PREFIX = "bf_verify_";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function generatePlaintextToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

function compareHashes(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifyUrl(rawToken: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${baseUrl}/verify-email?token=${rawToken}`;
}

/**
 * Generates a fresh token and emails the verification link. Safe to call
 * repeatedly (e.g. "resend email") — each call issues a new, independent
 * token; older unexpired tokens for the same user remain valid too, since
 * there's no harm in more than one working link being live at once.
 */
export async function sendVerificationEmail(
  userId: string,
  email: string,
  name: string
): Promise<void> {
  const plaintext = generatePlaintextToken();
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  const firstName = name.trim().split(/\s+/)[0] || "there";
  const link = verifyUrl(plaintext);

  await sendEmail({
    to: email,
    subject: "Verify your BudgetFlow email",
    text: `Hi ${firstName},\n\nConfirm your email to finish setting up BudgetFlow:\n${link}\n\nThis link expires in 24 hours. If you didn't create a BudgetFlow account, you can ignore this email.`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <p>Hi ${firstName},</p>
        <p>Confirm your email to finish setting up BudgetFlow:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #4f46e5; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Verify email</a>
        </p>
        <p style="color: #666; font-size: 13px;">This link expires in 24 hours. If you didn't create a BudgetFlow account, you can ignore this email.</p>
      </div>
    `,
  });

  await db.auditLog.create({
    data: {
      userId,
      action: "EMAIL_VERIFICATION_SENT",
      entityType: "USER",
      entityId: userId,
      source: "WEB",
    },
  });
}

export type VerifyOutcome = "verified" | "already_verified" | "invalid_or_expired";

/**
 * Consumes a verification token. Idempotent-friendly: if the user is
 * already verified (e.g. they click an old email twice, or the link race
 * with a session already established), reports "already_verified" rather
 * than erroring.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyOutcome> {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) return "invalid_or_expired";

  const candidateHash = hashToken(rawToken);
  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: candidateHash },
    select: { id: true, userId: true, tokenHash: true, expiresAt: true, usedAt: true },
  });

  if (!record) return "invalid_or_expired";
  if (record.usedAt) return "invalid_or_expired";
  if (record.expiresAt < new Date()) return "invalid_or_expired";
  if (!compareHashes(candidateHash, record.tokenHash)) return "invalid_or_expired";

  const user = await db.user.findUnique({
    where: { id: record.userId },
    select: { emailVerified: true },
  });
  if (!user) return "invalid_or_expired";

  if (user.emailVerified) {
    await db.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return "already_verified";
  }

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    db.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        userId: record.userId,
        action: "EMAIL_VERIFIED",
        entityType: "USER",
        entityId: record.userId,
        source: "WEB",
      },
    }),
  ]);

  return "verified";
}
