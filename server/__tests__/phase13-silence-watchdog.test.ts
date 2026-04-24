/**
 * Phase 13 — TradingSilenceWatchdog
 *
 * Live trigger: the 2026-04-21 → 2026-04-24 incident. Zero trades for 3
 * days while the engine was running and agents were ticking. Root cause:
 * the consensus gate refused every signal (0–1 of 3 agents hitting the
 * 65% confidence bar) under degraded data quality. Nothing alarmed.
 *
 * This watchdog catches that class of failure before a human notices:
 *
 *   - TRADE_SILENCE: no TRADE_EXECUTED in the trade-silence window.
 *   - HIGH_REJECTION_RATE: rejected / (approved+rejected) > threshold
 *     over the rejection-rate window.
 *
 * These tests lock down the counting logic and alarm conditions. They
 * mock the file-backed `getRecentPipelineEvents` so we can inject
 * synthetic event streams deterministically.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { PipelineLogEntry } from '../services/TradingPipelineLogger';

// Mock the pipeline logger BEFORE importing the watchdog — the watchdog
// reads events from this module and we need full control over what it sees.
const mockedEvents: PipelineLogEntry[] = [];
vi.mock('../services/TradingPipelineLogger', () => ({
  getRecentPipelineEvents: (_n: number) => mockedEvents,
  logPipelineEvent: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  computeHealthSnapshot,
  DEFAULT_WATCHDOG_CONFIG,
  __resetWatchdogForTests,
} from '../services/TradingSilenceWatchdog';

function ev(
  t: Date,
  type: PipelineLogEntry['eventType'],
  reason?: string,
): PipelineLogEntry {
  return { timestamp: t.toISOString(), eventType: type, reason };
}

describe('Phase 13 — TradingSilenceWatchdog.computeHealthSnapshot', () => {
  const NOW = new Date('2026-04-24T12:00:00Z');

  beforeEach(() => {
    __resetWatchdogForTests();
    mockedEvents.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('healthy when a TRADE_EXECUTED is recent AND rejection rate is low', () => {
    // 5 minutes ago: an actual trade. 20 approved vs 10 rejected in the
    // last 30 min → 33% rejection rate, comfortably below the 95%
    // threshold AND above minAttemptsForRate=20.
    mockedEvents.push(ev(new Date(NOW.getTime() - 5 * 60_000), 'TRADE_EXECUTED'));
    for (let i = 0; i < 20; i++)
      mockedEvents.push(
        ev(new Date(NOW.getTime() - (i + 1) * 60_000), 'SIGNAL_APPROVED'),
      );
    for (let i = 0; i < 10; i++)
      mockedEvents.push(
        ev(new Date(NOW.getTime() - (i + 1) * 60_000), 'SIGNAL_REJECTED', 'x'),
      );

    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);

    expect(snap.healthy).toBe(true);
    expect(snap.alarms).toEqual([]);
    expect(snap.tradesInWindow).toBe(1);
    expect(snap.minutesSinceLastTrade).toBe(5);
    expect(snap.rejectionRate).toBeCloseTo(10 / 30, 4);
  });

  it('fires TRADE_SILENCE when no trades in the window (the 3-day incident)', () => {
    // The only executed trade was a week ago (well outside the 2h window).
    // Approvals and rejections happening but no conversion to executed trades.
    mockedEvents.push(
      ev(new Date(NOW.getTime() - 7 * 24 * 60 * 60_000), 'TRADE_EXECUTED'),
    );
    for (let i = 0; i < 30; i++)
      mockedEvents.push(
        ev(new Date(NOW.getTime() - (i + 1) * 60_000), 'SIGNAL_REJECTED', 'x'),
      );

    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);

    expect(snap.healthy).toBe(false);
    expect(snap.alarms).toContain('TRADE_SILENCE');
    expect(snap.tradesInWindow).toBe(0);
    // Last trade was a week ago → minutesSinceLastTrade well above window.
    expect(snap.minutesSinceLastTrade).toBeGreaterThan(
      DEFAULT_WATCHDOG_CONFIG.tradeSilenceWindowMs / 60_000,
    );
  });

  it('fires HIGH_REJECTION_RATE when rejection rate exceeds threshold in window', () => {
    // 30 rejections, 1 approval — 96.7% rejection, above 95% threshold.
    for (let i = 0; i < 30; i++)
      mockedEvents.push(
        ev(new Date(NOW.getTime() - (i + 1) * 60_000), 'SIGNAL_REJECTED', 'bad'),
      );
    mockedEvents.push(
      ev(new Date(NOW.getTime() - 3 * 60_000), 'SIGNAL_APPROVED'),
    );
    // Include a recent trade so TRADE_SILENCE does NOT also fire — we want
    // to isolate the rejection-rate alarm.
    mockedEvents.push(ev(new Date(NOW.getTime() - 2 * 60_000), 'TRADE_EXECUTED'));

    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);

    expect(snap.alarms).toContain('HIGH_REJECTION_RATE');
    expect(snap.alarms).not.toContain('TRADE_SILENCE');
    expect(snap.rejectionRate).toBeCloseTo(30 / 31, 3);
  });

  it('does NOT fire HIGH_REJECTION_RATE below the min-attempts threshold (avoids cold-start noise)', () => {
    // Only 3 rejections in the window — fewer than minAttemptsForRate=20.
    // Rate is mathematically 100% but we should NOT alarm.
    mockedEvents.push(ev(new Date(NOW.getTime() - 1 * 60_000), 'TRADE_EXECUTED'));
    for (let i = 0; i < 3; i++)
      mockedEvents.push(
        ev(new Date(NOW.getTime() - (i + 1) * 60_000), 'SIGNAL_REJECTED', 'x'),
      );

    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);

    expect(snap.alarms).not.toContain('HIGH_REJECTION_RATE');
    expect(snap.rejectionRate).toBeNull();
  });

  it('buckets top rejection reasons correctly (canonical 3-day incident shape)', () => {
    // The exact log pattern from prod 2026-04-24: a flood of "Not enough
    // high-confidence agents..." reasons, plus a handful of price_feed_stale.
    for (let i = 0; i < 25; i++) {
      mockedEvents.push(
        ev(
          new Date(NOW.getTime() - (i + 1) * 30_000),
          'SIGNAL_REJECTED',
          `Not enough high-confidence agents for consensus: 1/3 (min confidence: 65%)`,
        ),
      );
    }
    for (let i = 0; i < 5; i++) {
      mockedEvents.push(
        ev(
          new Date(NOW.getTime() - (i + 1) * 30_000),
          'SIGNAL_REJECTED',
          `price_feed_stale: ${5000 + i * 200}ms > 5000ms`,
        ),
      );
    }
    mockedEvents.push(ev(new Date(NOW.getTime() - 2 * 60_000), 'TRADE_EXECUTED'));

    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);
    expect(snap.topRejectionReasons).toHaveLength(2);
    // Biggest bucket should be the consensus rejection.
    expect(snap.topRejectionReasons[0]).toEqual({
      reason: 'not enough high-confidence agents for consensus',
      count: 25,
    });
    expect(snap.topRejectionReasons[1]).toEqual({
      reason: 'price_feed_stale',
      count: 5,
    });
  });

  it('handles empty event stream without throwing (fresh start, clean log)', () => {
    const snap = computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG, NOW);
    // Empty log → TRADE_SILENCE (no trades) but no rejection-rate alarm
    // because minAttemptsForRate not met.
    expect(snap.tradesInWindow).toBe(0);
    expect(snap.signalsApprovedInWindow).toBe(0);
    expect(snap.signalsRejectedInWindow).toBe(0);
    expect(snap.minutesSinceLastTrade).toBeNull();
    expect(snap.rejectionRate).toBeNull();
    expect(snap.alarms).toContain('TRADE_SILENCE');
    expect(snap.alarms).not.toContain('HIGH_REJECTION_RATE');
  });

  it('respects custom config (tight 15-min silence window for tests)', () => {
    const cfg = {
      ...DEFAULT_WATCHDOG_CONFIG,
      tradeSilenceWindowMs: 15 * 60_000, // 15 min
    };
    // Trade 20 min ago — outside tightened 15 min window → TRADE_SILENCE.
    mockedEvents.push(
      ev(new Date(NOW.getTime() - 20 * 60_000), 'TRADE_EXECUTED'),
    );
    const snap = computeHealthSnapshot(cfg, NOW);
    expect(snap.alarms).toContain('TRADE_SILENCE');
    expect(snap.tradesInWindow).toBe(0);
    expect(snap.minutesSinceLastTrade).toBe(20);
  });
});
