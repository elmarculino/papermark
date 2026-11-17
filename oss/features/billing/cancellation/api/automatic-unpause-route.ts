import type { NextApiRequest, NextApiResponse } from "next";

/** No billing when self-hosted: there is nothing to unpause. */
export async function handleRoute(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(404).json({ error: "Not available" });
}
