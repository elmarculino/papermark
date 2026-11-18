const UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
} as const;

const DURATION = /^(\d+)(s|m|h|d|w)$/;

function durationSeconds(value: string, kind: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) {
    throw new Error(
      `Unsupported ${kind} "${value}": use <number><s|m|h|d|w>, e.g. "15m" or "1d"`,
    );
  }
  return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}

/**
 * Trigger.dev `delay` (a "1d"-style string or a Date) as whole seconds from
 * `now`, rounded up. A date in the past is 0.
 */
export function parseDelay(delay: string | Date, now: Date = new Date()): number {
  if (delay instanceof Date) {
    if (Number.isNaN(delay.getTime())) throw new Error("Unsupported delay: invalid Date");
    return Math.max(0, Math.ceil((delay.getTime() - now.getTime()) / 1000));
  }
  return durationSeconds(delay, "delay");
}

/** `runs.list({ period })` as milliseconds. */
export function parsePeriodMs(period: string): number {
  return durationSeconds(period, "period") * 1000;
}
