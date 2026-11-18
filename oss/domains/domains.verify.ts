/**
 * Runtime check for custom domains without Vercel (oss/domains/self-host.ts,
 * the guards in lib/domains.ts, /api/domains/caddy-ask). Needs network DNS
 * and the dev database (creates and deletes a throwaway team):
 *   npx tsx --tsconfig oss/tsconfig.jobs.json oss/domains/domains.verify.ts
 */
import { loadEnvConfig } from "@next/env";
import { resolve4 } from "node:dns/promises";

import { assert, check } from "../jobs/testing";

loadEnvConfig(process.cwd());
delete process.env.PROJECT_ID_VERCEL;

async function main() {
  const domains = await import("../../lib/domains");
  const { default: prisma } = await import("../../lib/prisma");
  const { default: ask } = await import("../../pages/api/domains/caddy-ask");

  await check("no Vercel: add/get/verify answer locally", async () => {
    const added = (await domains.addDomainToVercel("Links.Example.COM")) as any;
    assert(added.name === "links.example.com" && added.verified, "add");
    const got = await domains.getDomainResponse("links.example.com");
    assert(got.verified && !got.error, "get: verified, no error");
    assert(
      (await domains.verifyDomain("links.example.com")).verified,
      "verify",
    );
    await domains.removeDomainFromVercelProject("links.example.com");
    await domains.removeDomainFromVercelTeam("links.example.com");
  });

  await check("config: CNAME to the target is valid", async () => {
    process.env.CUSTOM_DOMAIN_TARGET_CNAME = "github.com";
    const cfg = (await domains.getConfigResponse("www.github.com")) as any;
    assert(
      !cfg.misconfigured && cfg.configuredBy === "CNAME",
      JSON.stringify(cfg),
    );
    assert(
      cfg.recommendedCNAME[0].value === "github.com.",
      "recommended CNAME",
    );
  });

  await check("config: A records on the target IPs are valid", async () => {
    process.env.CUSTOM_DOMAIN_TARGET_IPS = (await resolve4("example.com")).join(
      ",",
    );
    const cfg = (await domains.getConfigResponse("example.com")) as any;
    assert(!cfg.misconfigured && cfg.configuredBy === "A", JSON.stringify(cfg));
  });

  await check("config: elsewhere or nonexistent is misconfigured", async () => {
    process.env.CUSTOM_DOMAIN_TARGET_IPS = "203.0.113.7";
    for (const d of ["example.com", "does-not-exist-7f3a9c.example.invalid"]) {
      const cfg = (await domains.getConfigResponse(d)) as any;
      assert(cfg.misconfigured && cfg.configuredBy === null, d);
      assert(
        cfg.recommendedIPv4[0].value[0] === "203.0.113.7",
        "recommended IP",
      );
    }
  });

  const team = await prisma.team.create({ data: { name: "domains-verify" } });
  const slug = `verify-${Date.now()}.example.com`;
  const call = async (domain: string) => {
    let status = 0;
    const res: any = {
      status(code: number) {
        status = code;
        return res;
      },
      end() {
        return res;
      },
    };
    await ask({ method: "GET", query: { domain } } as any, res);
    return status;
  };
  try {
    await check(
      "caddy-ask: only verified domains get a certificate",
      async () => {
        await prisma.domain.create({
          data: { slug, teamId: team.id, verified: false },
        });
        assert((await call(slug)) === 404, "unverified → 404");
        await prisma.domain.update({
          where: { slug },
          data: { verified: true },
        });
        assert((await call(slug)) === 200, "verified → 200");
        assert(
          (await call(`${slug.toUpperCase()}.`)) === 200,
          "case/trailing dot",
        );
        assert((await call("unknown.example.com")) === 404, "unknown → 404");
        assert((await call("")) === 400, "empty → 400");
      },
    );
  } finally {
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
