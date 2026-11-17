import type { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import type { CustomUser } from "@/lib/types";

import { getLimits } from "./server";

/** GET /api/teams/:teamId/limits */
export default async function limitsHandler(
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

  try {
    const limits = await getLimits({ teamId, userId });
    return res.status(200).json(limits);
  } catch {
    return res.status(404).end("Team not found");
  }
}
