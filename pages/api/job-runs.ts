import type { NextApiRequest, NextApiResponse } from "next";

import { handleJobRuns } from "@/oss/jobs/job-runs-handler";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { status, body } = await handleJobRuns(req);
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}
