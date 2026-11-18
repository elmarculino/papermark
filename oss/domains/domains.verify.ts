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

  const selfHost = await import("./self-host");

  await check(
    "zone apex follows the DNS zone, not the last two labels",
    async () => {
      assert(
        (await selfHost.zoneApex("gist.github.com")) === "github.com",
        "github.com",
      );
      assert(
        (await selfHost.zoneApex("www.uol.com.br")) === "uol.com.br",
        "uol.com.br",
      );
      assert(
        (await selfHost.zoneApex("uol.com.br")) === "uol.com.br",
        "apex itself",
      );
    },
  );

  await check("no Vercel: add and remove answer locally", async () => {
    const added = (await domains.addDomainToVercel("Links.Example.COM")) as any;
    assert(added.name === "links.example.com", "add");
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
      "ownership: pending until the team's TXT token is published",
      async () => {
        const name = `own-${Date.now()}.example.com`;
        await prisma.domain.create({ data: { slug: name, teamId: team.id } });
        const pending = await domains.getDomainResponse(name);
        const token = await selfHost.ownershipToken(team.id, name);
        assert(!pending.verified && !pending.error, "pending, no error");
        assert(
          pending.verification[0]?.type === "TXT" &&
            pending.verification[0].domain === `_papermark-verify.${name}` &&
            pending.verification[0].value === token,
          JSON.stringify(pending.verification),
        );
        assert(!(await domains.verifyDomain(name)).verified, "verify: not yet");
        assert(
          (await selfHost.ownershipToken("another-team", name)) !== token,
          "token is per team",
        );
        // Publish the record (swap Node's resolver; the module loads it natively).
        const dnsp = require("node:dns/promises");
        const real = dnsp.resolveTxt;
        dnsp.resolveTxt = async (q: string) =>
          q === `_papermark-verify.${name}`
            ? [[token.slice(0, 20), token.slice(20)]]
            : real(q);
        require("node:module").syncBuiltinESMExports();
        try {
          const done = await domains.getDomainResponse(name);
          assert(done.verified && done.verification.length === 0, "verified");
          assert((await domains.verifyDomain(name)).verified, "verify: yes");
        } finally {
          dnsp.resolveTxt = real;
          require("node:module").syncBuiltinESMExports();
        }
      },
    );

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
