/**
 * src/lib/rate-limiter/rate-limiter.interface.ts
 *
 * Contract for all rate-limiter providers.
 * The SMS webhook depends on this interface only.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets (or 0 if allowed) */
  resetInMs: number;
}

export interface RateLimiterProvider {
  /**
   * Check and increment the counter for `key`.
   * If the count exceeds `maxRequests` within `windowMs`, returns allowed=false.
   * This call is side-effectful — it counts the current request.
   */
  check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult>;
}
