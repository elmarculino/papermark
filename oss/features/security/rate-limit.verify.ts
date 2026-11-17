/**
 * Runtime check for rate limiting. Needs an Upstash-compatible REST endpoint
 * (Upstash, or serverless-redis-http in front of Redis):
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npx tsx oss/features/security/rate-limit.verify.ts
 */
import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const id = `verify:${Date.now()}`;

  // bulkLinkImport allows 5 per hour.
  for (let i = 1; i <= 5; i++) {
    const result = await checkRateLimit(rateLimiters.bulkLinkImport, id);
    assert(result.success, `request ${i} of 5 must pass`);
    assert(
      result.remaining === 5 - i,
      `remaining after ${i} should be ${5 - i}, got ${result.remaining}`,
    );
  }
  const blocked = await checkRateLimit(rateLimiters.bulkLinkImport, id);
  assert(
    !blocked.success && blocked.remaining === 0,
    "6th request in the window is blocked",
  );

  // Other limiters and identifiers are independent.
  assert(
    (await checkRateLimit(rateLimiters.auth, id)).success,
    "auth limiter is separate",
  );
  assert(
    (await checkRateLimit(rateLimiters.bulkLinkImport, `${id}:other`)).success,
    "keys are separate",
  );

  // Redis unreachable: fail open.
  const unreachable = new Ratelimit({
    redis: new Redis({ url: "http://127.0.0.1:1", token: "x", retry: false }),
    limiter: Ratelimit.slidingWindow(1, "1 m"),
  });
  const originalError = console.error;
  console.error = () => {};
  const open = await checkRateLimit(unreachable, id);
  console.error = originalError;
  assert(open.success, "requests are allowed when Redis is down");

  console.log("rate-limit.verify: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
