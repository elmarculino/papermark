"use client";

/** Polling replacements for `@trigger.dev/react-hooks`, backed by `/api/job-runs`. */
import useSWR from "swr";

import { type RunFlags, type RunStatus, isFinalStatus } from "../status";

/**
 * The layer only emits `RunStatus`; the extra names are Trigger.dev statuses
 * that upstream call sites still compare against.
 */
export type RealtimeRunStatus =
  | RunStatus
  | "WAITING"
  | "SYSTEM_FAILURE"
  | "TIMED_OUT"
  | "EXPIRED"
  | "PENDING_VERSION"
  | "DEQUEUED"
  | "INTERRUPTED";

export type RealtimeRun = {
  id: string;
  taskIdentifier: string;
  status: RealtimeRunStatus;
  tags: string[];
  metadata?: Record<string, unknown>;
  output?: unknown;
  createdAt: Date;
} & RunFlags;

type Options = { accessToken?: string; enabled?: boolean };

const POLL_MS = 1500;

type WireRun = Omit<RealtimeRun, "createdAt"> & { createdAt: string };

async function fetchRuns(
  query: string,
  accessToken: string,
): Promise<RealtimeRun[]> {
  const res = await fetch(`/api/job-runs?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load runs (HTTP ${res.status})`);
  }
  const { runs } = (await res.json()) as { runs: WireRun[] };
  return runs.map((run) => ({ ...run, createdAt: new Date(run.createdAt) }));
}

function useRuns(query: string | undefined, opts?: Options) {
  const token = opts?.accessToken;
  const active = opts?.enabled !== false && !!token && !!query;
  return useSWR<RealtimeRun[], Error>(
    active ? ["job-runs", query, token] : null,
    () => fetchRuns(query!, token!),
    {
      refreshInterval: (runs) =>
        !runs ||
        runs.length === 0 ||
        runs.some((r) => !isFinalStatus(r.status as RunStatus))
          ? POLL_MS
          : 0,
    },
  );
}

export function useRealtimeRun(
  runId?: string,
  opts?: Options,
): { run?: RealtimeRun; error?: Error } {
  const { data, error } = useRuns(
    runId ? `runId=${encodeURIComponent(runId)}` : undefined,
    opts,
  );
  return { run: data?.[0], error };
}

export function useRealtimeRunsWithTag(
  tag: string,
  opts?: Options,
): { runs: RealtimeRun[]; error?: Error } {
  const { data, error } = useRuns(
    tag ? `tag=${encodeURIComponent(tag)}` : undefined,
    opts,
  );
  return { runs: data ?? [], error };
}
