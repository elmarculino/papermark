// [fork] Caddy on-demand TLS "ask" endpoint: 200 only for a custom domain a
// team added and verified, so the proxy requests certificates for nothing else.
//   on_demand_tls { ask http://<app>:3000/api/domains/caddy-ask }
import { NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end();
  const domain = String(req.query.domain ?? "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!domain || domain.length > 253) return res.status(400).end();
  const found = await prisma.domain.findFirst({
    where: { slug: domain, verified: true },
    select: { id: true },
  });
  return res.status(found ? 200 : 404).end();
}
