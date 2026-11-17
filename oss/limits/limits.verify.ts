/**
 * Runtime check for the self-hosted plan and limits. Needs a migrated Postgres:
 *   POSTGRES_PRISMA_URL=... NEXTAUTH_SECRET=... npx tsx --tsconfig oss/tsconfig.verify.json oss/limits/limits.verify.ts
 */
import type { NextApiRequest, NextApiResponse } from "next";

import { canCreateUnlimitedTeam } from "@/ee/limits/can-create-unlimited-team";
import { DATAROOMS_UNLIMITED_PLAN_LIMITS } from "@/ee/limits/constants";
import { getLimits } from "@/ee/limits/server";
import planHandler from "@/pages/api/teams/[teamId]/billing/plan";
import { encode } from "next-auth/jwt";

import prisma from "@/lib/prisma";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Calls a pages-router API handler, optionally as a signed-in user (JWT session cookie). */
async function callApi(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  query: Record<string, string>,
  user?: { id: string; email: string },
) {
  const cookies: Record<string, string> = {};
  if (user) {
    cookies["next-auth.session-token"] = await encode({
      token: { sub: user.id, email: user.email, user },
      secret: process.env.NEXTAUTH_SECRET!,
    });
  }
  const req = {
    method: "GET",
    query,
    cookies,
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  } as unknown as NextApiRequest;
  const out = { status: 0, body: undefined as any };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
    end(body?: unknown) {
      out.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return out;
}

async function main() {
  const suffix = Date.now().toString(36);
  const user = await prisma.user.create({
    data: { email: `limits-${suffix}@verify.test` },
  });
  const outsider = await prisma.user.create({
    data: { email: `outsider-${suffix}@verify.test` },
  });

  try {
    assert(
      (await canCreateUnlimitedTeam(user.id)) === true,
      "every user may create unlimited teams",
    );

    // Same data the first-login path in pages/api/teams/index.ts (GET) writes: no plan given.
    const defaultTeam = await prisma.team.create({
      data: {
        name: "default",
        users: { create: { userId: user.id, role: "ADMIN" } },
      },
    });
    assert(
      defaultTeam.plan === "datarooms-unlimited",
      `default team plan must be datarooms-unlimited, got ${defaultTeam.plan}`,
    );

    // usePlan() endpoint: real handler, real session cookie.
    const plan = await callApi(
      planHandler,
      { teamId: defaultTeam.id },
      { id: user.id, email: user.email! },
    );
    assert(plan.status === 200, `plan endpoint status ${plan.status}`);
    assert(
      plan.body.plan === "datarooms-unlimited" && plan.body.isPaused === false,
      `plan endpoint body ${JSON.stringify(plan.body)}`,
    );
    const anonymous = await callApi(planHandler, { teamId: defaultTeam.id });
    assert(anonymous.status === 401, "plan endpoint requires a session");
    const notMember = await callApi(
      planHandler,
      { teamId: defaultTeam.id },
      { id: outsider.id, email: outsider.email! },
    );
    assert(notMember.status === 404, "plan endpoint hides other teams");
    await prisma.team.delete({ where: { id: defaultTeam.id } });

    // Same data the create-team path (POST) writes for an unlimited team.
    const team = await prisma.team.create({
      data: {
        name: "verify",
        plan: "datarooms-unlimited",
        limits: structuredClone(DATAROOMS_UNLIMITED_PLAN_LIMITS) as object,
        users: { create: { userId: user.id, role: "ADMIN" } },
      },
    });

    const stored = (await prisma.team.findUnique({ where: { id: team.id } }))!
      .limits as Record<string, unknown>;
    assert(
      stored.documents === null,
      "Infinity is stored as null in the JSON column",
    );

    const limits = await getLimits({ teamId: team.id, userId: user.id });
    for (const key of ["documents", "links", "users", "domains"] as const) {
      assert(
        limits[key] === Infinity,
        `stored null ${key} must read back as Infinity, got ${limits[key]}`,
      );
    }
    assert(
      limits.usage.users === 1 && limits.usage.documents === 0,
      "usage counts come from the DB",
    );
    // Same checks the API routes use.
    assert(
      !(limits.usage.users >= limits.users),
      "invite.ts seat check never trips",
    );
    assert(!(5 >= limits.datarooms), "datarooms check never trips");

    // What the browser sees (JSON): client code reads `datarooms ?? 1` and
    // `linkCustomFields ?? 0`, so those must stay numbers; documents/links must
    // be null so the sidebar hides its usage bars.
    const client = JSON.parse(JSON.stringify(limits));
    assert(
      (client.datarooms ?? 1) > 1000,
      `client datarooms limit ${client.datarooms}`,
    );
    assert(
      (client.linkCustomFields ?? 0) > 0,
      `client custom fields limit ${client.linkCustomFields}`,
    );
    assert(
      client.documents === null && client.links === null,
      "documents/links reach the client as null (sidebar hides usage bars)",
    );

    // A manual per-team cap still applies.
    await prisma.team.update({
      where: { id: team.id },
      data: { limits: { users: 1 } },
    });
    const capped = await getLimits({ teamId: team.id, userId: user.id });
    assert(
      capped.users === 1 && capped.documents === Infinity,
      "stored numeric override wins",
    );

    let threw = false;
    try {
      await getLimits({ teamId: team.id, userId: outsider.id });
    } catch {
      threw = true;
    }
    assert(threw, "non-members must not read a team's limits");

    await prisma.team.delete({ where: { id: team.id } });
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [user.id, outsider.id] } },
    });
    await prisma.$disconnect();
  }
  console.log("limits.verify: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
