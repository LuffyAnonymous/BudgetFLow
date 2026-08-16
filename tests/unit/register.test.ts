import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST } from "../../src/app/api/auth/register/route";

// Registration sends a verification email; stub the transport so tests
// don't need a real RESEND_API_KEY and don't send real mail.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

const TEST_EMAIL = "register_test@budgetflow.ae";

function makeRequest(body: unknown, ip = "10.1.0.1") {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: TEST_EMAIL,
  password: "password123",
  firstName: "Jane",
  lastName: "Doe",
};

describe("POST /api/auth/register", () => {
  beforeEach(async () => {
    await db.account.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    await db.setting.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    await db.category.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    const existing = await db.user.findUnique({ where: { email: TEST_EMAIL } });
    if (existing) await db.user.delete({ where: { id: existing.id } });
  });

  it("creates an account with no invite code required", async () => {
    const res = await POST(makeRequest(validBody, "10.1.0.10"));
    expect(res.status).toBe(201);

    const user = await db.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.name).toBe("Jane Doe");
  });

  it("leaves the new account unverified with a pending verification token", async () => {
    await POST(makeRequest(validBody, "10.1.0.20"));
    const user = await db.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user?.emailVerified).toBeNull();

    const tokens = await db.emailVerificationToken.findMany({ where: { userId: user!.id } });
    expect(tokens.length).toBe(1);
    expect(tokens[0].usedAt).toBeNull();
  });

  it("provisions default categories/settings/accounts for the new user", async () => {
    await POST(makeRequest(validBody, "10.1.0.11"));
    const user = await db.user.findUnique({ where: { email: TEST_EMAIL } });

    const settings = await db.setting.findUnique({ where: { userId: user!.id } });
    expect(settings).not.toBeNull();

    const categories = await db.category.findMany({ where: { userId: user!.id } });
    expect(categories.length).toBeGreaterThan(0);

    const accounts = await db.account.findMany({ where: { userId: user!.id } });
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("rejects an invalid email", async () => {
    const res = await POST(makeRequest({ ...validBody, email: "not-an-email" }, "10.1.0.12"));
    expect(res.status).toBe(400);
  });

  it("rejects a weak password", async () => {
    const res = await POST(makeRequest({ ...validBody, password: "short" }, "10.1.0.13"));
    expect(res.status).toBe(400);
    const user = await db.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).toBeNull();
  });

  it("rejects a missing first name", async () => {
    const res = await POST(makeRequest({ ...validBody, firstName: "" }, "10.1.0.14"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing last name", async () => {
    const res = await POST(makeRequest({ ...validBody, lastName: "" }, "10.1.0.15"));
    expect(res.status).toBe(400);
  });

  it("rejects a first/last name over the length limit", async () => {
    const res = await POST(makeRequest({ ...validBody, firstName: "a".repeat(51) }, "10.1.0.16"));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    await POST(makeRequest(validBody, "10.1.0.17"));
    const res = await POST(makeRequest({ ...validBody, firstName: "Someone", lastName: "Else" }, "10.1.0.18"));
    expect(res.status).toBe(409);
  });

  it("rate-limits repeated attempts from the same IP", async () => {
    const ip = "10.1.0.99";
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await POST(makeRequest({
        ...validBody,
        email: `rl_test_${i}@budgetflow.ae`,
      }, ip));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);

    await db.user.deleteMany({ where: { email: { startsWith: "rl_test_" } } });
  });
});
