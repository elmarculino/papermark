// [fork] Not in upstream's public repo. Returns the team's plan for usePlan()
// (lib/swr/use-billing.ts). Self-hosted: no Stripe, never paused, no discount.
import type { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import type { CustomUser } from "@/lib/types";

import { authOptions } from "../../../auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId } = req.query as { teamId: string };
  const userId = (session.user as CustomUser).id;
  if (!userId) {
    // An empty userId would drop Prisma's membership filter and match any team.
    return res.status(401).end("Unauthorized");
  }

  const team = await prisma.team.findFirst({
    where: { id: teamId, users: { some: { userId } } },
    select: { plan: true, startsAt: true, endsAt: true, trialEndsAt: true },
  });
  if (!team) {
    return res.status(404).end("Team not found");
  }

  return res.status(200).json({
    plan: team.plan,
    startsAt: team.startsAt,
    endsAt: team.endsAt,
    pausedAt: null,
    pauseStartsAt: null,
    pauseEndsAt: null,
    isPaused: false,
    cancelledAt: null,
    trialEndsAt: team.trialEndsAt,
    isCustomer: false,
    subscriptionCycle: "monthly",
    discount: null,
  });
}
