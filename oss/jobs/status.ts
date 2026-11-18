export type RunStatus =
  | "QUEUED"
  | "DELAYED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "CRASHED";

export type RunFlags = {
  isQueued: boolean;
  isExecuting: boolean;
  isCompleted: boolean;
  isSuccess: boolean;
  isFailed: boolean;
  isCancelled: boolean;
};

/**
 * Maps a DBOS workflow status (plus whether the run has started) to the
 * Trigger.dev-style run status.
 */
export function toRunStatus(
  dbosStatus: string,
  startedAt: Date | null,
): RunStatus {
  switch (dbosStatus) {
    case "ENQUEUED":
      return "QUEUED";
    case "PENDING":
      return startedAt ? "EXECUTING" : "QUEUED";
    case "DELAYED":
      return "DELAYED";
    case "SUCCESS":
      return "COMPLETED";
    case "ERROR":
      return "FAILED";
    case "CANCELLED":
      return "CANCELED";
    case "MAX_RECOVERY_ATTEMPTS_EXCEEDED":
      return "CRASHED";
    default:
      throw new Error(`Unknown DBOS workflow status "${dbosStatus}"`);
  }
}

/** True once the run can no longer change state. */
export function isFinalStatus(s: RunStatus): boolean {
  return (
    s === "COMPLETED" || s === "FAILED" || s === "CANCELED" || s === "CRASHED"
  );
}

/** Same flag semantics as Trigger.dev's run objects. */
export function runFlags(s: RunStatus): RunFlags {
  return {
    isQueued: s === "QUEUED" || s === "DELAYED",
    isExecuting: s === "EXECUTING",
    isCompleted: s === "COMPLETED" || s === "FAILED" || s === "CRASHED",
    isSuccess: s === "COMPLETED",
    isFailed: s === "FAILED" || s === "CRASHED",
    isCancelled: s === "CANCELED",
  };
}
