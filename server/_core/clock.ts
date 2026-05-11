/**
 * Clock — Phase 68
 *
 * Abstracts time so the same engine code can run live (wall clock) or in
 * backtest (cursor advanced by harness). Today there are ~80 `Date.now()`
 * and `new Date()` call sites in the trading core; this interface is the
 * seam that makes them controllable.
 *
 * Live: SystemClock — wraps Date.now() and new Date().
 * Backtest: MockClock — controlled by the harness via `advance(ms)`.
 *
 * Both expose the same surface:
 *   - now(): number   — milliseconds since epoch
 *   - date(): Date    — equivalent of `new Date()`
 *   - sleep(ms): Promise<void>  — yields control while time passes
 *   - schedule(delayMs, fn): cancelable handle — equivalent of setTimeout
 *   - interval(periodMs, fn): cancelable handle — equivalent of setInterval
 *
 * Why not just override Date globally? Two reasons:
 *   1. Mocking Date globally also affects libraries (Drizzle/MySQL/logger
 *      timestamps), corrupting their behavior.
 *   2. The seam is explicit — code that takes a Clock can be reasoned about,
 *      vs code that picks up an implicit override.
 */

export interface CancelableHandle {
  cancel(): void;
}

export interface Clock {
  /** Current epoch milliseconds. */
  now(): number;
  /** Current Date object (equivalent to `new Date()`). */
  date(): Date;
  /** Yield control for ms wall-clock or simulated time. */
  sleep(ms: number): Promise<void>;
  /** Schedule a one-shot callback. Returns a cancel handle. */
  schedule(delayMs: number, fn: () => void): CancelableHandle;
  /** Schedule a periodic callback. Returns a cancel handle. */
  interval(periodMs: number, fn: () => void): CancelableHandle;
}

// ─── Live (system) clock ──────────────────────────────────────────────────

export class SystemClock implements Clock {
  now(): number { return Date.now(); }
  date(): Date { return new Date(); }
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  schedule(delayMs: number, fn: () => void): CancelableHandle {
    const handle = setTimeout(fn, delayMs);
    return { cancel: () => clearTimeout(handle) };
  }
  interval(periodMs: number, fn: () => void): CancelableHandle {
    const handle = setInterval(fn, periodMs);
    return { cancel: () => clearInterval(handle) };
  }
}

// Default singleton — code that doesn't accept a clock falls back to this.
let _systemClock: SystemClock | null = null;
export function getSystemClock(): SystemClock {
  if (!_systemClock) _systemClock = new SystemClock();
  return _systemClock;
}

// ─── Mock (backtest) clock ────────────────────────────────────────────────

interface ScheduledTask {
  fireAt: number;
  fn: () => void;
  periodic?: number; // ms — if set, reschedule by this period after firing
  id: number;
  cancelled: boolean;
}

/**
 * MockClock — manually advanced by the harness.
 *
 * Usage:
 *   const clock = new MockClock(startMs);
 *   clock.schedule(5000, () => console.log('fired'));
 *   clock.advance(5000);  // → 'fired'
 *
 * `sleep(ms)` resolves *immediately* when running under MockClock — the
 * harness should advance the clock to actually move scheduled work forward.
 * This avoids accidental wall-clock blocking in backtests.
 */
export class MockClock implements Clock {
  private current: number;
  private tasks: ScheduledTask[] = [];
  private nextId = 1;

  constructor(startTimeMs: number = 0) {
    this.current = startTimeMs;
  }

  now(): number { return this.current; }
  date(): Date { return new Date(this.current); }

  /** No-op for the backtest. The harness's `advance` is what actually moves time. */
  sleep(_ms: number): Promise<void> {
    return Promise.resolve();
  }

  schedule(delayMs: number, fn: () => void): CancelableHandle {
    const task: ScheduledTask = {
      fireAt: this.current + delayMs,
      fn,
      id: this.nextId++,
      cancelled: false,
    };
    this.tasks.push(task);
    return { cancel: () => { task.cancelled = true; } };
  }

  interval(periodMs: number, fn: () => void): CancelableHandle {
    const task: ScheduledTask = {
      fireAt: this.current + periodMs,
      fn,
      periodic: periodMs,
      id: this.nextId++,
      cancelled: false,
    };
    this.tasks.push(task);
    return { cancel: () => { task.cancelled = true; } };
  }

  /**
   * Advance the clock by `deltaMs`. Fires all scheduled callbacks that
   * fall within the window, in order. Returns the count of fired tasks.
   */
  advance(deltaMs: number): number {
    const target = this.current + deltaMs;
    let fired = 0;
    // Loop because firing one task may schedule more (or reschedule periodics)
    while (true) {
      // Find earliest non-cancelled task at or before target
      let next: ScheduledTask | undefined;
      for (const t of this.tasks) {
        if (t.cancelled) continue;
        if (t.fireAt > target) continue;
        if (!next || t.fireAt < next.fireAt) next = t;
      }
      if (!next) break;

      this.current = next.fireAt;
      try { next.fn(); } catch { /* swallow — harness sees state via traces */ }
      fired++;

      if (next.periodic) {
        // Reschedule. Single in-place mutation; loop will re-find by fireAt order.
        next.fireAt = this.current + next.periodic;
      } else {
        next.cancelled = true;
      }
    }
    this.current = target;
    return fired;
  }

  /** Jump directly to a specific timestamp (must be >= current). */
  jumpTo(absMs: number): number {
    if (absMs < this.current) throw new Error(`MockClock cannot rewind: ${absMs} < ${this.current}`);
    return this.advance(absMs - this.current);
  }

  /** For debugging — count of live scheduled tasks. */
  pendingTasks(): number {
    return this.tasks.filter(t => !t.cancelled).length;
  }
}
