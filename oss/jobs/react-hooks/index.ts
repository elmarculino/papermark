"use client";

/** Polling replacements for `@trigger.dev/react-hooks`, backed by `/api/job-runs`. */
import { useRef } from "react";

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

export class RunsHttpError extends Error {
  constructor(readonly status: number) {
    super(`Failed to load runs (HTTP ${status})`);
  }
}

/** Auth and lookup failures don't heal by retrying. */
const isTerminalError = (error?: Error) =>
  error instanceof RunsHttpError && [401, 403, 404].includes(error.status);

/** Polling interval: 1500 ms while any run isn't final (or none loaded), else 0. */
export function pollIntervalFor(
  runs: Pick<RealtimeRun, "status">[] | undefined,
  error?: Error,
): number {
  if (isTerminalError(error)) return 0;
  return !runs ||
    runs.length === 0 ||
    runs.some((r) => !isFinalStatus(r.status as RunStatus))
    ? POLL_MS
    : 0;
}

async function fetchRuns(
  query: string,
  accessToken: string,
): Promise<RealtimeRun[]> {
  const res = await fetch(`/api/job-runs?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new RunsHttpError(res.status);
  const { runs } = (await res.json()) as { runs: WireRun[] };
  return runs.map((run) => ({ ...run, createdAt: new Date(run.createdAt) }));
}

function useRuns(query: string | undefined, opts?: Options) {
  const token = opts?.accessToken;
  const active = opts?.enabled !== false && !!token && !!query;
  // SWR's refreshInterval callback only sees the data, so the last error
  // (cleared when a new fetch starts) is tracked here.
  const lastError = useRef<Error | undefined>(undefined);
  return useSWR<RealtimeRun[], Error>(
    active ? ["job-runs", query, token] : null,
    () => {
      lastError.current = undefined;
      return fetchRuns(query!, token!);
    },
    {
      refreshInterval: (runs) => pollIntervalFor(runs, lastError.current),
      onError: (error) => {
        lastError.current = error;
      },
      shouldRetryOnError: (error) => !isTerminalError(error),
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
