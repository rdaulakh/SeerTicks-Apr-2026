/**
 * Tests for MockClock — Phase 68
 */

import { describe, it, expect } from 'vitest';
import { MockClock, SystemClock } from '../_core/clock';

describe('MockClock', () => {
  it('starts at the constructor time', () => {
    const c = new MockClock(1_000_000);
    expect(c.now()).toBe(1_000_000);
    expect(c.date().getTime()).toBe(1_000_000);
  });

  it('advance moves time forward', () => {
    const c = new MockClock(0);
    c.advance(5000);
    expect(c.now()).toBe(5000);
    c.advance(2500);
    expect(c.now()).toBe(7500);
  });

  it('fires scheduled callbacks at the right time', () => {
    const c = new MockClock(0);
    const fires: number[] = [];
    c.schedule(1000, () => fires.push(c.now()));
    c.schedule(3000, () => fires.push(c.now()));
    c.schedule(2000, () => fires.push(c.now()));

    c.advance(500);
    expect(fires).toEqual([]);          // nothing fired yet
    c.advance(700);                      // total=1200
    expect(fires).toEqual([1000]);       // first task fired at 1000
    c.advance(2000);                     // total=3200
    expect(fires).toEqual([1000, 2000, 3000]);  // all three fired in order
  });

  it('periodic intervals fire repeatedly', () => {
    const c = new MockClock(0);
    let count = 0;
    c.interval(1000, () => { count++; });
    c.advance(3500);
    expect(count).toBe(3);              // fired at 1000, 2000, 3000
  });

  it('cancel stops scheduled tasks', () => {
    const c = new MockClock(0);
    let fired = false;
    const handle = c.schedule(1000, () => { fired = true; });
    handle.cancel();
    c.advance(5000);
    expect(fired).toBe(false);
  });

  it('cancel stops periodic intervals', () => {
    const c = new MockClock(0);
    let count = 0;
    const handle = c.interval(1000, () => { count++; });
    c.advance(1500);
    expect(count).toBe(1);
    handle.cancel();
    c.advance(5000);
    expect(count).toBe(1);
  });

  it('jumpTo refuses to rewind', () => {
    const c = new MockClock(1000);
    expect(() => c.jumpTo(500)).toThrow(/cannot rewind/);
  });

  it('sleep resolves immediately (no wall-clock block)', async () => {
    const c = new MockClock(0);
    const start = Date.now();
    await c.sleep(60000);  // 60 seconds — would block forever if real
    const wallElapsed = Date.now() - start;
    expect(wallElapsed).toBeLessThan(100);
    // Mock clock didn't move because nothing called advance
    expect(c.now()).toBe(0);
  });

  it('callbacks fired inside advance can schedule more work', () => {
    const c = new MockClock(0);
    const fires: number[] = [];
    c.schedule(1000, () => {
      fires.push(c.now());
      c.schedule(500, () => fires.push(c.now()));  // schedule child while parent fires
    });
    c.advance(2000);
    expect(fires).toEqual([1000, 1500]);
  });
});

describe('SystemClock', () => {
  it('matches Date.now()', () => {
    const c = new SystemClock();
    const a = c.now();
    const b = Date.now();
    expect(Math.abs(a - b)).toBeLessThan(50);
  });

  it('sleep actually waits', async () => {
    const c = new SystemClock();
    const start = Date.now();
    await c.sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
