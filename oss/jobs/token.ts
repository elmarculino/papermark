/** Public access tokens for `/api/job-runs`: HMAC-signed, stateless, scoped to tags or runs. */
import { createHmac, timingSafeEqual } from "node:crypto";

import { parseDelay } from "./duration";

const PREFIX = "pmjob_";
/**
 * Every token lives at least this long, whatever the caller asks for: the
 * hooks stop polling on a 401 and the progress bar caches its token for the
 * tab's life, so a short expiry would hide the completion of a long run.
 * Tokens are read-only and scoped to tags or runs.
 */
const MIN_EXPIRY_SECONDS = 24 * 60 * 60;

type TokenPayload = { tags: string[]; runs: string[]; exp: number };

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) {
    throw new Error("NEXTAUTH_SECRET is required to sign job public tokens");
  }
  return value;
}

const sign = (body: string) =>
  createHmac("sha256", secret()).update(body).digest("base64url");

export async function createPublicToken(opts: {
  scopes: { read: { tags?: string[]; runs?: string[] } };
  expirationTime?: string;
}): Promise<string> {
  const requested = opts.expirationTime ? parseDelay(opts.expirationTime) : 0;
  const seconds = Math.max(requested, MIN_EXPIRY_SECONDS);
  const payload: TokenPayload = {
    tags: opts.scopes.read.tags ?? [],
    runs: opts.scopes.read.runs ?? [],
    exp: Date.now() + seconds * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${PREFIX}${body}.${sign(body)}`;
}

/** The token's read scope, or null if malformed, forged or expired. */
export function verifyPublicToken(
  token: string,
): { tags: string[]; runs: string[] } | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  const parts = token.slice(PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (
      !Array.isArray(payload.tags) ||
      !Array.isArray(payload.runs) ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now()
    ) {
      return null;
    }
    return { tags: payload.tags, runs: payload.runs };
  } catch {
    return null;
  }
}
