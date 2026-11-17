import type { Ratelimit } from "@upstash/ratelimit";

import { ratelimit } from "@/lib/redis";

/** Named sliding-window limiters, backed by the app's Upstash Redis (lib/redis). */
export const rateLimiters = {
  /** Login attempts, keyed by client IP. */
  auth: ratelimit(10, "1 m"),
  /** Custom-domain DNS verification, keyed by user + team. */
  domainVerification: ratelimit(10, "1 m"),
  /** Bulk link CSV imports, keyed by team. */
  bulkLinkImport: ratelimit(5, "1 h"),
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

/**
 * Checks `identifier` against `limiter`. Fails open: if Redis is unreachable the
 * request is allowed (and logged), so an outage doesn't lock everyone out of login.
 */
export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<RateLimitResult> {
  try {
    const { success, limit, remaining, reset } =
      await limiter.limit(identifier);
    return { success, limit, remaining, reset };
  } catch (error) {
    console.error("[rate-limit] check failed, allowing request:", error);
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
}
