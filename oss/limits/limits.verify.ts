/**
 * Runtime check for the self-hosted limits shim. Needs a migrated Postgres:
 *   POSTGRES_PRISMA_URL=... npx tsx oss/limits/limits.verify.ts
 */
import { canCreateUnlimitedTeam } from "@/ee/limits/can-create-unlimited-team";
import { DATAROOMS_UNLIMITED_PLAN_LIMITS } from "@/ee/limits/constants";
import { getLimits } from "@/ee/limits/server";

import prisma from "@/lib/prisma";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

    // Same data pages/api/teams/index.ts writes for an unlimited team.
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
    for (const key of [
      "documents",
      "links",
      "users",
      "domains",
      "datarooms",
    ] as const) {
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
