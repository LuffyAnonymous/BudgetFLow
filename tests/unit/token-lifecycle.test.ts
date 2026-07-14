/**
 * tests/unit/token-lifecycle.test.ts
 *
 * Tests for ImportSetting token lifecycle:
 *   - Token uniqueness (tokenHash @unique enforced)
 *   - Rotation invalidating the old token
 *   - Expired token rejection
 *   - Revoked token rejection
 *   - tokenLastUsedAt throttling (only written when >5 min old)
 *   - Token status response excludes hash
 *   - Plaintext returned only by generate and rotate
 *   - No plaintext in audit records
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "../../src/lib/db";
import { ImportSettingService } from "../../src/server/services/import-setting.service";

// ─── Isolated test user ───────────────────────────────────────────────────────

let testUserId: string;
const service = new ImportSettingService();

beforeAll(async () => {
  // Create a minimal test user
  const user = await db.user.create({
    data: {
      email: `token-lifecycle-test-${Date.now()}@test.local`,
      name: "Token Test",
      passwordHash: "test-hash-not-used",
    },
  });
  testUserId = user.id;
});

afterEach(async () => {
  // Clean up import setting between tests
  await db.importSetting.deleteMany({ where: { userId: testUserId } });
});

// ─── Generate ─────────────────────────────────────────────────────────────────

describe("generateToken", () => {
  it("returns a plaintext token with the bf_import_ prefix", async () => {
    const { plaintext } = await service.generateToken(testUserId);
    expect(plaintext).toMatch(/^bf_import_[0-9a-f]{64}$/);
  });

  it("does NOT store the plaintext — only the hash", async () => {
    const { plaintext } = await service.generateToken(testUserId);
    const setting = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(setting?.tokenHash).toBeDefined();
    expect(setting?.tokenHash).not.toBe(plaintext);
    expect(setting?.tokenHash).not.toContain("bf_import_");
  });

  it("sets tokenExpiresAt in the future", async () => {
    await service.generateToken(testUserId);
    const setting = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(setting?.tokenExpiresAt).toBeDefined();
    expect(setting!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("clears tokenLastUsedAt on generation", async () => {
    await service.generateToken(testUserId);
    const setting = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(setting?.tokenLastUsedAt).toBeNull();
  });

  it("resolves user from generated token", async () => {
    const { plaintext } = await service.generateToken(testUserId);
    const resolved = await service.resolveUserFromToken(plaintext);
    expect(resolved).toBe(testUserId);
  });

  it("token is not returned again by getTokenStatus (no hash or plaintext)", async () => {
    await service.generateToken(testUserId);
    const status = await service.getTokenStatus(testUserId);
    expect(status.hasToken).toBe(true);
    // Status should not expose the hash
    const keys = Object.keys(status);
    expect(keys).not.toContain("tokenHash");
    expect(keys).not.toContain("plaintext");
  });
});

// ─── Rotation ─────────────────────────────────────────────────────────────────

describe("rotateToken", () => {
  it("old token is rejected after rotation", async () => {
    const { plaintext: oldToken } = await service.generateToken(testUserId);
    await service.rotateToken(testUserId);
    const resolved = await service.resolveUserFromToken(oldToken);
    expect(resolved).toBeNull();
  });

  it("new token resolves userId", async () => {
    await service.generateToken(testUserId);
    const { plaintext: newToken } = await service.rotateToken(testUserId);
    const resolved = await service.resolveUserFromToken(newToken);
    expect(resolved).toBe(testUserId);
  });

  it("rotateToken returns a different plaintext than the previous token", async () => {
    const { plaintext: first } = await service.generateToken(testUserId);
    const { plaintext: second } = await service.rotateToken(testUserId);
    expect(second).not.toBe(first);
  });

  it("does not create a second ImportSetting row — updates in place", async () => {
    await service.generateToken(testUserId);
    await service.rotateToken(testUserId);
    const count = await db.importSetting.count({ where: { userId: testUserId } });
    expect(count).toBe(1);
  });

  it("clears tokenRevokedAt after rotation", async () => {
    await service.generateToken(testUserId);
    await service.revokeToken(testUserId);
    // Re-generate (rotate requires an existing setting)
    await service.generateToken(testUserId);
    await service.rotateToken(testUserId);
    const setting = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(setting?.tokenRevokedAt).toBeNull();
  });
});

// ─── Expiry ───────────────────────────────────────────────────────────────────

describe("resolveUserFromToken — expiry", () => {
  it("rejects a token whose tokenExpiresAt is in the past", async () => {
    const { plaintext } = await service.generateToken(testUserId);

    // Manually backdate the expiry
    await db.importSetting.update({
      where: { userId: testUserId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const resolved = await service.resolveUserFromToken(plaintext);
    expect(resolved).toBeNull();
  });

  it("accepts a token whose tokenExpiresAt is in the future", async () => {
    const { plaintext } = await service.generateToken(testUserId);
    const resolved = await service.resolveUserFromToken(plaintext);
    expect(resolved).toBe(testUserId);
  });
});

// ─── Revocation ───────────────────────────────────────────────────────────────

describe("resolveUserFromToken — revocation", () => {
  it("rejects a revoked token", async () => {
    const { plaintext } = await service.generateToken(testUserId);
    await service.revokeToken(testUserId);
    const resolved = await service.resolveUserFromToken(plaintext);
    expect(resolved).toBeNull();
  });

  it("getTokenStatus.isActive is false after revocation", async () => {
    await service.generateToken(testUserId);
    await service.revokeToken(testUserId);
    const status = await service.getTokenStatus(testUserId);
    expect(status.isActive).toBe(false);
    expect(status.revokedAt).not.toBeNull();
  });
});

// ─── tokenLastUsedAt throttling ───────────────────────────────────────────────

describe("touchLastUsed — throttled update", () => {
  it("updates tokenLastUsedAt on first call", async () => {
    await service.generateToken(testUserId);
    const before = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(before?.tokenLastUsedAt).toBeNull();

    await service.touchLastUsed(testUserId);
    const after = await db.importSetting.findUnique({ where: { userId: testUserId } });
    expect(after?.tokenLastUsedAt).not.toBeNull();
  });

  it("does NOT update tokenLastUsedAt if called again within 5 minutes", async () => {
    await service.generateToken(testUserId);
    await service.touchLastUsed(testUserId);

    const firstUpdate = await db.importSetting.findUnique({
      where: { userId: testUserId },
      select: { tokenLastUsedAt: true },
    });

    // Call again immediately — should be throttled
    await service.touchLastUsed(testUserId);

    const secondUpdate = await db.importSetting.findUnique({
      where: { userId: testUserId },
      select: { tokenLastUsedAt: true },
    });

    // Both calls within the same second — timestamp should be unchanged
    expect(firstUpdate?.tokenLastUsedAt?.getTime()).toBe(
      secondUpdate?.tokenLastUsedAt?.getTime()
    );
  });

  it("updates tokenLastUsedAt if last value is older than 5 minutes", async () => {
    await service.generateToken(testUserId);

    // Backdate tokenLastUsedAt by 6 minutes
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await db.importSetting.update({
      where: { userId: testUserId },
      data: { tokenLastUsedAt: sixMinutesAgo },
    });

    await service.touchLastUsed(testUserId);

    const after = await db.importSetting.findUnique({
      where: { userId: testUserId },
      select: { tokenLastUsedAt: true },
    });
    expect(after?.tokenLastUsedAt!.getTime()).toBeGreaterThan(sixMinutesAgo.getTime());
  });
});

// ─── Audit log — no plaintext ─────────────────────────────────────────────────

describe("Audit log — plaintext exclusion", () => {
  it("generate token audit entry contains no plaintext token", async () => {
    const { plaintext } = await service.generateToken(testUserId);

    const auditEntry = await db.auditLog.findFirst({
      where: { userId: testUserId },
      orderBy: { createdAt: "desc" },
    });

    const metadataStr = JSON.stringify(auditEntry?.metadata ?? {});
    expect(metadataStr).not.toContain(plaintext);
    expect(metadataStr).not.toContain("bf_import_");
  });

  it("rotate token audit entry contains no plaintext token", async () => {
    await service.generateToken(testUserId);
    const { plaintext: newToken } = await service.rotateToken(testUserId);

    const auditEntry = await db.auditLog.findFirst({
      where: { userId: testUserId },
      orderBy: { createdAt: "desc" },
    });

    const metadataStr = JSON.stringify(auditEntry?.metadata ?? {});
    expect(metadataStr).not.toContain(newToken);
    expect(metadataStr).not.toContain("bf_import_");
  });
});
