import type { NextApiRequest, NextApiResponse } from "next";

/** No billing when self-hosted: no pause/resume notifications. */
export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  return res.status(404).json({ error: "Not available" });
}
