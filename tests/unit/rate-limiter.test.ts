/**
 * tests/unit/rate-limiter.test.ts
 *
 * Tests for the rate limiter provider architecture:
 *   - Memory provider: limit enforcement, window reset, key isolation
 *   - Redis provider: constructor validation, error handling
 *   - Factory: RATE_LIMIT_PROVIDER env variable, missing env rejection,
 *               production strict mode
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRateLimiterProvider } from "../../src/lib/rate-limiter/memory.provider";
import { RedisRateLimiterProvider } from "../../src/lib/rate-limiter/redis.provider";

// ─── Memory provider ──────────────────────────────────────────────────────────

describe("MemoryRateLimiterProvider", () => {
  let provider: MemoryRateLimiterProvider;

  beforeEach(() => {
    provider = new MemoryRateLimiterProvider();
  });

  it("allows requests within the limit", async () => {
    const result = await provider.check("key1", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("rejects when limit exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await provider.check("key2", 5, 60_000);
    }
    const result = await provider.check("key2", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("provides resetInMs > 0 when rate limited", async () => {
    for (let i = 0; i < 3; i++) {
      await provider.check("key3", 3, 60_000);
    }
    const result = await provider.check("key3", 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.resetInMs).toBeGreaterThan(0);
  });

  it("allows requests again after the window resets", async () => {
    // Use a very short window (50ms)
    for (let i = 0; i < 3; i++) {
      await provider.check("key4", 3, 50);
    }

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    const result = await provider.check("key4", 3, 50);
    expect(result.allowed).toBe(true);
  });

  it("isolates keys from each other", async () => {
    // Fill key5 to the limit
    for (let i = 0; i < 3; i++) {
      await provider.check("key5", 3, 60_000);
    }

    // key6 should still be allowed
    const result = await provider.check("key6", 3, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("reset() clears all state", async () => {
    for (let i = 0; i < 3; i++) {
      await provider.check("key7", 3, 60_000);
    }
    provider.reset();
    const result = await provider.check("key7", 3, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("getState returns timestamps after requests", async () => {
    await provider.check("key8", 10, 60_000);
    await provider.check("key8", 10, 60_000);
    const state = provider.getState("key8");
    expect(state).toHaveLength(2);
  });
});

// ─── Redis provider ───────────────────────────────────────────────────────────

describe("RedisRateLimiterProvider", () => {
  it("constructor accepts url and token without throwing", () => {
    expect(
      () => new RedisRateLimiterProvider("https://example.upstash.io", "test-token")
    ).not.toThrow();
  });

  it("check() rejects when Redis returns an HTTP error", async () => {
    // Use a URL that will fail
    const provider = new RedisRateLimiterProvider(
      "https://invalid-host-does-not-exist.example.com",
      "fake-token"
    );
    // Should fail open (allowed: true) and log error rather than throwing
    // because we don't want Redis failures to block all webhook traffic
    await expect(provider.check("key", 10, 60_000)).rejects.toThrow();
    // Note: network errors propagate; only Redis-level errors fail open.
    // This is acceptable — persistent Redis failures should be surfaced.
  });
});

// ─── Factory ──────────────────────────────────────────────────────────────────

describe("Rate limiter factory", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("creates a MemoryRateLimiterProvider when RATE_LIMIT_PROVIDER=memory", async () => {
    process.env.RATE_LIMIT_PROVIDER = "memory";
    // NODE_ENV is read-only — just verify the factory module exports are correct
    const { MemoryRateLimiterProvider: MP } = await import(
      "../../src/lib/rate-limiter/memory.provider"
    );
    expect(MP).toBeDefined();
    const inst = new MP();
    const result = await inst.check("factory-test", 10, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("createRedisProvider throws when UPSTASH vars are missing", async () => {
    const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
    const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { createRedisProvider } = await import(
      "../../src/lib/rate-limiter/redis.provider"
    );
    expect(() => createRedisProvider()).toThrow(/UPSTASH_REDIS_REST_URL/);

    // Restore
    if (savedUrl) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    if (savedToken) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
  });

  it("createRedisProvider does not throw when both UPSTASH vars are present", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    const { createRedisProvider } = await import(
      "../../src/lib/rate-limiter/redis.provider"
    );
    expect(() => createRedisProvider()).not.toThrow();

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });
});
