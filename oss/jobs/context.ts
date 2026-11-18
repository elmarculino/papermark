/** Per-run context carried through AsyncLocalStorage while a task body runs. */
import { AsyncLocalStorage } from "node:async_hooks";

export type RunContext = {
  runId: string;
  taskId: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
  canceled: boolean;
  /** Settles when the run's pending metadata writes have been flushed. */
  writes: Promise<void>;
  /** Releases the worker slot while `fn` waits on child runs. */
  yieldSlot<T>(fn: () => Promise<T>): Promise<T>;
};

export const runStorage = new AsyncLocalStorage<RunContext>();

export function currentRun(): RunContext | undefined {
  return runStorage.getStore();
}

export class RunCanceledError extends Error {
  constructor(message = "Run was canceled") {
    super(message);
    this.name = "RunCanceledError";
  }
}

/** Throws RunCanceledError once the current run has been canceled. */
export function checkpoint(): void {
  if (currentRun()?.canceled) throw new RunCanceledError();
}
