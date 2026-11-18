export type RetryOptions = {
  maxAttempts?: number;
  minTimeoutInMs?: number;
  maxTimeoutInMs?: number;
  factor?: number;
  randomize?: boolean;
};

export type ResolvedRetry = Required<RetryOptions>;

const BUILT_IN: ResolvedRetry = {
  maxAttempts: 3,
  minTimeoutInMs: 1000,
  maxTimeoutInMs: 10000,
  factor: 2,
  randomize: true,
};

let defaults: RetryOptions = {};

/** Project-wide defaults (trigger.config `retries.default`). */
export function setRetryDefaults(d: RetryOptions): void {
  defaults = { ...d };
}

/**
 * Precedence: maxAttempts passed at trigger time, then the task's retry, then
 * project defaults, then the built-in fallback.
 */
export function resolveRetry(
  task?: RetryOptions,
  triggerMaxAttempts?: number,
): ResolvedRetry {
  const resolved: ResolvedRetry = { ...BUILT_IN };
  for (const source of [defaults, task ?? {}]) {
    for (const key of Object.keys(source) as (keyof RetryOptions)[]) {
      if (source[key] !== undefined) {
        (resolved as Record<string, unknown>)[key] = source[key];
      }
    }
  }
  if (triggerMaxAttempts !== undefined) resolved.maxAttempts = triggerMaxAttempts;
  return resolved;
}

/** Delay before retrying after `failedAttempt` (1-based) failed. */
export function backoffMs(
  failedAttempt: number,
  r: ResolvedRetry,
  random: () => number = Math.random,
): number {
  let ms = Math.min(
    r.maxTimeoutInMs,
    r.minTimeoutInMs * Math.pow(r.factor, failedAttempt - 1),
  );
  if (r.randomize) ms = Math.min(r.maxTimeoutInMs, ms * (1 + random()));
  return ms;
}
