/**
 * CVDDivergenceAgent — Phase 53.13
 *
 * Explicit perp-vs-spot Cumulative Volume Delta divergence detector.
 *
 * PerpTakerFlowAgent and SpotTakerFlowAgent already contribute their own
 * directional signals to consensus. When they AGREE (both bullish or both
 * bearish), the consensus engine naturally stacks the conviction. But when
 * they DISAGREE — that's a signal the consensus engine can't produce
 * (disagreement just cancels to neutral in weighted voting).
 *
 * The disagreement IS the signal:
 *   - Perp bullish + spot weak/bearish → speculation-only buying on leverage
 *     → over-positioned longs → FADE the move (bearish on perp pump)
 *   - Perp bearish + spot bullish/weak → spec shorting against real demand
 *     → squeeze setup → BULLISH (counter the speculative shorts)
 *
 * This is the classic "Wyckoff distribution / accumulation" pattern at the
 * tape level: smart money accumulates while public sells (or vice versa).
 *
 * Data sources (both populated by Phase 53.5/53.7 boot wiring):
 *   global.__binancePerpTakerFlow[BTCUSDT] = [...]
 *   global.__binanceSpotTakerFlow[BTCUSDT] = [...]
 *
 * Algorithm per analyze():
 *   1. Compute imbalance over LOOKBACK_MS for BOTH perp and spot
 *   2. Both ≥ MIN_NOTIONAL → continue (else neutral, insufficient data)
 *   3. signed_diff = perp_imbalance - spot_imbalance
 *      |signed_diff| ≥ DIVERGENCE_THRESHOLD → divergence detected
 *   4. Direction: opposite of perp side (we fade the speculative leg)
 *   5. Confidence scales with magnitude of divergence + size of perp burst
 *
 * Calibration:
 *   LOOKBACK_MS         = 10_000
 *   MIN_PERP_NOTIONAL   = 100_000
 *   MIN_SPOT_NOTIONAL   = 200_000   (spot is busier, need more notional to trust)
 *   DIVERGENCE_THRESHOLD = 0.40     (perp imbalance must differ from spot by ≥40%)
 *   PERP_SIZE_SAT       = 2_000_000
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface TakerFill {
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  timestamp: number;
}

const LOOKBACK_MS = 10_000;
const MIN_PERP_NOTIONAL = 100_000;
const MIN_SPOT_NOTIONAL = 200_000;
const DIVERGENCE_THRESHOLD = 0.40;
const PERP_SIZE_SAT = 2_000_000;

function imbalanceFor(ring: TakerFill[] | undefined, cutoff: number): { imbalance: number; total: number; recent: TakerFill[] } {
  if (!ring) return { imbalance: 0, total: 0, recent: [] };
  const recent = ring.filter(f => f.timestamp >= cutoff);
  let buy = 0, sell = 0;
  for (const f of recent) {
    if (f.side === 'buy') buy += f.notional;
    else sell += f.notional;
  }
  const total = buy + sell;
  const imbalance = total > 0 ? (buy - sell) / total : 0;
  return { imbalance, total, recent };
}

export class CVDDivergenceAgent extends AgentBase {
  constructor() {
    const config: AgentConfig = {
      name: 'CVDDivergenceAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[CVDDivergenceAgent] initialized (reads __binancePerpTakerFlow + __binanceSpotTakerFlow)');
  }

  protected async cleanup(): Promise<void> {
    // No persistent state.
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze().
  }

  private toBinanceSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
      const [base, quote] = upper.split('-');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    if (upper.includes('/')) {
      const [base, quote] = upper.split('/');
      const q = quote === 'USD' ? 'USDT' : quote;
      return `${base}${q}`;
    }
    return upper;
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const perpRing = ((global as any).__binancePerpTakerFlow || {})[binSym] as TakerFill[] | undefined;
    const spotRing = ((global as any).__binanceSpotTakerFlow || {})[binSym] as TakerFill[] | undefined;

    if (!perpRing || !spotRing) {
      return this.neutralSignal(symbol, startTime, `Missing ring(s): perp=${!!perpRing}, spot=${!!spotRing}`);
    }

    const cutoff = getActiveClock().now() - LOOKBACK_MS;
    const perp = imbalanceFor(perpRing, cutoff);
    const spot = imbalanceFor(spotRing, cutoff);

    if (perp.total < MIN_PERP_NOTIONAL) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Perp tape quiet: $${(perp.total / 1000).toFixed(0)}K (need ≥$${MIN_PERP_NOTIONAL / 1000}K)`,
      );
    }
    if (spot.total < MIN_SPOT_NOTIONAL) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Spot tape quiet: $${(spot.total / 1000).toFixed(0)}K (need ≥$${MIN_SPOT_NOTIONAL / 1000}K)`,
      );
    }

    const signedDiff = perp.imbalance - spot.imbalance;
    if (Math.abs(signedDiff) < DIVERGENCE_THRESHOLD) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Aligned tape: perp ${(perp.imbalance * 100).toFixed(1)}% vs spot ${(spot.imbalance * 100).toFixed(1)}% (diff ${(signedDiff * 100).toFixed(1)}% < ${DIVERGENCE_THRESHOLD * 100}%)`,
      );
    }

    // Divergence detected. Fade the perp side.
    // signedDiff > 0 → perp more bullish than spot → over-leveraged longs → bearish signal
    // signedDiff < 0 → perp more bearish than spot → over-leveraged shorts → bullish signal
    const signal: 'bullish' | 'bearish' = signedDiff > 0 ? 'bearish' : 'bullish';
    const fadingSide = signedDiff > 0 ? 'long-positioned perps' : 'short-positioned perps';

    // Confidence: base 0.45, +up to 0.25 from divergence magnitude (saturating at 1.0),
    // +up to 0.15 from perp burst size (the bigger the speculative push, the more reliable
    // the fade tendency).
    const divFactor = Math.min((Math.abs(signedDiff) - DIVERGENCE_THRESHOLD) / (1 - DIVERGENCE_THRESHOLD), 1);
    const sizeFactor = Math.min(perp.total / PERP_SIZE_SAT, 1);
    const confidence = Math.min(0.45 + divFactor * 0.25 + sizeFactor * 0.15, 0.85);

    const reasoning =
      `CVD divergence on ${binSym}: perp ${(perp.imbalance * 100).toFixed(1)}% vs spot ${(spot.imbalance * 100).toFixed(1)}% ` +
      `(diff ${(signedDiff * 100).toFixed(1)}%, perp $${(perp.total / 1000).toFixed(0)}K, spot $${(spot.total / 1000).toFixed(0)}K) ` +
      `→ fading ${fadingSide} → ${signal}`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(signedDiff), 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        windowMs: LOOKBACK_MS,
        perpImbalance: perp.imbalance,
        spotImbalance: spot.imbalance,
        signedDiff,
        perpNotional: perp.total,
        spotNotional: spot.total,
        perpFills: perp.recent.length,
        spotFills: spot.recent.length,
        fadingSide,
        divergenceFactor: divFactor,
        sizeFactor,
        source: 'binance-perp+spot-aggTrade-divergence',
      },
      qualityScore: 0.78,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: Math.min(
        getActiveClock().now() - Math.max(...perp.recent.map(f => f.timestamp), 0),
        getActiveClock().now() - Math.max(...spot.recent.map(f => f.timestamp), 0),
      ),
      executionScore: Math.round(50 + divFactor * 25 + sizeFactor * 15),
    };
  }

  private neutralSignal(symbol: string, startTime: number, reason: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal: 'neutral',
      confidence: 0.5,
      strength: 0,
      reasoning: reason,
      evidence: {},
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
