/** Logic of `GET /api/job-runs`: run state for the realtime hooks, gated by a public token. */
import { jobsBackend } from "./config";
import { listRuns, retrieveRun } from "./runs";
import { verifyPublicToken } from "./token";

type Req = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};
type Res = { status: number; body: unknown };

const MAX_TAG_RUNS = 20;
const TAG_WINDOW = "24h";

const fail = (status: number, error: string): Res => ({
  status,
  body: { error },
});

const single = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function serialize(run: Awaited<ReturnType<typeof retrieveRun>>) {
  // The raw payload is never exposed to the browser.
  const { payload: _payload, createdAt, startedAt, ...rest } = run;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
  };
}

export async function handleJobRuns(req: Req): Promise<Res> {
  if (jobsBackend() !== "dbos") return fail(404, "Not found");
  if (req.method !== "GET") return fail(405, "Method not allowed");

  const runId = single(req.query.runId);
  const tag = single(req.query.tag);
  if (!runId === !tag) {
    return fail(400, "Provide exactly one of runId or tag");
  }

  const header = single(req.headers.authorization) ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return fail(401, "Missing access token");

  let scope: { tags: string[]; runs: string[] } | null;
  try {
    scope = verifyPublicToken(match[1]);
  } catch (error) {
    console.error("job-runs: cannot verify tokens", error);
    return fail(500, "Server misconfigured");
  }
  if (!scope) return fail(401, "Invalid or expired access token");

  try {
    if (runId) {
      if (!scope.runs.includes(runId)) return fail(403, "Forbidden");
      const run = await retrieveRun(runId);
      return { status: 200, body: { runs: [serialize(run)] } };
    }
    if (!scope.tags.includes(tag!)) return fail(403, "Forbidden");
    const { data } = await listRuns({
      tag,
      period: TAG_WINDOW,
      limit: MAX_TAG_RUNS,
    });
    const runs = data
      .map((run) => ({ ...run, payload: undefined }))
      .map((run) => serialize(run as Parameters<typeof serialize>[0]));
    return { status: 200, body: { runs } };
  } catch (error) {
    if (error instanceof Error && /not found$/.test(error.message)) {
      return fail(404, "Run not found");
    }
    console.error("job-runs: lookup failed", error);
    return fail(500, "Internal error");
  }
}
