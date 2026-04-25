/**
 * Phase 21 — contra-trend gate noise tolerance.
 *
 * Phase 20 unblocked SOL-USD pipeline. Production immediately revealed the
 * next gate killing trades, even on 100%-confidence consensus:
 *
 *   SIGNAL_REJECTED reason="Contra-trend: consensus=bullish but price down -0.069%"
 *
 * The Phase 40 hardcoded 0.05% threshold was below the bid-ask spread on
 * every symbol the platform trades:
 *
 *     SOL  @ $170     0.05% = $0.085   ← inside 1-tick wobble
 *     ETH  @ $2,325   0.05% = $1.16    ← inside 1-tick wobble
 *     BTC  @ $77,847  0.05% = $38.92   ← order book microstructure
 *
 * Pure noise was rejecting genuinely bullish setups. Real "falling knife"
 * moves clear 0.15% in 2 min easily; anything below that is no-signal.
 *
 * Phase 21 fix: extract `contraTrendNoiseTolerancePct` (default 0.15%)
 * and `contraTrendLookbackMs` (default 120 000) into TradingConfig.entry
 * so the threshold is tunable, lock down the production default, and
 * pin a regression guard that fails if anyone drops it back into 1-tick
 * noise territory.
 *
 * The integration with AutomatedSignalProcessor uses these values; this
 * test file exercises the config invariants — the call-site behavior is
 * covered indirectly by Phase 16's backtest harness post-deploy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

describe('Phase 21 — contra-trend tolerance config', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('production default tolerance is 0.15% (≥3× the bid-ask spread on SOL)', () => {
    expect(getTradingConfig().entry.contraTrendNoiseTolerancePct).toBe(0.15);
  });

  it('production default lookback is 2 minutes', () => {
    expect(getTradingConfig().entry.contraTrendLookbackMs).toBe(120_000);
  });

  it('regression guard — tolerance MUST be ≥ 0.10% (above 1-tick noise floor)', () => {
    // The Phase 21 bug class: any tolerance below 0.10% will start rejecting
    // signals on order-book microstructure noise rather than real moves.
    // Lock it down so the next "tighter is safer" change can't re-create
    // the SOL-blocked-on-12-cents scenario.
    const v = getTradingConfig().entry.contraTrendNoiseTolerancePct;
    expect(v).toBeGreaterThanOrEqual(0.10);
  });

  it('lookback MUST be at least 60 seconds (avoids tick-by-tick whipsaw)', () => {
    // Sub-minute lookbacks turn this gate into a tick filter, which it was
    // never designed to be. Below 60 s the trend signal is dominated by
    // single-trade noise rather than meaningful direction.
    expect(getTradingConfig().entry.contraTrendLookbackMs).toBeGreaterThanOrEqual(60_000);
  });

  it('runtime overrides flow through (tunable without redeploy)', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      entry: {
        ...PRODUCTION_CONFIG.entry,
        contraTrendNoiseTolerancePct: 0.30,
        contraTrendLookbackMs: 300_000,
      },
    });
    expect(getTradingConfig().entry.contraTrendNoiseTolerancePct).toBe(0.30);
    expect(getTradingConfig().entry.contraTrendLookbackMs).toBe(300_000);
  });

  it('config exposes the two tunables on the entry block (TypeScript type-check)', () => {
    // If these fields ever get accidentally removed, the compile fails. The
    // assertion is a runtime guard against object-spread accidents that lose
    // the keys without breaking tsc. Keeps the contract honest.
    const cfg = getTradingConfig();
    expect('contraTrendNoiseTolerancePct' in cfg.entry).toBe(true);
    expect('contraTrendLookbackMs' in cfg.entry).toBe(true);
  });
});

describe('Phase 21 — symbol-specific motivation (the canonical micro-noise scenarios)', () => {
  it('SOL @ $170, 0.069% move = $0.117 → noise (below 0.15% tolerance)', () => {
    const movePct = 0.069;
    const tolerance = PRODUCTION_CONFIG.entry.contraTrendNoiseTolerancePct;
    expect(movePct).toBeLessThan(tolerance);
  });

  it('SOL @ $170, 0.20% move = $0.34 → real signal (above 0.15% tolerance)', () => {
    const movePct = 0.20;
    const tolerance = PRODUCTION_CONFIG.entry.contraTrendNoiseTolerancePct;
    expect(movePct).toBeGreaterThan(tolerance);
  });

  it('ETH @ $2,325, 0.05% move = $1.16 → noise (below 0.15% tolerance)', () => {
    const movePct = 0.05;
    const tolerance = PRODUCTION_CONFIG.entry.contraTrendNoiseTolerancePct;
    expect(movePct).toBeLessThan(tolerance);
  });

  it('the prior 0.05% threshold WOULD reject the noise scenarios — the new 0.15% does not', () => {
    // Direct comparison: the old hardcoded threshold versus the new
    // configurable default. This is the canonical "Phase 40 was too tight"
    // scenario expressed as a pinned test.
    const oldThreshold = 0.05;
    const newThreshold =
      PRODUCTION_CONFIG.entry.contraTrendNoiseTolerancePct;
    const noiseMovePct = 0.069;
    expect(noiseMovePct).toBeGreaterThan(oldThreshold); // would have blocked
    expect(noiseMovePct).toBeLessThan(newThreshold); // now passes
  });
});
