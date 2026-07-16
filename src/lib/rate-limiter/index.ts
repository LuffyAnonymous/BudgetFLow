/**
 * src/lib/rate-limiter/index.ts
 *
 * Rate limiter factory with environment validation.
 *
 * Configuration (environment variables):
 *   RATE_LIMIT_PROVIDER=memory|redis   (default: memory)
 *
 * Production rules:
 *   - If RATE_LIMIT_PROVIDER=redis → requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   - If RATE_LIMIT_PROVIDER=memory in NODE_ENV=production → startup WARNING emitted
 *     (memory is rejected when RATE_LIMIT_STRICT=true is also set)
 *
 * The exported `rateLimiter` singleton is the single instance used application-wide.
 * The exported `checkRateLimit` function wraps it for convenience.
 */

import type { RateLimiterProvider, RateLimitResult } from "./rate-limiter.interface";
import { MemoryRateLimiterProvider } from "./memory.provider";
import { createRedisProvider } from "./redis.provider";

export type { RateLimiterProvider, RateLimitResult };

function createProvider(): RateLimiterProvider {
  const rawProvider = process.env.RATE_LIMIT_PROVIDER?.trim().toLowerCase() || "memory";

  if (rawProvider === "redis") {
    // Will throw with a descriptive message if UPSTASH vars are missing
    return createRedisProvider();
  }

  if (rawProvider === "memory") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.RATE_LIMIT_STRICT === "true"
    ) {
      throw new Error(
        "[rate-limiter] RATE_LIMIT_STRICT=true is set. " +
          "The memory provider is not suitable for multi-instance production. " +
          "Set RATE_LIMIT_PROVIDER=redis with the required Upstash environment variables."
      );
    }

    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[rate-limiter] WARNING: Using in-memory rate limiter in production. " +
          "Rate limit state is NOT shared across instances. " +
          "Set RATE_LIMIT_PROVIDER=redis for multi-instance deployments."
      );
    }

    return new MemoryRateLimiterProvider();
  }

  throw new Error(
    `[rate-limiter] Unknown RATE_LIMIT_PROVIDER="${rawProvider}". Valid values: memory | redis`
  );
}

/**
 * Application-wide rate limiter singleton.
 * Initialized once at module load time.
 */
export const rateLimiter: RateLimiterProvider = createProvider();

/**
 * Convenience wrapper — used by the SMS webhook route.
 */
export async function checkRateLimit(
  key: string,
  maxRequests = 20,
  windowMs = 60_000
): Promise<RateLimitResult> {
  return rateLimiter.check(key, maxRequests, windowMs);
}
