/**
 * src/lib/rate-limiter/memory.provider.ts
 *
 * In-process sliding-window rate limiter.
 *
 * Suitable for:
 *   - Local development
 *   - Single-instance deployments (one Node.js process)
 *
 * NOT suitable for:
 *   - Multi-instance / serverless (each instance has separate state)
 *
 * State is never persisted across restarts.
 * Stale window entries are evicted lazily on check() and periodically via setInterval.
 */

import type { RateLimiterProvider, RateLimitResult } from "./rate-limiter.interface";

interface WindowEntry {
  timestamps: number[];
  windowMs: number;
}

export class MemoryRateLimiterProvider implements RateLimiterProvider {
  private store = new Map<string, WindowEntry>();

  constructor() {
    // Evict stale entries every 5 minutes (only in environments that support timers)
    if (typeof setInterval !== "undefined") {
      const timer = setInterval(() => this.evict(), 5 * 60 * 1000);
      // Allow the process to exit even if this timer is active
      if (typeof timer === "object" && timer.unref) timer.unref();
    }
  }

  async check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [], windowMs };
      this.store.set(key, entry);
    }

    // Drop timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    const count = entry.timestamps.length;

    if (count >= maxRequests) {
      const oldestInWindow = entry.timestamps[0] ?? now;
      const resetInMs = Math.max(0, oldestInWindow + windowMs - now);
      return { allowed: false, remaining: 0, resetInMs };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: maxRequests - count - 1, resetInMs: 0 };
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      const cutoff = now - entry.windowMs;
      if (entry.timestamps.every((t) => t <= cutoff)) {
        this.store.delete(key);
      }
    }
  }

  /** For testing — reset all state */
  reset(): void {
    this.store.clear();
  }

  /** For testing — get raw window state */
  getState(key: string): number[] | undefined {
    return this.store.get(key)?.timestamps;
  }
}
