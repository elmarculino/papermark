/**
 * Runtime check for FEATURE_FLAGS (feature flags without Vercel Edge Config):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/_shared/feature-flags.verify.ts
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());
// .env.local may set an Edge Config; these checks cover the env-driven branch.
delete process.env.EDGE_CONFIG;

async function main() {
  const { getFeatureFlags } = await import("../../lib/featureFlags");

  // Expected keys come from the BetaFeatures union in the source.
  const source = readFileSync("lib/featureFlags/index.ts", "utf8");
  const union = source.match(/export type BetaFeatures =([^;]+);/)![1];
  const expectedKeys = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };

  await check("FEATURE_FLAGS enables the named flags only", async () => {
    process.env.FEATURE_FLAGS = "tokens, incomingWebhooks,notAFlag,constructor";
    const flags = await getFeatureFlags({ teamId: "t1" });
    assert(flags.tokens === true, "tokens === true");
    assert(flags.incomingWebhooks === true, "incomingWebhooks === true");
    assert(flags.webhooks === false, "webhooks === false");
    assert(
      Object.keys(flags).sort().join() === expectedKeys.join(),
      "result has exactly the BetaFeatures keys",
    );
    assert(!("notAFlag" in flags), "unknown names are not added");
  });

  await check("unknown names warn once per process", async () => {
    await getFeatureFlags({ teamId: "t1" });
    await getFeatureFlags({});
    const unknown = warnings.filter((w) => w.includes("notAFlag"));
    assert(unknown.length === 1, `one warning, got ${unknown.length}`);
  });

  await check("flags apply without a teamId", async () => {
    const flags = await getFeatureFlags({});
    assert(flags.tokens === true, "tokens === true without teamId");
  });

  await check("FEATURE_FLAGS unset: every flag false", async () => {
    delete process.env.FEATURE_FLAGS;
    const flags = await getFeatureFlags({ teamId: "t1" });
    assert(
      Object.keys(flags).sort().join() === expectedKeys.join(),
      "exact keys",
    );
    assert(
      Object.values(flags).every((v) => v === false),
      "all false",
    );
  });

  console.warn = realWarn;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
