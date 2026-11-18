/**
 * Helpers for the jobs layer's `*.verify.ts` scripts. Not imported by app or
 * worker code.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

export async function check(name: string, fn: () => unknown): Promise<void> {
  await fn();
  console.log(`ok ${name}`);
}

/** Asserts that `fn` throws (or rejects) with a message containing `text`. */
export async function throwsWith(
  fn: () => unknown,
  text: string,
): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(text),
      `expected an error containing "${text}", got "${message}"`,
    );
    return error as Error;
  }
  throw new Error(`assertion failed: expected an error containing "${text}"`);
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
