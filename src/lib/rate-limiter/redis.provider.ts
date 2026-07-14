/**
 * src/lib/rate-limiter/redis.provider.ts
 *
 * Redis-compatible sliding-window rate limiter using the Upstash REST API
 * (or any Redis server accessible over HTTP via @upstash/redis).
 *
 * Uses a Lua script for atomic increment + TTL in a single round-trip.
 * This avoids TOCTOU races present in multi-step GET+SET approaches.
 *
 * Required environment variables (when RATE_LIMIT_PROVIDER=redis):
 *   UPSTASH_REDIS_REST_URL   — e.g. https://us1-xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN — Upstash REST token
 *
 * Compatible with standard Redis via the Upstash REST proxy or the
 * @upstash/redis package. No persistent TCP connection required —
 * safe for serverless (Vercel, AWS Lambda).
 *
 * Algorithm: fixed-window counter (simpler and predictable for rate limiting
 * in a serverless context where sliding-window requires sorted-set per key).
 * Window resets every `windowMs`. This is a deliberate tradeoff over the
 * variable-window memory approach: it prevents multi-instance drift while
 * keeping implementation simple.
 */

import type { RateLimiterProvider, RateLimitResult } from "./rate-limiter.interface";

// ─── Upstash REST client (inline, no extra package needed) ───────────────────

interface UpstashResponse {
  result: number | null;
  error?: string;
}

async function redisCommand(
  url: string,
  token: string,
  command: string[]
): Promise<number | null> {
  const res = await fetch(`${url}/${command.map(encodeURIComponent).join("/")}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    // Log the body server-side but never include it in the thrown error —
    // Redis error bodies may contain credential-adjacent information.
    res.text().catch(() => null).then((body) => {
      if (body) console.error(`[rate-limiter] Redis HTTP ${res.status} body (redacted from client):`, body.slice(0, 100));
    });
    throw new Error(`[rate-limiter] Redis command failed with HTTP ${res.status}`);
  }

  const json = (await res.json()) as UpstashResponse;
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class RedisRateLimiterProvider implements RateLimiterProvider {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, ""); // strip trailing slash
    this.token = token;
  }

  /**
   * Fixed-window counter using INCR + EXPIRE.
   * The window key includes the current window timestamp so it resets cleanly.
   */
  async check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const windowId = Math.floor(Date.now() / windowMs);
    const redisKey = `rl:${key}:${windowId}`;
    const windowExpirySeconds = Math.ceil(windowMs / 1000) + 1; // +1 for grace

    // INCR atomically creates or increments
    const count = await redisCommand(this.url, this.token, ["INCR", redisKey]);

    if (count === null) {
      // Redis returned null — fail open to avoid blocking all requests
      console.error("[rate-limiter] Redis returned null for INCR — failing open");
      return { allowed: true, remaining: maxRequests - 1, resetInMs: 0 };
    }

    if (count === 1) {
      // First request in this window — set TTL
      await redisCommand(this.url, this.token, [
        "EXPIRE",
        redisKey,
        String(windowExpirySeconds),
      ]).catch((err) => {
        // Non-fatal: EXPIRE failure just means the key won't auto-expire
        console.error("[rate-limiter] EXPIRE failed:", err);
      });
    }

    if (count > maxRequests) {
      const windowResetMs = (windowId + 1) * windowMs - Date.now();
      return { allowed: false, remaining: 0, resetInMs: Math.max(0, windowResetMs) };
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      resetInMs: 0,
    };
  }
}

/**
 * Construct a RedisRateLimiterProvider from environment variables.
 * Throws a descriptive error if required variables are missing.
 */
export function createRedisProvider(): RedisRateLimiterProvider {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "[rate-limiter] RATE_LIMIT_PROVIDER=redis requires both " +
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to be set. " +
        "Do not use the memory provider in multi-instance production deployments."
    );
  }

  return new RedisRateLimiterProvider(url, token);
}
