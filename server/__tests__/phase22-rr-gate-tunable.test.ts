/**
 * Phase 22 — Risk:Reward gate tunable + S/R walk regression suite.
 *
 * Phase 21 unblocked the contra-trend gate. Production immediately revealed
 * the next gate killing trades:
 *
 *   {"msg":"R:R too low","symbol":"SOL-USD","rrRatio":"0.42","minRR":1.2,"atr":"0.77"}
 *
 * Root cause: AutomatedSignalProcessor's R:R pre-validation gate computed
 * reward distance as `Math.abs(resistance[0] - currentPrice)`, where
 * `resistance` is sorted ascending — i.e. it took the NEAREST level above
 * price as the take-profit target. On SOL@$169.50 with `resistance[0]` =
 * recentHigh = $170.15 (65 cents away), that produced rewardDistance=0.65
 * vs riskDistance=2×ATR=1.54 → R:R = 0.42, blocking valid breakout trades
 * any time price approached its own recent local high.
 *
 * Phase 22 fix: walk the S/R array nearest→furthest and take the first
 * level whose distance clears `riskDistance × minRR`, falling back to the
 * furthest level (so the R:R check still rejects when the *entire* S/R
 * structure offers no upside) and to ATR-default reward when no S/R is
 * available. Plus: extract the R:R tunables to TradingConfig.entry.rr
 * so future regression guards can pin them.
 *
 * The two helpers `selectRewardDistance` and `selectMinRr` are pure and
 * exported from AutomatedSignalProcessor — this suite hits them directly
 * rather than going through the full pipeline.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTradingConfig,
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';
import {
  selectRewardDistance,
  selectMinRr,
} from '../services/AutomatedSignalProcessor';

describe('Phase 22 — R:R gate config tunables', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
  });

  it('production default risk multiplier is 2.0×ATR', () => {
    expect(getTradingConfig().entry.rr.riskAtrMultiplier).toBe(2.0);
  });

  it('production default reward fallback is 3.0×ATR (R:R=1.5 against 2× risk)', () => {
    expect(getTradingConfig().entry.rr.defaultRewardAtrMultiplier).toBe(3.0);
  });

  it('production default minRR for trending+calm regime is 1.2', () => {
    expect(getTradingConfig().entry.rr.minRrTrending).toBe(1.2);
  });

  it('production default minRR for high-volatility regime is 1.5', () => {
    expect(getTradingConfig().entry.rr.minRrVolatile).toBe(1.5);
  });

  it('production default minRR for counter-trend regime is 2.0', () => {
    expect(getTradingConfig().entry.rr.minRrCounterTrend).toBe(2.0);
  });

  it('regression guard — minRrTrending MUST stay ≤ minRrVolatile (trending is the easier regime)', () => {
    // Counter-intuitive inversions historically cause silent gate inversions
    // where the easier regime (with-trend) demands MORE R:R than the harder
    // one (volatile/ranging). Lock the relationship in.
    const cfg = getTradingConfig().entry.rr;
    expect(cfg.minRrTrending).toBeLessThanOrEqual(cfg.minRrVolatile);
  });

  it('regression guard — minRrCounterTrend MUST stay ≥ minRrTrending (counter-trend is harder)', () => {
    const cfg = getTradingConfig().entry.rr;
    expect(cfg.minRrCounterTrend).toBeGreaterThanOrEqual(cfg.minRrTrending);
  });

  it('regression guard — defaultRewardAtrMultiplier MUST clear minRrDefault against riskAtrMultiplier', () => {
    // The ATR fallback reward MUST satisfy the default minRR floor when
    // applied. Otherwise every trade with no S/R data is auto-rejected,
    // which would silently kill brand-new symbols that haven't yet
    // accumulated structural levels.
    const cfg = getTradingConfig().entry.rr;
    const fallbackRr = cfg.defaultRewardAtrMultiplier / cfg.riskAtrMultiplier;
    expect(fallbackRr).toBeGreaterThanOrEqual(cfg.minRrDefault);
  });

  it('runtime overrides flow through (tunable without redeploy)', () => {
    setTradingConfig({
      ...PRODUCTION_CONFIG,
      entry: {
        ...PRODUCTION_CONFIG.entry,
        rr: {
          ...PRODUCTION_CONFIG.entry.rr,
          minRrTrending: 1.0,
          riskAtrMultiplier: 2.5,
        },
      },
    });
    expect(getTradingConfig().entry.rr.minRrTrending).toBe(1.0);
    expect(getTradingConfig().entry.rr.riskAtrMultiplier).toBe(2.5);
  });
});

describe('Phase 22 — selectMinRr regime-aware threshold helper', () => {
  const cfg = PRODUCTION_CONFIG.entry.rr;

  it('trending+calm regime returns minRrTrending (superTrend agrees, atrRatio low)', () => {
    expect(selectMinRr('bullish', 'bullish', 1.0, cfg)).toBe(cfg.minRrTrending);
  });

  it('counter-trend regime returns minRrCounterTrend (superTrend disagrees)', () => {
    // atrRatio=1.0 is in normal range but the disagreement triggers counter-trend
    expect(selectMinRr('bullish', 'bearish', 1.0, cfg)).toBe(cfg.minRrCounterTrend);
  });

  it('high-volatility regime returns minRrVolatile (atrRatio above volatile threshold)', () => {
    // Even with superTrend agreement, high vol triggers volatile regime
    // since the trending check requires atrRatio < trendingMax (1.2).
    expect(selectMinRr('bullish', 'bullish', 2.0, cfg)).toBe(cfg.minRrVolatile);
  });

  it('default regime (no superTrend data) returns minRrDefault', () => {
    expect(selectMinRr('bullish', undefined, 1.0, cfg)).toBe(cfg.minRrDefault);
  });

  it('trending+calm wins over volatile when both could match (defensive ordering)', () => {
    // atrRatio=1.0 is below trendingMax=1.2 AND below volatileMin=1.5,
    // so only trending matches. But the helper's order matters: trending
    // check comes first, ensuring agreed+calm trades get the easier bar.
    const result = selectMinRr('bullish', 'bullish', 1.1, cfg);
    expect(result).toBe(cfg.minRrTrending);
  });
});

describe('Phase 22 — selectRewardDistance S/R walk', () => {
  it('returns ATR fallback when S/R array is undefined', () => {
    const reward = selectRewardDistance(undefined, 100, 2.0, 1.5, 5.0);
    expect(reward).toBe(5.0);
  });

  it('returns ATR fallback when S/R array is empty', () => {
    const reward = selectRewardDistance([], 100, 2.0, 1.5, 5.0);
    expect(reward).toBe(5.0);
  });

  it('takes nearest level when it already clears minRR', () => {
    // riskDistance=1.0, minRR=1.5 → required distance ≥ 1.5
    // resistance[0]=102 (dist=2.0) clears 1.5 → take it
    const reward = selectRewardDistance([102, 105, 110], 100, 1.0, 1.5, 3.0);
    expect(reward).toBe(2.0);
  });

  it('walks past microstructure-close [0] to the next level that clears minRR (THE BUG)', () => {
    // SOL canonical scenario: currentPrice=169.50, recentHigh=170.15
    // resistance = [170.15, 171.40, 173.37], riskDistance = 2*ATR = 1.54, minRR = 1.2
    // Pre-Phase-22: reward = |170.15 - 169.50| = 0.65 → R:R = 0.42 (BLOCKED)
    // Phase 22: walk → [0]=0.65 < 1.85, [1]=1.90 ≥ 1.85 ✅ take it → R:R = 1.23 (PASS)
    const reward = selectRewardDistance(
      [170.15, 171.40, 173.37],
      169.50,
      1.54,
      1.2,
      1.54 * 3.0,
    );
    // Should NOT be 0.65 (the microstructure level)
    expect(reward).not.toBe(0.65);
    // Should be the second level (~1.90)
    expect(reward).toBeCloseTo(1.90, 2);
    // Sanity: the resulting R:R clears minRR
    const rr = reward / 1.54;
    expect(rr).toBeGreaterThanOrEqual(1.2);
  });

  it('falls back to furthest level when NO level clears minRR (legitimate reject case)', () => {
    // All three levels too close to clear minRR=1.5 against risk=2.0 (need ≥3.0)
    // Furthest is at distance 2.5 → R:R = 1.25, still below 1.5 → caller rejects
    const reward = selectRewardDistance([101, 102, 102.5], 100, 2.0, 1.5, 6.0);
    expect(reward).toBe(2.5); // furthest level, NOT the ATR fallback
    // The caller's rrRatio < minRR check correctly rejects this trade
    expect(reward / 2.0).toBeLessThan(1.5);
  });

  it('handles bearish-direction S/R (descending support array)', () => {
    // Bearish: support array sorted descending, e.g. price=100, supports = [99, 96, 92]
    // riskDistance=1.5, minRR=1.5 → need ≥ 2.25
    // [0]=1 < 2.25, [1]=4 ≥ 2.25 → take 4
    const reward = selectRewardDistance([99, 96, 92], 100, 1.5, 1.5, 4.5);
    expect(reward).toBe(4.0);
  });

  it('skips non-finite levels gracefully', () => {
    // Defensive: malformed evidence shouldn't crash the gate.
    // First valid level is 102 (dist=2.0), clears minRR=1.5 against risk=1.0.
    const reward = selectRewardDistance(
      [NaN, Infinity, 102, 105],
      100,
      1.0,
      1.5,
      3.0,
    );
    expect(reward).toBe(2.0);
  });

  it('returns atrFallback when currentPrice is invalid (defensive)', () => {
    expect(selectRewardDistance([102, 105], 0, 1.0, 1.5, 3.0)).toBe(3.0);
    expect(selectRewardDistance([102, 105], NaN, 1.0, 1.5, 3.0)).toBe(3.0);
  });
});

describe('Phase 22 — canonical SOL scenario (the bug that triggered this phase)', () => {
  it('SOL@$169.50, ATR=0.77, resistance=[170.15, 171.40, 173.37] → R:R=1.23 (was 0.42)', () => {
    // The exact log line that motivated Phase 22:
    //   {"msg":"R:R too low","symbol":"SOL-USD","rrRatio":"0.42","minRR":1.2,"atr":"0.77"}
    // Pre-fix: reward = |170.15 - 169.50| = 0.65, risk = 2*0.77 = 1.54, R:R = 0.42 ❌
    // Post-fix: walk past 170.15 (dist 0.65 < 1.54*1.2 = 1.85) → 171.40 (dist 1.90 ≥ 1.85) ✅
    const cfg = PRODUCTION_CONFIG.entry.rr;
    const atr = 0.77;
    const currentPrice = 169.50;
    const resistance = [170.15, 171.40, 173.37];
    const riskDistance = atr * cfg.riskAtrMultiplier;

    // Trending+calm regime (superTrend agrees, atrRatio low) → minRR = 1.2
    const minRR = selectMinRr('bullish', 'bullish', 1.0, cfg);
    expect(minRR).toBe(1.2);

    const reward = selectRewardDistance(
      resistance,
      currentPrice,
      riskDistance,
      minRR,
      atr * cfg.defaultRewardAtrMultiplier,
    );
    const rrRatio = reward / riskDistance;

    // Pre-fix would have been 0.42:
    const preFix = Math.abs(resistance[0] - currentPrice) / riskDistance;
    expect(preFix).toBeCloseTo(0.42, 2);

    // Post-fix clears the trending floor:
    expect(rrRatio).toBeGreaterThanOrEqual(minRR);
    expect(rrRatio).toBeCloseTo(1.23, 1);
  });

  it('Counter-example: SOL legitimately blocked when ALL resistance is too close', () => {
    // If recentHigh is at $170 and the next two resistance levels also cluster
    // at ~$170.30 and $170.50, the entire structural ceiling is ~$1 above price.
    // Even Phase 22's walk picks the furthest ($0.50 dist), which still fails
    // the 1.2 minRR against 2*ATR=$1.54 risk → 0.32 R:R → correctly rejected.
    // This proves Phase 22 doesn't make the gate toothless — it just stops
    // crushing legitimate breakouts.
    const atr = 0.77;
    const currentPrice = 169.50;
    const resistance = [169.80, 170.10, 170.30]; // entire ceiling within $1
    const riskDistance = atr * 2.0;
    const minRR = 1.2;

    const reward = selectRewardDistance(resistance, currentPrice, riskDistance, minRR, atr * 3.0);
    const rrRatio = reward / riskDistance;

    // Furthest distance is 170.30 - 169.50 = 0.80, R:R = 0.80/1.54 = 0.52
    expect(reward).toBeCloseTo(0.80, 2);
    expect(rrRatio).toBeLessThan(minRR); // gate still rejects this trade
  });
});
