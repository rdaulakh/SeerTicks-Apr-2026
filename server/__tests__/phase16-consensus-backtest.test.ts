/**
 * Phase 16 — Consensus threshold backtest harness (pure logic).
 *
 * The script in `server/scripts/consensus-backtest.ts` pulls rows from
 * `consensusHistory` and replays different `minConfidence` thresholds.
 * These tests cover the DB-free helpers (parseRow, evaluateThreshold,
 * parseArgs) so the sweep math is proven correct before operators rely
 * on the output to make tuning decisions.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRow,
  evaluateThreshold,
  parseArgs,
} from '../scripts/consensus-backtest';

// Stub a row shape matching the Drizzle select type; we only touch the
// fields the parser reads.
function makeRow(opts: {
  agentVotes: unknown;
  symbol?: string;
  timeframe?: string;
  finalSignal?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  timestamp?: Date;
}): any {
  return {
    id: 1,
    timestamp: opts.timestamp ?? new Date('2026-04-24T10:00:00Z'),
    symbol: opts.symbol ?? 'BTC-USD',
    timeframe: opts.timeframe ?? '5m',
    finalSignal: opts.finalSignal ?? 'BULLISH',
    finalConfidence: 65,
    consensusPercentage: 55,
    bullishVotes: 2,
    bearishVotes: 0,
    neutralVotes: 1,
    agentVotes:
      typeof opts.agentVotes === 'string'
        ? opts.agentVotes
        : JSON.stringify(opts.agentVotes),
    tradeId: null,
    createdAt: new Date(),
  };
}

describe('Phase 16 — parseRow', () => {
  it('parses a well-formed row and filters actionable (non-neutral) votes', () => {
    const r = parseRow(
      makeRow({
        agentVotes: [
          { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.72 },
          { agentName: 'PatternMatcher', signal: 'bearish', confidence: 0.55 },
          { agentName: 'SentimentAnalyst', signal: 'neutral', confidence: 0.3 },
        ],
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.agentVotes).toHaveLength(3);
    expect(r!.actionable).toHaveLength(2);
    expect(r!.actionable.map((v) => v.agentName)).toEqual([
      'TechnicalAnalyst',
      'PatternMatcher',
    ]);
  });

  it('returns null on malformed JSON (skipped, not throwing)', () => {
    expect(parseRow(makeRow({ agentVotes: '{not valid' }))).toBeNull();
  });

  it('handles empty/missing agentVotes gracefully', () => {
    expect(parseRow(makeRow({ agentVotes: '' }))!.actionable).toHaveLength(0);
    expect(parseRow(makeRow({ agentVotes: [] }))!.actionable).toHaveLength(0);
  });

  it('treats signal case-insensitively (Bullish == BULLISH == bullish)', () => {
    const r = parseRow(
      makeRow({
        agentVotes: [
          { agentName: 'a', signal: 'Bullish', confidence: 0.7 },
          { agentName: 'b', signal: 'BEARISH', confidence: 0.6 },
          { agentName: 'c', signal: 'NeutRaL', confidence: 0.5 },
        ],
      }),
    );
    expect(r!.actionable).toHaveLength(2);
  });
});

describe('Phase 16 — evaluateThreshold', () => {
  it('counts approvals correctly (≥2 actionable agents ≥ threshold)', () => {
    // Row 1: 3 actionable, 2 pass @0.65 → approved
    // Row 2: 3 actionable, 1 passes @0.65 → rejected
    // Row 3: 2 actionable, both pass @0.65 → approved
    const rows = [
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'a', signal: 'bullish', confidence: 0.72 },
            { agentName: 'b', signal: 'bullish', confidence: 0.68 },
            { agentName: 'c', signal: 'bearish', confidence: 0.4 },
          ],
        }),
      )!,
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'a', signal: 'bullish', confidence: 0.72 },
            { agentName: 'b', signal: 'bullish', confidence: 0.5 },
            { agentName: 'c', signal: 'bullish', confidence: 0.45 },
          ],
        }),
      )!,
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'a', signal: 'bearish', confidence: 0.8 },
            { agentName: 'b', signal: 'bearish', confidence: 0.7 },
          ],
        }),
      )!,
    ];

    const r = evaluateThreshold(rows, 0.65);
    expect(r.totalRows).toBe(3);
    expect(r.approvedRows).toBe(2);
    expect(r.rejectedRows).toBe(1);
    expect(r.approvalRate).toBeCloseTo(2 / 3, 4);
  });

  it('lowering the threshold produces ≥ approvals at the higher threshold (monotonic)', () => {
    // Build a batch where many agents sit in [0.55, 0.65) — the canonical
    // scenario where lowering from 0.65 unlocks trades.
    const rows = Array.from({ length: 20 }, (_, i) =>
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'a', signal: 'bullish', confidence: 0.70 },
            { agentName: 'b', signal: 'bullish', confidence: 0.55 + (i % 10) * 0.01 },
            { agentName: 'c', signal: 'bullish', confidence: 0.50 + (i % 5) * 0.02 },
          ],
        }),
      )!,
    );

    const at65 = evaluateThreshold(rows, 0.65);
    const at55 = evaluateThreshold(rows, 0.55);
    expect(at55.approvedRows).toBeGreaterThanOrEqual(at65.approvedRows);
    // And the relaxation materially moved things — agents between 0.55
    // and 0.65 now pass, so approval rate strictly increases here.
    expect(at55.approvedRows).toBeGreaterThan(at65.approvedRows);
  });

  it('tracks per-agent filter pass rate for bottleneck identification', () => {
    const rows = [
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.75 },
            { agentName: 'WhaleTracker', signal: 'bullish', confidence: 0.40 },
          ],
        }),
      )!,
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'TechnicalAnalyst', signal: 'bullish', confidence: 0.80 },
            { agentName: 'WhaleTracker', signal: 'bullish', confidence: 0.38 },
          ],
        }),
      )!,
      parseRow(
        makeRow({
          agentVotes: [
            { agentName: 'TechnicalAnalyst', signal: 'bearish', confidence: 0.70 },
            { agentName: 'WhaleTracker', signal: 'bearish', confidence: 0.42 },
          ],
        }),
      )!,
    ];

    const r = evaluateThreshold(rows, 0.65);
    const tech = r.byAgent.get('TechnicalAnalyst')!;
    const whale = r.byAgent.get('WhaleTracker')!;
    expect(tech.totalSeen).toBe(3);
    expect(tech.passedFilter).toBe(3); // All 3 above 0.65
    expect(whale.totalSeen).toBe(3);
    expect(whale.passedFilter).toBe(0); // All 3 below — whale is the bottleneck
  });

  it('median eligible count reflects typical row state', () => {
    // Half the rows have 2 eligible agents, half have 0.
    const rows = [
      ...Array.from({ length: 5 }, () =>
        parseRow(
          makeRow({
            agentVotes: [
              { agentName: 'a', signal: 'bullish', confidence: 0.75 },
              { agentName: 'b', signal: 'bullish', confidence: 0.75 },
            ],
          }),
        )!,
      ),
      ...Array.from({ length: 5 }, () =>
        parseRow(
          makeRow({
            agentVotes: [
              { agentName: 'a', signal: 'bullish', confidence: 0.3 },
              { agentName: 'b', signal: 'bullish', confidence: 0.3 },
            ],
          }),
        )!,
      ),
    ];
    const r = evaluateThreshold(rows, 0.65);
    // Sorted eligible counts: [0,0,0,0,0,2,2,2,2,2] → median at idx 5 = 2.
    expect(r.medianEligibleCount).toBe(2);
  });

  it('handles empty input without dividing by zero', () => {
    const r = evaluateThreshold([], 0.65);
    expect(r.totalRows).toBe(0);
    expect(r.approvedRows).toBe(0);
    expect(r.approvalRate).toBe(0);
    expect(r.byAgent.size).toBe(0);
  });
});

describe('Phase 16 — parseArgs', () => {
  it('returns sensible defaults when nothing is passed', () => {
    const { days, thresholds } = parseArgs(['node', 'script.js']);
    expect(days).toBe(7);
    expect(thresholds).toEqual([0.5, 0.55, 0.6, 0.65, 0.7]);
  });

  it('parses --days=N', () => {
    expect(parseArgs(['node', 'x', '--days=30']).days).toBe(30);
    expect(parseArgs(['node', 'x', '--days=90']).days).toBe(90);
  });

  it('parses --thresholds=comma,list', () => {
    expect(
      parseArgs(['node', 'x', '--thresholds=0.55,0.60,0.65']).thresholds,
    ).toEqual([0.55, 0.6, 0.65]);
  });

  it('filters out-of-range values from a numeric list (2.5 → dropped, 0.6 → kept)', () => {
    // The regex accepts only digits/dots/commas so the whole arg must be
    // number-shaped; non-numeric characters reject the entire arg and
    // defaults win. For numeric-but-out-of-range we filter: e.g. 2.5 > 1 is
    // dropped, but 0.6 survives alongside valid 0.55.
    expect(
      parseArgs(['node', 'x', '--thresholds=0.55,2.5,0.6']).thresholds,
    ).toEqual([0.55, 0.6]);
  });

  it('falls back to defaults when --thresholds contains non-numeric junk', () => {
    // `foo` prevents the whole arg from parsing — safer behavior than
    // silently dropping parts the operator meant to include.
    expect(
      parseArgs(['node', 'x', '--thresholds=foo']).thresholds,
    ).toEqual([0.5, 0.55, 0.6, 0.65, 0.7]);
    expect(
      parseArgs(['node', 'x', '--thresholds=0.6,foo']).thresholds,
    ).toEqual([0.5, 0.55, 0.6, 0.65, 0.7]);
  });

  it('falls back to defaults when every numeric value is out of range', () => {
    expect(
      parseArgs(['node', 'x', '--thresholds=2.5,3.0']).thresholds,
    ).toEqual([0.5, 0.55, 0.6, 0.65, 0.7]);
  });
});
