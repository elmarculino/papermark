import prisma from "@/lib/prisma";

import { type PlanLimits, UNLIMITED_PLAN_LIMITS } from "./constants";

export type TeamUsage = {
  documents: number;
  links: number;
  users: number;
};

export type TeamLimits = PlanLimits & { usage: TeamUsage };

/**
 * Returns the team's limits (always unlimited when self-hosted) plus current usage.
 * Throws if the user is not a member of the team.
 */
export async function getLimits({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}): Promise<TeamLimits> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, users: { some: { userId } } },
    select: {
      limits: true,
      _count: { select: { documents: true, links: true, users: true } },
    },
  });

  if (!team) {
    throw new Error("Team not found");
  }

  // Stored per-team overrides win, so limits can still be set manually in the DB.
  // `null` in the JSON column means unlimited (Infinity serializes to null), so skip it.
  const stored: Partial<PlanLimits> = {};
  if (
    team.limits &&
    typeof team.limits === "object" &&
    !Array.isArray(team.limits)
  ) {
    for (const [key, value] of Object.entries(team.limits)) {
      if (value !== null) (stored as Record<string, unknown>)[key] = value;
    }
  }

  return {
    ...UNLIMITED_PLAN_LIMITS,
    ...stored,
    usage: {
      documents: team._count.documents,
      links: team._count.links,
      users: team._count.users,
    },
  };
}
