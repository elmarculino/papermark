/**
 * Server-side checks for passkey login refusals (the happy path is checked
 * in a browser with a virtual authenticator). Needs Redis from .env.local:
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/passkeys/passkeys.verify.ts
 */
import { loadEnvConfig } from "@next/env";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());

async function main() {
  const { startPasskeyLogin, verifyPasskeyLogin } = await import("./server");
  const { redis } = await import("../../lib/redis");
  const fake = {
    id: "not-a-registered-credential",
    rawId: "not-a-registered-credential",
    type: "public-key",
    response: { clientDataJSON: "", authenticatorData: "", signature: "" },
    clientExtensionResults: {},
  } as never;

  await check("login options: a stored one-time challenge", async () => {
    const { challengeId, options } = await startPasskeyLogin();
    assert(/^[A-Za-z0-9_-]{24}$/.test(challengeId), challengeId);
    const stored = await redis.get(`passkey:auth:${challengeId}`);
    assert(stored === options.publicKey.challenge, "challenge stored");
    assert(
      options.publicKey.rpId === new URL(process.env.NEXTAUTH_URL!).hostname,
      "rpId",
    );
  });

  await check("unknown credential: refused, challenge used up", async () => {
    const { challengeId } = await startPasskeyLogin();
    assert(
      (await verifyPasskeyLogin({ challengeId, response: fake })) === null,
      "null",
    );
    assert(
      (await redis.get(`passkey:auth:${challengeId}`)) === null,
      "challenge deleted",
    );
  });

  await check("malformed or unknown challenge id: refused", async () => {
    for (const challengeId of [
      "",
      "../x",
      "a".repeat(200),
      "AAAAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      assert(
        (await verifyPasskeyLogin({ challengeId, response: fake })) === null,
        challengeId,
      );
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
