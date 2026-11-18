/** `runs.retrieve` / `runs.list` / `runs.cancel`: run state read from DBOS plus the layer's run rows. */
import type { WorkflowStatus } from "@dbos-inc/dbos-sdk";

import { getClient } from "./client";
import { parsePeriodMs } from "./duration";
import { type RunFlags, type RunStatus, runFlags, toRunStatus } from "./status";
import { type RunRow, findRunRows, getRunRow } from "./store";

export type RetrievedRun = {
  id: string;
  taskIdentifier: string;
  status: RunStatus;
  tags: string[];
  payload: unknown;
  output?: unknown;
  error?: { message: string };
  metadata: Record<string, unknown>;
  createdAt: Date;
  startedAt?: Date;
} & RunFlags;

const notFound = (id: string) => new Error(`Run "${id}" not found`);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

function describe(
  row: RunRow,
  workflow: Pick<WorkflowStatus, "status" | "error">,
): Omit<RetrievedRun, "payload" | "output"> {
  const status = toRunStatus(workflow.status, row.startedAt);
  const failed = status === "FAILED" || status === "CRASHED";
  return {
    id: row.id,
    taskIdentifier: row.taskId,
    status,
    tags: row.tags,
    ...(failed && workflow.error !== undefined && workflow.error !== null
      ? { error: { message: errorMessage(workflow.error) } }
      : {}),
    metadata: row.metadata,
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...runFlags(status),
  };
}

export async function retrieveRun(id: string): Promise<RetrievedRun> {
  const row = await getRunRow(id);
  const workflow = row
    ? await (await getClient()).getWorkflow(id)
    : undefined;
  if (!row || !workflow) throw notFound(id);
  const run: RetrievedRun = { ...describe(row, workflow), payload: row.payload };
  if (run.isSuccess) run.output = workflow.output;
  return run;
}

const asArray = <T>(v: T | T[] | undefined): T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

export async function listRuns(f: {
  taskIdentifier?: string | string[];
  tag?: string | string[];
  status?: RunStatus | RunStatus[];
  period?: string;
  limit?: number;
}): Promise<{ data: Omit<RetrievedRun, "payload" | "output">[] }> {
  const rows = await findRunRows({
    taskIds: asArray(f.taskIdentifier),
    anyTags: asArray(f.tag),
    since: f.period ? new Date(Date.now() - parsePeriodMs(f.period)) : undefined,
    limit: f.limit,
  });
  if (rows.length === 0) return { data: [] };
  const workflows = await (
    await getClient()
  ).listWorkflows({
    workflowIDs: rows.map((r) => r.id),
    loadInput: false,
    loadOutput: false,
  });
  const byId = new Map(workflows.map((w) => [w.workflowID, w]));
  const wanted = asArray(f.status);
  const data = rows.flatMap((row) => {
    const workflow = byId.get(row.id);
    if (!workflow) return [];
    const run = describe(row, workflow);
    return !wanted || wanted.includes(run.status) ? [run] : [];
  });
  return { data };
}

export async function cancelRun(id: string): Promise<{ id: string }> {
  const client = await getClient();
  if (!(await client.getWorkflow(id))) throw notFound(id);
  await client.cancelWorkflow(id);
  return { id };
}
