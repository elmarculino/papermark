/**
 * [fork] Custom link domains without Vercel. lib/domains.ts uses these when
 * PROJECT_ID_VERCEL is unset: adding/removing a domain only touches the
 * database (TLS comes from the reverse proxy, e.g. Caddy on-demand TLS asking
 * /api/domains/caddy-ask), the domain is always "verified" for the project,
 * and the configuration check resolves the domain's DNS and compares it with
 * the install's target:
 *   CUSTOM_DOMAIN_TARGET_CNAME  hostname a CNAME should point to
 *                               (blank = the public link host)
 *   CUSTOM_DOMAIN_TARGET_IPS    IPv4 addresses an A record may point to,
 *                               comma-separated (blank = what the CNAME
 *                               target resolves to)
 * Responses keep Vercel's shapes, so the verify route and the domain UI work
 * unchanged (the UI shows recommendedIPv4 / recommendedCNAME as the records
 * to create).
 */
import { PUBLIC_LINK_HOST } from "@/ee/_shared/public-host";

import type {
  DomainConfigResponse,
  DomainResponse,
  DomainVerificationResponse,
} from "@/lib/types";

const norm = (host: string) => host.toLowerCase().replace(/\.$/, "");

// lib/domains.ts also reaches client components (for its pure helpers), so
// node:dns is loaded natively at call time, never bundled.
const dns = (): Promise<typeof import("node:dns/promises")> =>
  import(/* webpackIgnore: true */ "node:dns/promises");

function apexOf(domain: string) {
  return domain.split(".").slice(-2).join(".");
}

export function targetCname(): string {
  return norm(
    process.env.CUSTOM_DOMAIN_TARGET_CNAME?.trim() || PUBLIC_LINK_HOST,
  );
}

async function targetIps(): Promise<string[]> {
  const configured = (process.env.CUSTOM_DOMAIN_TARGET_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return (await dns()).resolve4(targetCname()).catch(() => []);
}

/** Vercel's GET project domain, for a domain the fork serves itself. */
export function selfHostDomainResponse(
  domain: string,
): DomainResponse & { error: { code: string; message: string } } {
  const name = norm(domain);
  return {
    name,
    apexName: apexOf(name),
    projectId: "self-host",
    verified: true,
    verification: [],
  } as unknown as DomainResponse & { error: { code: string; message: string } };
}

export function selfHostVerification(
  domain: string,
): DomainVerificationResponse {
  const name = norm(domain);
  return {
    name,
    apexName: apexOf(name),
    projectId: "self-host",
    verified: true,
  };
}

/** Does the domain's DNS point at this install? Vercel's config shape. */
export async function selfHostConfigResponse(domain: string): Promise<
  DomainConfigResponse & {
    recommendedIPv4: { rank: number; value: string[] }[];
    recommendedCNAME: { rank: number; value: string }[];
  }
> {
  const name = norm(domain);
  const cname = targetCname();
  const ips = await targetIps();
  const recommended = {
    recommendedIPv4: [{ rank: 1, value: ips }],
    recommendedCNAME: [{ rank: 1, value: `${cname}.` }],
    conflicts: [],
    acceptedChallenges: ["http-01" as const],
  };

  const { resolve4, resolveCname } = await dns();
  const cnames = await resolveCname(name).catch(() => [] as string[]);
  if (cnames.some((c) => norm(c) === cname)) {
    return { ...recommended, configuredBy: "CNAME", misconfigured: false };
  }
  const addresses = await resolve4(name).catch(() => [] as string[]);
  if (
    addresses.length > 0 &&
    ips.length > 0 &&
    addresses.every((a) => ips.includes(a))
  ) {
    return { ...recommended, configuredBy: "A", misconfigured: false };
  }
  return { ...recommended, configuredBy: null, misconfigured: true };
}
