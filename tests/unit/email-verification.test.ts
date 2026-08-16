import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const { sendVerificationEmail, verifyEmailToken } = await import(
  "../../src/server/services/email-verification.service"
);

const TEST_EMAIL = "verify_test@budgetflow.ae";

describe("email verification service", () => {
  let userId: string;

  beforeEach(async () => {
    sendEmailMock.mockClear();
    await db.emailVerificationToken.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    const existing = await db.user.findUnique({ where: { email: TEST_EMAIL } });
    if (existing) await db.user.delete({ where: { id: existing.id } });

    const user = await db.user.create({
      data: { email: TEST_EMAIL, passwordHash: "dummy-hash", name: "Verify Tester" },
    });
    userId = user.id;
  });

  it("sends an email and stores only the token hash, never the plaintext", async () => {
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [emailArg] = sendEmailMock.mock.calls[0];
    expect(emailArg.to).toBe(TEST_EMAIL);
    expect(emailArg.html).toContain("verify-email?token=bf_verify_");

    const tokens = await db.emailVerificationToken.findMany({ where: { userId } });
    expect(tokens.length).toBe(1);
    expect(tokens[0].tokenHash).not.toContain("bf_verify_");
    expect(tokens[0].tokenHash.length).toBe(64); // sha256 hex
  });

  it("verifies a valid token and marks the user verified", async () => {
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");
    const [emailArg] = sendEmailMock.mock.calls[0];
    const link: string = emailArg.text;
    const token = link.match(/token=(\S+)/)?.[1];
    expect(token).toBeTruthy();

    const outcome = await verifyEmailToken(token!);
    expect(outcome).toBe("verified");

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).not.toBeNull();
  });

  it("reports already_verified on a second use without erroring", async () => {
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");
    const token = sendEmailMock.mock.calls[0][0].text.match(/token=(\S+)/)?.[1];

    await verifyEmailToken(token!);
    const secondOutcome = await verifyEmailToken(token!);
    expect(secondOutcome).toBe("invalid_or_expired");
  });

  it("rejects an unknown token", async () => {
    const outcome = await verifyEmailToken("bf_verify_totally_made_up");
    expect(outcome).toBe("invalid_or_expired");
  });

  it("rejects an expired token", async () => {
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");
    const token = sendEmailMock.mock.calls[0][0].text.match(/token=(\S+)/)?.[1];

    await db.emailVerificationToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const outcome = await verifyEmailToken(token!);
    expect(outcome).toBe("invalid_or_expired");

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBeNull();
  });

  it("resending issues a new, independent token", async () => {
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");
    await sendVerificationEmail(userId, TEST_EMAIL, "Verify Tester");

    const tokens = await db.emailVerificationToken.findMany({ where: { userId } });
    expect(tokens.length).toBe(2);
    expect(tokens[0].tokenHash).not.toBe(tokens[1].tokenHash);
  });
});
