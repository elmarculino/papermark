/**
 * Worker-wide cap on runs executing at once, across every queue (DBOS's
 * `workerConcurrency` is per queue). Waiters are served first in, first out;
 * a waiter already canceled when its turn comes is rejected and skipped.
 */
import { RunCanceledError } from "./context";

const CANCEL_CHECK_MS = 500;

export class Semaphore {
  private free: number;
  /** Each grants its waiter the slot, or rejects a canceled one and returns false. */
  private readonly waiters: (() => boolean)[] = [];

  constructor(slots: number) {
    if (!Number.isInteger(slots) || slots < 1) {
      throw new Error(
        `Semaphore needs a positive integer of slots, got ${slots}`,
      );
    }
    this.free = slots;
  }

  /**
   * Resolves with a release function once a slot is free. While waiting it
   * checks `isCanceled` every 500 ms and rejects with RunCanceledError.
   */
  acquire(isCanceled?: () => boolean): Promise<() => void> {
    if (isCanceled?.()) return Promise.reject(new RunCanceledError());
    if (this.free > 0) {
      this.free--;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const grant = () => {
        clearInterval(timer);
        if (isCanceled?.()) {
          reject(new RunCanceledError());
          return false;
        }
        resolve(this.releaser());
        return true;
      };
      this.waiters.push(grant);
      if (isCanceled) {
        timer = setInterval(() => {
          if (!isCanceled()) return;
          clearInterval(timer);
          this.waiters.splice(this.waiters.indexOf(grant), 1);
          reject(new RunCanceledError());
        }, CANCEL_CHECK_MS);
      }
    });
  }

  /** A release that hands the slot to the next waiter; calling it twice is a no-op. */
  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      let next;
      while ((next = this.waiters.shift())) {
        if (next()) return;
      }
      this.free++;
    };
  }
}
