/**
 * [fork] Custom link domains without Vercel. lib/domains.ts uses these when
 * PROJECT_ID_VERCEL is unset: adding/removing a domain only touches the
 * database (TLS comes from the reverse proxy, e.g. Caddy on-demand TLS asking
 * /api/domains/caddy-ask), and two DNS checks replace Vercel's:
 *
 * - Ownership: a TXT record `_papermark-verify.<domain>` holding a token that
 *   is an HMAC of the owning team and the domain (nothing stored). Until it
 *   is there the domain is "Pending Verification" and the UI shows the record,
 *   so a team can't claim a name whose DNS it doesn't control.
 * - Configuration: the domain's CNAME equals CUSTOM_DOMAIN_TARGET_CNAME
 *   (blank = the public link hostname), or all its A records are within
 *   CUSTOM_DOMAIN_TARGET_IPS (blank = what the CNAME target resolves to;
 *   set it explicitly when the install sits behind a shared proxy/CDN).
 *
 * Responses keep Vercel's shapes, so the verify route and the domain UI work
 * unchanged (the UI shows recommendedIPv4 / recommendedCNAME and the TXT
 * verification as the records to create).
 */
import { PUBLIC_LINK_BASE_URL } from "@/ee/_shared/public-host";

import type {
  DomainConfigResponse,
  DomainResponse,
  DomainVerificationResponse,
} from "@/lib/types";

const norm = (host: string) => host.toLowerCase().replace(/\.$/, "");

// lib/domains.ts also reaches client components (for its pure helpers), so
// node:dns is loaded natively at call time, never bundled, and Prisma only
// when a server-side check runs.
const dns = (): Promise<typeof import("node:dns/promises")> =>
  import(/* webpackIgnore: true */ "node:dns/promises");
const db = async () => (await import("@/lib/prisma")).default;

export const OWNERSHIP_LABEL = "_papermark-verify";

/** The zone the name lives in (first ancestor with an SOA), e.g.
 * links.empresa.com.br → empresa.com.br. Falls back to the last two labels
 * when nothing resolves yet. */
export async function zoneApex(name: string): Promise<string> {
  const { resolveSoa, resolveCname } = await dns();
  const ok = (p: Promise<unknown>) =>
    p.then(
      () => true,
      () => false,
    );
  const labels = name.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    // An SOA lookup follows a CNAME, and a CNAME can't sit at a zone apex.
    if (await ok(resolveCname(candidate))) continue;
    if (await ok(resolveSoa(candidate))) {
      return candidate;
    }
  }
  return labels.slice(-2).join(".");
}

export function targetCname(): string {
  return norm(
    process.env.CUSTOM_DOMAIN_TARGET_CNAME?.trim() ||
      new URL(PUBLIC_LINK_BASE_URL).hostname,
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

/** The TXT value proving `teamId` controls `name`'s DNS. WebCrypto, so no
 * Node module reaches the client bundle. */
export async function ownershipToken(
  teamId: string,
  name: string,
): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET must be set");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`custom-domain:${teamId}:${name}`),
    ),
  )
    .toString("base64url")
    .slice(0, 32);
  return `papermark-domain-verification=${mac}`;
}

async function ownership(name: string) {
  const row = await (
    await db()
  ).domain.findUnique({
    where: { slug: name },
    select: { teamId: true },
  });
  if (!row) return { verified: false, token: null as string | null };
  const token = await ownershipToken(row.teamId, name);
  const records = await (await dns())
    .resolveTxt(`${OWNERSHIP_LABEL}.${name}`)
    .catch(() => [] as string[][]);
  return { verified: records.some((r) => r.join("") === token), token };
}

/** Vercel's GET project domain, for a domain the fork serves itself. */
export async function selfHostDomainResponse(
  domain: string,
): Promise<DomainResponse & { error: { code: string; message: string } }> {
  const name = norm(domain);
  const [apexName, { verified, token }] = await Promise.all([
    zoneApex(name),
    ownership(name),
  ]);
  return {
    name,
    apexName,
    projectId: "self-host",
    verified,
    verification:
      verified || !token
        ? []
        : [
            {
              type: "TXT",
              domain: `${OWNERSHIP_LABEL}.${name}`,
              value: token,
              reason: "pending_domain_verification",
            },
          ],
  } as unknown as DomainResponse & { error: { code: string; message: string } };
}

export async function selfHostVerification(
  domain: string,
): Promise<DomainVerificationResponse> {
  const name = norm(domain);
  const [apexName, { verified }] = await Promise.all([
    zoneApex(name),
    ownership(name),
  ]);
  return { name, apexName, projectId: "self-host", verified };
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
    // Never empty: the UI would fall back to Vercel's address.
    recommendedIPv4: [
      {
        rank: 1,
        value: ips.length > 0 ? ips : ["(set CUSTOM_DOMAIN_TARGET_IPS)"],
      },
    ],
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
