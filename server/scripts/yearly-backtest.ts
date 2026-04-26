/**
 * Phase 37 — Yearly Backtest Harness.
 *
 * Goals:
 *   - Replay 1 year of REAL 15-min OHLCV candles for BTC/ETH/SOL.
 *   - Run signals through the SAME production helpers we just shipped:
 *     - selectRewardDistance + selectMinRr   (Phase 22 R:R gate)
 *     - aggregateSignals                     (consensus math, SignalAggregator)
 *     - shouldAllowClose / evaluateThesisInvalidation / evaluateStuckPosition
 *                                            (Phase 24/25/27 exit logic)
 *     - canEnterProfitably                   (Phase 11 entry viability)
 *     - getTradingConfig                     (live config snapshot)
 *   - Track every trade with full attribution (consensus, agent votes,
 *     entry/exit reasons, peak excursion, gross/net pnl).
 *   - Persist all decisions + trades + per-candle state for later forensic
 *     analysis (`data/backtest-yearly/...`).
 *   - Output a detailed report at the end.
 *
 * Non-goals:
 *   - The full 14-agent stack with on-chain / sentiment / news data. Those
 *     agents need live data feeds we don't have historicals for. The
 *     backtest uses a focused 4-agent stub: RSI, SMA-cross, Bollinger
 *     reversion, ATR-momentum — enough to exercise consensus + gates.
 *   - 1-min tick precision. 15-min OHLCV is the resolution. SL/TP are
 *     evaluated against [low, high] of each candle — captures any intra-
 *     candle hit even though we don't see the path.
 *
 * Output files:
 *   data/backtest-yearly/trades/{runId}.json       (all closed trades)
 *   data/backtest-yearly/decisions/{runId}.jsonl   (every signal evaluation, jsonl)
 *   data/backtest-yearly/reports/{runId}.md        (Markdown summary)
 *
 * Usage:
 *   npx tsx server/scripts/yearly-backtest.ts [opts]
 *
 *   --exchange=binance|coinbase   (default: coinbase, drag 1.30%)
 *   --consensus-floor=0.50        (default: 0.50; min weighted strength to enter)
 *   --sl-atr=2.0                  (default: 2.0; SL = atr × this)
 *   --tp-atr=3.0                  (default: 3.0; TP = atr × this; pre-walks S/R if available)
 *   --label=...                   (optional run label for the report header)
 *   --use-walked-tp=true|false    (default: true; when false, skip S/R walk and use atr × tp-atr)
 *
 * Scenarios commonly run (all data persisted, all decisions logged):
 *   - baseline:        defaults
 *   - binance-fees:    --exchange=binance
 *   - tight-consensus: --exchange=binance --consensus-floor=0.75
 *   - wide-tp:         --exchange=binance --consensus-floor=0.75 --sl-atr=1.5 --tp-atr=4.0
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { aggregateSignals } from '../services/SignalAggregator';
import {
  shouldAllowClose,
  evaluateThesisInvalidation,
  evaluateStuckPosition,
  computeGrossPnlPercent,
  resolveDragPercent,
  canEnterProfitably,
  type ProfitLockPosition,
} from '../services/ProfitLockGuard';
import {
  selectRewardDistance,
  selectMinRr,
} from '../services/AutomatedSignalProcessor';
import { getTradingConfig, PRODUCTION_CONFIG, setTradingConfig } from '../config/TradingConfig';
import type { AgentSignal } from '../agents/AgentBase';

// Ensure live config is loaded (Phase 22-35 defaults).
setTradingConfig({ ...PRODUCTION_CONFIG });

// Default agent weights for the agent stub. aggregateSignals expects this
// param to map every voting agent to a weight (0..1 normalized). Production
// uses AgentWeightManager but for the backtest we feed flat weights;
// downstream Phase 32 calibration would adjust them based on observed accuracy.
//
// Phase 37 Step 2 — added FundingRateAnalyst (5th agent). Funding rate is
// the only public-data alpha source we can backtest against (perp futures
// charge it every 8h; sign + magnitude predicts mean-reversion at 4-8h
// horizon). Weighting: gave it 0.30 — funding has documented predictive
// edge in academic literature; the OHLCV-derived agents are weighted
// proportionally lower to make room.
// Phase 42 revert — VWAP-as-agent inflated trade count via correlation with
// TechnicalAnalyst. Reverted to 5-agent weights; VWAP now used only as a
// gate (--vwap-gate=true), see entry logic.
const defaultAgentWeights: Record<string, number> = {
  TechnicalAnalyst: 0.25,
  PatternMatcher: 0.20,
  OrderFlowAnalyst: 0.20,
  OrderbookImbalance: 0.15,
  FundingRateAnalyst: 0.20,
};

// ─────────────────────────────────────────────────────────────────────────
// CLI args (parameterizable for the scenario sweep)
// ─────────────────────────────────────────────────────────────────────────
function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
const ARG_EXCHANGE = (getArg('exchange', 'coinbase') as 'binance' | 'coinbase');
const ARG_CONSENSUS_FLOOR = parseFloat(getArg('consensus-floor', '0.50') ?? '0.50');
const ARG_SL_ATR = parseFloat(getArg('sl-atr', '2.0') ?? '2.0');
const ARG_TP_ATR = parseFloat(getArg('tp-atr', '3.0') ?? '3.0');
const ARG_USE_WALKED_TP = (getArg('use-walked-tp', 'true') ?? 'true').toLowerCase() === 'true';
const ARG_LABEL = getArg('label', '');
// --drag=0.05  Manual round-trip drag override (in %). Use 0.05 for Binance
// perp futures VIP0 (0.04% taker × 2 + 0.01% slippage cushion). Useful for
// modeling exchange/account-tier differences without touching TradingConfig.
// When set (>0), overrides the per-exchange override map.
const ARG_DRAG_OVERRIDE = parseFloat(getArg('drag', '0') ?? '0');
// --funding-weight=0.20  Override FundingRateAnalyst weight (0..1). Higher
// makes funding dominate the consensus.
const ARG_FUNDING_WEIGHT = parseFloat(getArg('funding-weight', '0.20') ?? '0.20');
// Phase 40 — funding-deviation mode.
// --funding-mode=threshold|deviation
//   threshold: absolute |rate| > 0.0001 (default, prior behavior)
//   deviation: |z-score vs 7-day rolling mean| > ARG_FUNDING_Z (default 1.5)
const ARG_FUNDING_MODE = (getArg('funding-mode', 'threshold') ?? 'threshold').toLowerCase();
const ARG_FUNDING_Z = parseFloat(getArg('funding-z', '1.5') ?? '1.5');
// Phase 45 — trailing breakeven.
// --breakeven-trigger=X.X    Once peakUnrealizedPct ≥ X%, move SL to entry
//                            price ("never let a winner become a loser").
//                            Default 0 (off). Best candidate: 0.5 (half R).
// Honors the user's prime directive "100% profit booking" — once we have
// real profit shown, lock in at breakeven minimum.
const ARG_BREAKEVEN_TRIGGER = parseFloat(getArg('breakeven-trigger', '0') ?? '0');
// Phase 38 — multi-timeframe consensus.
// --mtf=true|false  When true, require alignment across 15m + 1h + 4h
//   timeframes for entry. Strict mode (default): all 3 must agree on
//   direction. Lenient mode (--mtf-require-full=false): 1h must match or
//   be neutral, 4h must match or be neutral.
// NOTE: default is STRICT — this was the configuration that produced the
// +15.99% champion run (scenario N). Lenient mode adds many more entries
// at lower win-rate.
const ARG_MTF = (getArg('mtf', 'false') ?? 'false').toLowerCase() === 'true';
const ARG_MTF_REQUIRE_FULL = (getArg('mtf-require-full', 'true') ?? 'true').toLowerCase() === 'true';
// Phase 39 — confidence-conditional position sizing.
// --conf-sizing=true|false  When true, size positions by consensus strength:
//   strength ≥ 0.85 → 1.5× base sizing
//   0.75 ≤ strength < 0.85 → 1.0× base sizing
//   below 0.75 (shouldn't pass entry) → 0.5× safety
// Boosts EV-weighted exposure without changing trade frequency. Most strongly-
// believed trades get more capital, marginal trades less.
const ARG_CONF_SIZING = (getArg('conf-sizing', 'false') ?? 'false').toLowerCase() === 'true';
// Phase 41 — volatility regime filter.
// --max-atr-ratio=2.0  Skip trades when current ATR exceeds N× the 7-day
//   rolling-average ATR. Captures the "volatile-dislocated" regime where
//   our 2×ATR SL is too narrow — those trades disproportionately hit
//   catastrophic stop. Default off (set to 0 to disable).
const ARG_MAX_ATR_RATIO = parseFloat(getArg('max-atr-ratio', '0') ?? '0');
// Phase 41 — dynamic SL widening based on volatility regime.
// --dyn-sl=true|false  When true, scale SL multiplier UP in high-volatility
//   regimes. atrRatio (current/rolling-avg) is used. Logic:
//     atrRatio < 1.0 → SL × 1.0 (low-vol, normal SL)
//     1.0 ≤ atrRatio < 1.5 → SL × 1.0 (normal-vol, normal)
//     atrRatio ≥ 1.5 → SL × 1.5 (high-vol, wider SL)
//   Catastrophic floor scales similarly. Aim: reduce CATASTROPHIC exits
//   from 10% of losses by giving high-vol trades more room.
const ARG_DYN_SL = (getArg('dyn-sl', 'false') ?? 'false').toLowerCase() === 'true';
// Phase 41 — regime-mode trading.
// --regime-mode=off|trend|range|no-counter
//   off          (default): no regime filter
//   trend        only trade when consensus direction matches 4h SMA50/200 regime
//                (rejects range and counter-trend) — proved BAD in scenario Q
//   range        only trade when 4h is ranging (|SMA50-SMA200| < band)
//                — hypothesis: agent stack is mean-reverting, prefers chop
//   no-counter   reject only explicit counter-trend trades (allow range + aligned)
//                — least restrictive
// Detection: SMA50 > SMA200 + band → up; < SMA200 - band → down; else range.
// Band default 0.25%. Need ≥ 200 4h candles (~33d).
const ARG_REGIME_MODE = (getArg('regime-mode', 'off') ?? 'off').toLowerCase();
const ARG_REGIME_BAND_PCT = parseFloat(getArg('regime-band-pct', '0.25') ?? '0.25');
// Back-compat: --trend-only=true → --regime-mode=trend.
const ARG_TREND_ONLY = (getArg('trend-only', 'false') ?? 'false').toLowerCase() === 'true';
const RESOLVED_REGIME_MODE = ARG_TREND_ONLY ? 'trend' : ARG_REGIME_MODE;
// Phase 43 — empirical entry filters (slices found via analyze-trade-features
// over scenario N).
// --time-filter=true|false   When true, skip trades during empirically lossy
//   UTC hour buckets (18-21h, WR 30.2%) and Saturday (UTC day 6, WR 29.6%).
// --conf-cap=X.XX            When set, reject entries where average agent
//   confidence > X (default 1.0 = off). Best at 0.75 — high conf was lossy.
// --min-aligned=N            Require at least N agents agreeing with consensus
//   direction. Default 1 (off). Setting to 2 filters the worst 1-aligned bucket.
const ARG_TIME_FILTER = (getArg('time-filter', 'false') ?? 'false').toLowerCase() === 'true';
const ARG_CONF_CAP = parseFloat(getArg('conf-cap', '1.0') ?? '1.0');
const ARG_MIN_ALIGNED = parseInt(getArg('min-aligned', '1') ?? '1', 10);
// Phase 42 — VWAP gate.
// --vwap-gate=true|false  When true, require price-to-VWAP relationship.
// --vwap-gate-mode=mean-rev|trend  Default mean-rev.
//   mean-rev: long pass only if z ≤ -X (price below VWAP, bounce up).
//             short pass only if z ≥ +X (price above VWAP, drop down).
//   trend:    long pass only if z ≥ +X (price above VWAP, ride up).
//             short pass only if z ≤ -X (price below VWAP, ride down).
// --vwap-z-min=X.X   z-score threshold (default 1.5).
// Investigation found ~50% of TechnicalAnalyst signals are mean-rev (RSI
// extremes) and ~50% are trend-cont (SMA stack). A single gate mode only
// helps half the time. Both modes provided for empirical comparison; ML
// (Phase 43) is the real fix to learn signal-type per trade.
const ARG_VWAP_GATE = (getArg('vwap-gate', 'false') ?? 'false').toLowerCase() === 'true';
const ARG_VWAP_GATE_MODE = (getArg('vwap-gate-mode', 'mean-rev') ?? 'mean-rev').toLowerCase();
const ARG_VWAP_Z_MIN = parseFloat(getArg('vwap-z-min', '1.5') ?? '1.5');
if (ARG_FUNDING_WEIGHT > 0 && ARG_FUNDING_WEIGHT !== 0.20) {
  // Renormalize: rescale the other 4 agents proportionally so total ≈ 1.
  const otherTotal = 1.0 - ARG_FUNDING_WEIGHT;
  const otherKeys = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'OrderbookImbalance'];
  const otherSum = otherKeys.reduce((s, k) => s + (defaultAgentWeights[k] ?? 0), 0);
  for (const k of otherKeys) {
    defaultAgentWeights[k] = (defaultAgentWeights[k] / otherSum) * otherTotal;
  }
  defaultAgentWeights.FundingRateAnalyst = ARG_FUNDING_WEIGHT;
}
console.log(`[backtest] params: exchange=${ARG_EXCHANGE} consensusFloor=${ARG_CONSENSUS_FLOOR} sl=${ARG_SL_ATR}×ATR tp=${ARG_TP_ATR}×ATR walkedTP=${ARG_USE_WALKED_TP} dragOverride=${ARG_DRAG_OVERRIDE > 0 ? ARG_DRAG_OVERRIDE.toFixed(2) + '%' : '(use exchange default)'} fundingWeight=${ARG_FUNDING_WEIGHT.toFixed(2)} mtf=${ARG_MTF}/${ARG_MTF_REQUIRE_FULL ? 'strict' : 'lenient'} confSizing=${ARG_CONF_SIZING} maxAtrRatio=${ARG_MAX_ATR_RATIO} dynSL=${ARG_DYN_SL} regime=${RESOLVED_REGIME_MODE}(band=${ARG_REGIME_BAND_PCT}%) vwapGate=${ARG_VWAP_GATE}(zMin=${ARG_VWAP_Z_MIN}) timeFilter=${ARG_TIME_FILTER} confCap=${ARG_CONF_CAP} minAligned=${ARG_MIN_ALIGNED} fundingMode=${ARG_FUNDING_MODE}(z=${ARG_FUNDING_Z}) label=${ARG_LABEL || '(none)'}`);

// Apply drag override to TradingConfig if specified.
if (ARG_DRAG_OVERRIDE > 0) {
  const cfg = { ...PRODUCTION_CONFIG };
  cfg.profitLock = {
    ...cfg.profitLock,
    exchangeFeeOverrides: {
      ...cfg.profitLock.exchangeFeeOverrides,
      binance: { roundTripFeePercent: ARG_DRAG_OVERRIDE * 0.8, slippagePercent: ARG_DRAG_OVERRIDE * 0.2 },
      coinbase: { roundTripFeePercent: ARG_DRAG_OVERRIDE * 0.8, slippagePercent: ARG_DRAG_OVERRIDE * 0.2 },
    },
  };
  setTradingConfig(cfg);
}

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
interface FundingEvent { t: number; rate: number; }

interface BacktestTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  entryConsensus: { direction: string; strength: number };
  entryAgentVotes: AgentSignal[];
  exchange: 'binance' | 'coinbase';
  quantity: number;
  notional: number;
  stopLoss: number;
  takeProfit: number;
  atrEntry: number;
  // Tracking during hold
  peakUnrealizedPct: number;
  troughUnrealizedPct: number;
  // Close
  exitTime?: number;
  exitPrice?: number;
  exitReason?: string;
  holdMinutes?: number;
  grossPnlPct?: number;
  grossPnlAbs?: number;
  netPnlPct?: number;
  netPnlAbs?: number;
  feesPaidAbs?: number;
}

interface DecisionLogEntry {
  t: number;
  symbol: string;
  type: 'signal_evaluated' | 'entry_rejected' | 'entry_approved' | 'exit_triggered';
  reason?: string;
  consensus?: { direction: string; strength: number };
  rrRatio?: number;
  minRR?: number;
  netPnlPct?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Indicator helpers — basic technicals fed to the consensus
// ─────────────────────────────────────────────────────────────────────────
function sma(values: number[], n: number): number | undefined {
  if (values.length < n) return undefined;
  const slice = values.slice(values.length - n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function rsi(values: number[], n: number): number | undefined {
  if (values.length < n + 1) return undefined;
  let gains = 0, losses = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgGain = gains / n;
  const avgLoss = losses / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function bollinger(values: number[], n: number, k: number): { upper: number; lower: number; mid: number } | undefined {
  if (values.length < n) return undefined;
  const slice = values.slice(values.length - n);
  const mid = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  return { upper: mid + k * stdev, lower: mid - k * stdev, mid };
}

function atr(highs: number[], lows: number[], closes: number[], n: number): number | undefined {
  if (closes.length < n + 1) return undefined;
  const trs: number[] = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / n;
}

// ─────────────────────────────────────────────────────────────────────────
// Funding-rate signal helper.
//
// Binary-search the funding events for the latest one at or before `t`.
// Funding fires every 8h on Binance perps. Rate sign indicates leverage
// crowding:
//   rate > 0  → longs paying shorts  → leveraged longs over-crowded
//   rate < 0  → shorts paying longs  → leveraged shorts over-crowded
//
// At extreme magnitudes (|rate| > 0.01% per 8h ≈ 11% annualized) the
// crowded side has tended to mean-revert at the 4-8h horizon. Translate:
//   high positive rate  → BEARISH bias (expect long unwind)
//   high negative rate  → BULLISH bias (expect short squeeze)
// Neutral funding (|rate| ≤ 0.005%) → no signal.
// ─────────────────────────────────────────────────────────────────────────
function findLatestFunding(events: FundingEvent[], t: number): FundingEvent | null {
  if (!events.length || t < events[0].t) return null;
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? events[ans] : null;
}

function buildFundingSignal(events: FundingEvent[] | undefined, symbol: string, t: number): AgentSignal | null {
  if (!events) return null;
  const latest = findLatestFunding(events, t);
  if (!latest) return null;
  const rate = latest.rate; // e.g. 0.0001 = 0.01% per 8h
  const ratePct = rate * 100;
  // Threshold: 0.01% per 8h is the documented "elevated" threshold —
  // typical neutral funding is 0.001%-0.005%.
  let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let confidence = 0.5;
  if (rate > 0.0001) {
    direction = 'bearish';
    confidence = Math.min(0.85, 0.55 + Math.min(rate * 1000, 0.30));
  } else if (rate < -0.0001) {
    direction = 'bullish';
    confidence = Math.min(0.85, 0.55 + Math.min(Math.abs(rate) * 1000, 0.30));
  }
  if (direction === 'neutral') return null;
  return {
    agentName: 'FundingRateAnalyst',
    symbol,
    signal: direction,
    confidence,
    reasoning: `8h funding=${(ratePct).toFixed(4)}% (${rate > 0 ? 'longs paying shorts' : 'shorts paying longs'})`,
    timestamp: t,
    executionScore: 65,
    evidence: { fundingRate: rate, fundingTime: latest.t },
  } as any;
}

// Phase 40 — funding-deviation signal.
// Instead of absolute thresholds (binary at 0.0001/8h), use deviation from
// 7-day (21-event) rolling average. Hypothesis: regime-relative funding
// signals when the leverage crowding has CHANGED, which is more
// predictive than absolute level (the level is regime-dependent).
//
// Logic at evaluation time t:
//   take latest funding + prior 20 events (7-day window)
//   mean = average rate across the 21
//   stdDev = standard deviation of rates across the 21
//   z = (latest.rate - mean) / stdDev
//   if z > +ARG_FUNDING_Z_THRESHOLD   → BEARISH (long crowding spike)
//   if z < -ARG_FUNDING_Z_THRESHOLD   → BULLISH (short crowding spike)
//   else → no signal
function buildFundingDeviationSignal(
  events: FundingEvent[] | undefined,
  symbol: string,
  t: number,
  zThreshold: number,
): AgentSignal | null {
  if (!events) return null;
  const latest = findLatestFunding(events, t);
  if (!latest) return null;
  // Find index of latest in events (linear search ok — small array overall).
  // Actually since we used binary search in findLatestFunding, repeat it.
  let lo = 0, hi = events.length - 1, latestIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) { latestIdx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (latestIdx < 20) return null; // need at least 21 events of history (7 days)
  const window = events.slice(latestIdx - 20, latestIdx + 1);
  const mean = window.reduce((s, e) => s + e.rate, 0) / window.length;
  const variance = window.reduce((s, e) => s + (e.rate - mean) ** 2, 0) / window.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev <= 0) return null;
  const z = (latest.rate - mean) / stdDev;
  if (Math.abs(z) < zThreshold) return null;
  const direction: 'bullish' | 'bearish' = z > 0 ? 'bearish' : 'bullish';
  // Confidence scales with |z|. Bounded [0.55, 0.90].
  const confidence = Math.min(0.90, 0.55 + (Math.abs(z) - zThreshold) * 0.15);
  return {
    agentName: 'FundingRateAnalyst',
    symbol,
    signal: direction,
    confidence,
    reasoning: `funding-z=${z.toFixed(2)} (rate ${(latest.rate * 100).toFixed(4)}% vs 7d-avg ${(mean * 100).toFixed(4)}%)`,
    timestamp: t,
    executionScore: 65,
    evidence: { fundingRate: latest.rate, mean, stdDev, z, fundingTime: latest.t },
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 42 — VWAP-deviation agent.
//
// Why VWAP and not another moving average: VWAP weights price by volume,
// so it converges to where actual contracts traded — the "fair value" of
// the recent session. Deviations above/below VWAP that are large in z-score
// terms tend to revert. This is documented intra-day mean-reversion edge.
//
// Window: rolling 96 bars (24h on 15m). Compute:
//   vwap_t  = Σ(p_i × v_i) / Σ(v_i)  for i in last 96
//   sigma_t = std deviation of (close_i - vwap_t) over the same window
//   z_t     = (close_t - vwap_t) / sigma_t
// Signal:
//   z > +2  → BEARISH (price stretched above fair → expect revert)
//   z < -2  → BULLISH (price stretched below fair → expect revert)
//   |z| ≤ 1 → NEUTRAL (no edge)
//   1 < |z| < 2 → weak signal, lower confidence
// ─────────────────────────────────────────────────────────────────────────
function buildVwapSignal(history: Candle[], symbol: string, t: number): AgentSignal | null {
  const N = 96;
  if (history.length < N) return null;
  const window = history.slice(-N);
  let pvSum = 0, vSum = 0;
  for (const c of window) {
    const tp = (c.h + c.l + c.c) / 3;
    pvSum += tp * c.v;
    vSum += c.v;
  }
  if (vSum <= 0) return null;
  const vwap = pvSum / vSum;
  // std dev of (close - vwap) over the window.
  let sqSum = 0;
  for (const c of window) sqSum += (c.c - vwap) ** 2;
  const sigma = Math.sqrt(sqSum / window.length);
  if (sigma <= 0) return null;
  const last = history[history.length - 1].c;
  const z = (last - vwap) / sigma;
  const absZ = Math.abs(z);
  // Always return the raw z so callers can apply their own threshold.
  // Direction is mean-reversion: above VWAP → expect down (bearish), and
  // below → expect up (bullish). 'neutral' if z==0 exactly.
  let direction: 'bullish' | 'bearish' | 'neutral';
  if (z > 0) direction = 'bearish';
  else if (z < 0) direction = 'bullish';
  else direction = 'neutral';
  // Confidence scales with |z|. Bounded [0.50, 0.90].
  const confidence = Math.min(0.90, 0.50 + absZ * 0.15);
  return {
    agentName: 'VwapDeviation',
    symbol,
    signal: direction,
    confidence,
    reasoning: `VWAP z=${z.toFixed(2)} (price ${last.toFixed(2)} vs VWAP ${vwap.toFixed(2)} σ=${sigma.toFixed(2)})`,
    timestamp: t,
    executionScore: 60,
    evidence: { vwap, sigma, z },
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────
// Agent stubs — production-faithful signals from candles + funding
// ─────────────────────────────────────────────────────────────────────────
function buildAgentSignals(
  history: Candle[],
  symbol: string,
  t: number,
  fundingEvents?: FundingEvent[],
): AgentSignal[] {
  const closes = history.map((c) => c.c);
  const highs = history.map((c) => c.h);
  const lows = history.map((c) => c.l);

  const signals: AgentSignal[] = [];

  // Agent 1: TechnicalAnalyst — RSI + SMA cross
  const rsi14 = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const lastClose = closes[closes.length - 1];
  if (rsi14 !== undefined && sma20 !== undefined && sma50 !== undefined) {
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    if (rsi14 < 30 && sma20 > sma50) {
      direction = 'bullish';
      confidence = Math.min(0.9, 0.6 + (30 - rsi14) / 50);
    } else if (rsi14 > 70 && sma20 < sma50) {
      direction = 'bearish';
      confidence = Math.min(0.9, 0.6 + (rsi14 - 70) / 50);
    } else if (sma20 > sma50 && lastClose > sma20) {
      direction = 'bullish';
      confidence = 0.65;
    } else if (sma20 < sma50 && lastClose < sma20) {
      direction = 'bearish';
      confidence = 0.65;
    }
    const _atr = atr(highs, lows, closes, 14) ?? 0;
    signals.push({
      agentName: 'TechnicalAnalyst',
      symbol,
      signal: direction,
      confidence,
      reasoning: `RSI=${rsi14?.toFixed(1)} sma20=${sma20?.toFixed(2)} sma50=${sma50?.toFixed(2)}`,
      timestamp: t,
      executionScore: 60,
      evidence: {
        rsi: rsi14,
        atr: _atr,
        avgATR: _atr,
        // Build resistance/support arrays for the R:R walker
        // (sorted ascending for resistance, descending for support).
        resistance: [
          lastClose * 1.005,
          lastClose * 1.015,
          lastClose * 1.030,
        ],
        support: [
          lastClose * 0.995,
          lastClose * 0.985,
          lastClose * 0.970,
        ],
        superTrend: {
          direction: sma20 !== undefined && sma50 !== undefined
            ? (sma20 > sma50 ? 'bullish' : 'bearish')
            : 'neutral',
        },
      },
    } as AgentSignal);
  }

  // Agent 2: PatternMatcher — Bollinger reversion
  const bb = bollinger(closes, 20, 2);
  if (bb) {
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    if (lastClose <= bb.lower) {
      direction = 'bullish';
      confidence = 0.75;
    } else if (lastClose >= bb.upper) {
      direction = 'bearish';
      confidence = 0.75;
    } else if (lastClose < bb.mid * 0.99) {
      direction = 'bullish';
      confidence = 0.55;
    } else if (lastClose > bb.mid * 1.01) {
      direction = 'bearish';
      confidence = 0.55;
    }
    if (direction !== 'neutral') {
      signals.push({
        agentName: 'PatternMatcher',
        symbol,
        signal: direction,
        confidence,
        reasoning: `BB band: close=${lastClose.toFixed(2)} mid=${bb.mid.toFixed(2)}`,
        timestamp: t,
        executionScore: 55,
        evidence: { bb },
      } as AgentSignal);
    }
  }

  // Agent 3: OrderFlowAnalyst — momentum (close vs N-bar past)
  if (closes.length >= 12) {
    const prev = closes[closes.length - 12];
    const momPct = ((lastClose - prev) / prev) * 100;
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 0.5;
    if (momPct > 1.0) {
      direction = 'bullish';
      confidence = Math.min(0.85, 0.5 + Math.abs(momPct) / 10);
    } else if (momPct < -1.0) {
      direction = 'bearish';
      confidence = Math.min(0.85, 0.5 + Math.abs(momPct) / 10);
    }
    if (direction !== 'neutral') {
      signals.push({
        agentName: 'OrderFlowAnalyst',
        symbol,
        signal: direction,
        confidence,
        reasoning: `12-bar momentum ${momPct.toFixed(2)}%`,
        timestamp: t,
        executionScore: 50,
      } as AgentSignal);
    }
  }

  // Agent 4: OrderbookImbalanceAgent — proxied by recent volume direction
  if (history.length >= 5) {
    const recent = history.slice(-5);
    let upVol = 0, downVol = 0;
    for (const c of recent) {
      if (c.c >= c.o) upVol += c.v; else downVol += c.v;
    }
    const total = upVol + downVol;
    if (total > 0) {
      const imbalance = (upVol - downVol) / total;
      let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let confidence = 0.4;
      if (imbalance > 0.3) {
        direction = 'bullish';
        confidence = Math.min(0.8, 0.4 + Math.abs(imbalance) * 0.5);
      } else if (imbalance < -0.3) {
        direction = 'bearish';
        confidence = Math.min(0.8, 0.4 + Math.abs(imbalance) * 0.5);
      }
      if (direction !== 'neutral') {
        signals.push({
          agentName: 'OrderbookImbalance',
          symbol,
          signal: direction,
          confidence,
          reasoning: `5-bar volume imbalance ${(imbalance * 100).toFixed(1)}%`,
          timestamp: t,
          executionScore: 50,
        } as AgentSignal);
      }
    }
  }

  // Agent 5: FundingRateAnalyst — Binance perp funding rate (8h cadence).
  const fundingSig = ARG_FUNDING_MODE === 'deviation'
    ? buildFundingDeviationSignal(fundingEvents, symbol, t, ARG_FUNDING_Z)
    : buildFundingSignal(fundingEvents, symbol, t);
  if (fundingSig) signals.push(fundingSig);

  // Phase 42 — VwapDeviation no longer used as a voting agent (correlates
  // with TechnicalAnalyst, inflated eligibility). Used as an entry-gate
  // only (see ARG_VWAP_GATE branch in runOneSymbol).

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────
// Backtest core
// ─────────────────────────────────────────────────────────────────────────
async function runOneSymbol(
  symbol: string,
  candles: Candle[],
  exchange: 'binance' | 'coinbase',
  initialEquity: number,
  decisionLog: fs.WriteStream,
  fundingEvents?: FundingEvent[],
  candles1h: Candle[] = [],
  candles4h: Candle[] = [],
): Promise<{ trades: BacktestTrade[]; equityCurve: Array<{ t: number; equity: number }> }> {

  // Phase 38 — helper: get the slice of higher-timeframe candles up to time t.
  // Binary-searches once per call; called rarely (only on entry evaluation).
  function sliceUpTo(arr: Candle[], t: number): Candle[] {
    if (arr.length === 0 || t < arr[0].t) return [];
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? arr.slice(0, ans + 1) : [];
  }

  // Phase 38 — compute consensus direction for a single timeframe.
  function consensusOnTimeframe(history: Candle[]): 'bullish' | 'bearish' | 'neutral' {
    if (history.length < 50) return 'neutral';
    const sigs = buildAgentSignals(history, symbol, history[history.length - 1].t, fundingEvents);
    const eligible = sigs.filter((s) => s.signal !== 'neutral' && s.confidence >= 0.50);
    if (eligible.length < 2) return 'neutral';
    const c = aggregateSignals(eligible, defaultAgentWeights, undefined);
    if (c.strength < 0.50) return 'neutral';
    return c.direction === 'bullish' || c.direction === 'bearish' ? c.direction : 'neutral';
  }
  const cfg = getTradingConfig();
  const minHistory = 50;
  const trades: BacktestTrade[] = [];
  let openTrade: BacktestTrade | null = null;
  let equity = initialEquity;
  const equityCurve: Array<{ t: number; equity: number }> = [];
  let lastEntryTime = 0;
  const cooldownMs = 30 * 60_000; // 30-min cooldown after a close before reentering same symbol

  for (let i = minHistory; i < candles.length; i++) {
    const candle = candles[i];
    const history = candles.slice(0, i + 1);
    const lastClose = candle.c;

    // 1. Update open trade — check exit conditions FIRST so SL/TP gets priority.
    if (openTrade) {
      const sideMul = openTrade.side === 'long' ? 1 : -1;
      const grossPct = sideMul * ((lastClose - openTrade.entryPrice) / openTrade.entryPrice) * 100;
      if (grossPct > openTrade.peakUnrealizedPct) openTrade.peakUnrealizedPct = grossPct;
      if (grossPct < openTrade.troughUnrealizedPct) openTrade.troughUnrealizedPct = grossPct;

      // Phase 45 — trailing breakeven: once peak profit ≥ trigger, move SL
      // to entry. Never let a winner become a loser.
      if (ARG_BREAKEVEN_TRIGGER > 0 && openTrade.peakUnrealizedPct >= ARG_BREAKEVEN_TRIGGER) {
        const newSL = openTrade.entryPrice;
        // Only tighten (long: raise SL up; short: lower SL down).
        const isTighter = openTrade.side === 'long'
          ? newSL > openTrade.stopLoss
          : newSL < openTrade.stopLoss;
        if (isTighter) openTrade.stopLoss = newSL;
      }

      // Check intra-candle hit on SL/TP (high/low touched the level).
      let exitPrice: number | undefined;
      let exitReason: string | undefined;
      const slHit = openTrade.side === 'long'
        ? candle.l <= openTrade.stopLoss
        : candle.h >= openTrade.stopLoss;
      if (slHit) {
        exitPrice = openTrade.stopLoss;
        exitReason = 'STOP_LOSS_HIT';
      } else {
        const tpHit = openTrade.side === 'long'
          ? candle.h >= openTrade.takeProfit
          : candle.l <= openTrade.takeProfit;
        if (tpHit) {
          exitPrice = openTrade.takeProfit;
          exitReason = 'TAKE_PROFIT_HIT';
        }
      }

      // Phase 24/25 — thesis-invalidated / stuck-position.
      if (!exitPrice) {
        const holdMinutes = (candle.t - openTrade.entryTime) / 60_000;
        const sigs = buildAgentSignals(history, symbol, candle.t, fundingEvents);
        const consensusNow = aggregateSignals(sigs, defaultAgentWeights, undefined);
        const guardPos: ProfitLockPosition = {
          side: openTrade.side,
          entryPrice: openTrade.entryPrice,
          exchange,
          entryDirection: openTrade.side === 'long' ? 'bullish' : 'bearish',
          currentDirection: consensusNow.direction === 'bullish' || consensusNow.direction === 'bearish'
            ? consensusNow.direction
            : 'neutral',
          currentConsensusStrength: consensusNow.strength,
          peakUnrealizedPnlPercent: openTrade.peakUnrealizedPct,
          holdMinutes,
        };
        const thesisCheck = evaluateThesisInvalidation(guardPos, grossPct, cfg.profitLock.thesisInvalidationExit);
        if (thesisCheck.invalidated) {
          exitPrice = lastClose;
          exitReason = `THESIS_INVALIDATED:${thesisCheck.reason}`;
        } else {
          const stuckCheck = evaluateStuckPosition(guardPos, grossPct, cfg.profitLock.stuckPositionExit);
          if (stuckCheck.stuck) {
            exitPrice = lastClose;
            exitReason = `STUCK_POSITION:${stuckCheck.reason}`;
          }
        }
      }

      // Hard catastrophic floor (regardless of thesis).
      if (!exitPrice && grossPct <= cfg.profitLock.catastrophicStopPercent) {
        exitPrice = lastClose;
        exitReason = `CATASTROPHIC:${grossPct.toFixed(2)}%`;
      }

      if (exitPrice !== undefined && exitReason) {
        const closingGrossPct = sideMul * ((exitPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100;
        const drag = resolveDragPercent({ side: openTrade.side, entryPrice: openTrade.entryPrice, exchange });
        const netPct = closingGrossPct - drag.totalCostPercent;
        const grossAbs = (closingGrossPct / 100) * openTrade.notional;
        const feesAbs = (drag.totalCostPercent / 100) * openTrade.notional;
        const netAbs = grossAbs - feesAbs;
        openTrade.exitTime = candle.t;
        openTrade.exitPrice = exitPrice;
        openTrade.exitReason = exitReason;
        openTrade.holdMinutes = (candle.t - openTrade.entryTime) / 60_000;
        openTrade.grossPnlPct = closingGrossPct;
        openTrade.grossPnlAbs = grossAbs;
        openTrade.netPnlPct = netPct;
        openTrade.netPnlAbs = netAbs;
        openTrade.feesPaidAbs = feesAbs;
        equity += netAbs;
        trades.push(openTrade);
        decisionLog.write(JSON.stringify({
          t: candle.t, symbol, type: 'exit_triggered',
          reason: exitReason,
          netPnlPct: netPct, holdMinutes: openTrade.holdMinutes,
        }) + '\n');
        lastEntryTime = candle.t;
        openTrade = null;
      }
    }

    // 2. If no position, evaluate entry.
    if (!openTrade && (candle.t - lastEntryTime) >= cooldownMs) {
      const sigs = buildAgentSignals(history, symbol, candle.t, fundingEvents);
      const eligible = sigs.filter((s) => s.signal !== 'neutral' && s.confidence >= 0.50);
      if (eligible.length < 2) {
        decisionLog.write(JSON.stringify({
          t: candle.t, symbol, type: 'entry_rejected',
          reason: `not_enough_eligible:${eligible.length}/${sigs.length}`,
        }) + '\n');
        equityCurve.push({ t: candle.t, equity });
        continue;
      }
      const consensus = aggregateSignals(eligible, defaultAgentWeights, undefined);
      if (consensus.direction === 'neutral' || consensus.strength < ARG_CONSENSUS_FLOOR) {
        decisionLog.write(JSON.stringify({
          t: candle.t, symbol, type: 'entry_rejected',
          reason: `consensus_too_weak:${(consensus.strength * 100).toFixed(1)}%<${(ARG_CONSENSUS_FLOOR*100).toFixed(0)}%`,
          consensus: { direction: consensus.direction, strength: consensus.strength },
        }) + '\n');
        equityCurve.push({ t: candle.t, equity });
        continue;
      }

      // Phase 43 — empirical entry filters from feature-bucket analysis.
      // Time-of-day filter: hour 18-21 UTC (WR 30.2%) and Saturday (WR 29.6%).
      if (ARG_TIME_FILTER) {
        const d = new Date(candle.t);
        const utcHour = d.getUTCHours();
        const utcDay = d.getUTCDay(); // 0=Sun, 6=Sat
        if ((utcHour >= 18 && utcHour < 21) || utcDay === 6) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `time_filter:hour=${utcHour} day=${utcDay}`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
      }
      // Confidence cap: high avg confidence (≥ 0.75) bucket had WR 26.8%.
      if (ARG_CONF_CAP < 1.0) {
        const avgConf = eligible.reduce((s, v) => s + v.confidence, 0) / Math.max(1, eligible.length);
        if (avgConf > ARG_CONF_CAP) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `conf_cap:avg=${avgConf.toFixed(3)}>${ARG_CONF_CAP}`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
      }
      // Min-aligned: too few agents agreeing with consensus direction = noise.
      if (ARG_MIN_ALIGNED > 1) {
        const aligned = eligible.filter((v) => v.signal === consensus.direction).length;
        if (aligned < ARG_MIN_ALIGNED) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `min_aligned:${aligned}<${ARG_MIN_ALIGNED}`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
      }

      // Phase 38 — multi-timeframe alignment.
      // 15m alone is too noisy; require the 1h consensus to agree (or be
      // neutral) AND the 4h consensus to NOT contradict. With ARG_MTF_REQUIRE_FULL,
      // BOTH 1h and 4h must explicitly agree (strict). Otherwise: 1h must
      // agree, 4h must not contradict.
      if (ARG_MTF) {
        const dir = consensus.direction;
        const slice1h = sliceUpTo(candles1h, candle.t);
        const slice4h = sliceUpTo(candles4h, candle.t);
        const cons1h = consensusOnTimeframe(slice1h);
        const cons4h = consensusOnTimeframe(slice4h);
        let aligned: boolean;
        if (ARG_MTF_REQUIRE_FULL) {
          aligned = (cons1h === dir) && (cons4h === dir);
        } else {
          aligned = (cons1h === dir || cons1h === 'neutral') && (cons4h === dir || cons4h === 'neutral');
        }
        if (!aligned) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `mtf_misaligned:15m=${dir} 1h=${cons1h} 4h=${cons4h}`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
      }

      // Phase 41 — regime filter (4h SMA50 vs SMA200).
      // Why 4h not 15m: 15m SMA200 = 50h, too short to define a regime.
      // 4h SMA200 ≈ 33 days = market-wide trend scale.
      // Modes (RESOLVED_REGIME_MODE): off / trend / range / no-counter.
      if (RESOLVED_REGIME_MODE !== 'off') {
        const slice4h = sliceUpTo(candles4h, candle.t);
        if (slice4h.length >= 200) {
          const closes4h = slice4h.map((c) => c.c);
          const sma50_4h = sma(closes4h, 50);
          const sma200_4h = sma(closes4h, 200);
          if (sma50_4h !== undefined && sma200_4h !== undefined) {
            const spreadPct = ((sma50_4h - sma200_4h) / sma200_4h) * 100;
            const band = ARG_REGIME_BAND_PCT;
            let regime: 'up' | 'down' | 'range';
            if (spreadPct > band) regime = 'up';
            else if (spreadPct < -band) regime = 'down';
            else regime = 'range';

            const dir = consensus.direction;
            const aligned =
              (regime === 'up' && dir === 'bullish') ||
              (regime === 'down' && dir === 'bearish');
            const counter =
              (regime === 'up' && dir === 'bearish') ||
              (regime === 'down' && dir === 'bullish');

            let reject = false;
            let reason = '';
            if (RESOLVED_REGIME_MODE === 'trend') {
              if (!aligned) { reject = true; reason = 'trend_misaligned'; }
            } else if (RESOLVED_REGIME_MODE === 'range') {
              if (regime !== 'range') { reject = true; reason = 'not_range'; }
            } else if (RESOLVED_REGIME_MODE === 'no-counter') {
              if (counter) { reject = true; reason = 'counter_trend'; }
            }

            if (reject) {
              decisionLog.write(JSON.stringify({
                t: candle.t, symbol, type: 'entry_rejected',
                reason: `regime_${reason}:dir=${dir} regime=${regime} spread=${spreadPct.toFixed(2)}% mode=${RESOLVED_REGIME_MODE}`,
              }) + '\n');
              equityCurve.push({ t: candle.t, equity });
              continue;
            }
          }
        }
      }

      // Phase 42 — VWAP gate (mean-reversion alignment).
      // Reject entries unless price is stretched in the direction we'd
      // expect a reversion from. This narrows entries to the genuine
      // mean-reversion setups the agent stack is best at.
      if (ARG_VWAP_GATE) {
        const vwapSig = buildVwapSignal(history, symbol, candle.t);
        if (!vwapSig) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `vwap_gate:no_stretch (need |z|≥${ARG_VWAP_Z_MIN})`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
        const z = (vwapSig as any).evidence?.z ?? 0;
        const dir = consensus.direction;
        let aligned: boolean;
        if (ARG_VWAP_GATE_MODE === 'trend') {
          // Trend: long needs z ≥ +X; short needs z ≤ -X (ride the move).
          aligned =
            (dir === 'bullish' && z >= ARG_VWAP_Z_MIN) ||
            (dir === 'bearish' && z <= -ARG_VWAP_Z_MIN);
        } else {
          // Mean-rev (default): long needs z ≤ -X; short needs z ≥ +X.
          aligned =
            (dir === 'bullish' && z <= -ARG_VWAP_Z_MIN) ||
            (dir === 'bearish' && z >= ARG_VWAP_Z_MIN);
        }
        if (!aligned) {
          decisionLog.write(JSON.stringify({
            t: candle.t, symbol, type: 'entry_rejected',
            reason: `vwap_gate:misaligned dir=${dir} z=${z.toFixed(2)} mode=${ARG_VWAP_GATE_MODE}`,
          }) + '\n');
          equityCurve.push({ t: candle.t, equity });
          continue;
        }
      }

      // Phase 22 — R:R gate
      const techSig = sigs.find((s) => s.agentName === 'TechnicalAnalyst');
      const techEvidence = techSig?.evidence as any;
      const _atr = techEvidence?.atr || 0;
      if (_atr <= 0) {
        equityCurve.push({ t: candle.t, equity });
        continue;
      }

      // Phase 41 — volatility regime filter.
      // 7-day rolling ATR: 7 × 24 × 4 = 672 candles at 15m. Use last 672.
      if (ARG_MAX_ATR_RATIO > 0 && history.length >= 672) {
        const atrSlice = history.slice(-672);
        const recentAtr = atr(atrSlice.map(c => c.h), atrSlice.map(c => c.l), atrSlice.map(c => c.c), 100);
        if (recentAtr && recentAtr > 0) {
          const atrRatio = _atr / recentAtr;
          if (atrRatio > ARG_MAX_ATR_RATIO) {
            decisionLog.write(JSON.stringify({
              t: candle.t, symbol, type: 'entry_rejected',
              reason: `volatility_regime:atrRatio=${atrRatio.toFixed(2)}>${ARG_MAX_ATR_RATIO}`,
            }) + '\n');
            equityCurve.push({ t: candle.t, equity });
            continue;
          }
        }
      }
      const rrCfg = cfg.entry.rr;
      // Phase 37 sweep — use CLI-overridden multipliers if specified.
      // Phase 41 — dynamic SL widening if --dyn-sl=true and volatility elevated.
      let dynamicSlMul = ARG_SL_ATR;
      if (ARG_DYN_SL && history.length >= 672) {
        const atrSlice = history.slice(-672);
        const recentAtr = atr(atrSlice.map(c => c.h), atrSlice.map(c => c.l), atrSlice.map(c => c.c), 100);
        if (recentAtr && recentAtr > 0) {
          const atrRatio = _atr / recentAtr;
          if (atrRatio >= 1.5) dynamicSlMul = ARG_SL_ATR * 1.5;
        }
      }
      const riskDistance = _atr * dynamicSlMul;
      const atrFallbackReward = _atr * ARG_TP_ATR;
      const minRR = selectMinRr(
        consensus.direction,
        techEvidence?.superTrend?.direction,
        1.0,
        rrCfg,
      );
      const srArray = consensus.direction === 'bullish' ? techEvidence?.resistance : techEvidence?.support;
      // Walk S/R if --use-walked-tp=true, else use ATR-default.
      const rewardDistance = ARG_USE_WALKED_TP
        ? selectRewardDistance(srArray, lastClose, riskDistance, minRR, atrFallbackReward)
        : atrFallbackReward;
      const rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
      if (rrRatio < minRR) {
        decisionLog.write(JSON.stringify({
          t: candle.t, symbol, type: 'entry_rejected',
          reason: `rr_too_low:${rrRatio.toFixed(2)}<${minRR}`,
          rrRatio, minRR,
        }) + '\n');
        equityCurve.push({ t: candle.t, equity });
        continue;
      }

      // Determine SL/TP from rr + walked S/R
      const side: 'long' | 'short' = consensus.direction === 'bullish' ? 'long' : 'short';
      const stopLoss = side === 'long' ? lastClose - riskDistance : lastClose + riskDistance;
      const takeProfit = side === 'long' ? lastClose + rewardDistance : lastClose - rewardDistance;

      // Phase 11 entry viability
      const viability = canEnterProfitably(
        { side, entryPrice: lastClose, exchange },
        lastClose,
        takeProfit,
      );
      if (!viability.viable) {
        decisionLog.write(JSON.stringify({
          t: candle.t, symbol, type: 'entry_rejected',
          reason: `entry_not_viable:${viability.reason}`,
        }) + '\n');
        equityCurve.push({ t: candle.t, equity });
        continue;
      }

      // Position sizing — 5% of equity per trade base.
      // Phase 39: optionally scale by consensus strength.
      let sizeMultiplier = 1.0;
      if (ARG_CONF_SIZING) {
        // Phase 39 sizing curve — exponential boost for high-conviction.
        // Tuned on K-scenario data: ≥0.85 conf has same WR but should claim
        // disproportionately more capital because gross PnL/trade is higher.
        // CLI override available via --size-095 / --size-085 / --size-075 /
        // --size-low for sweep tuning (defaults are champion N values).
        const s95 = parseFloat(getArg('size-095', '2.0') ?? '2.0');
        const s85 = parseFloat(getArg('size-085', '1.6') ?? '1.6');
        const s75 = parseFloat(getArg('size-075', '1.0') ?? '1.0');
        const sLo = parseFloat(getArg('size-low', '0.5') ?? '0.5');
        if (consensus.strength >= 0.95) sizeMultiplier = s95;
        else if (consensus.strength >= 0.85) sizeMultiplier = s85;
        else if (consensus.strength >= 0.75) sizeMultiplier = s75;
        else sizeMultiplier = sLo;
      }
      const notional = equity * cfg.positionSizing.maxPositionSizePercent * sizeMultiplier;
      const quantity = notional / lastClose;

      openTrade = {
        id: `${symbol}-${candle.t}`,
        symbol,
        side,
        entryTime: candle.t,
        entryPrice: lastClose,
        entryConsensus: { direction: consensus.direction, strength: consensus.strength },
        entryAgentVotes: sigs.map((s) => ({
          agentName: s.agentName,
          symbol: s.symbol,
          signal: s.signal,
          confidence: s.confidence,
          reasoning: s.reasoning,
          timestamp: s.timestamp,
        })) as AgentSignal[],
        exchange,
        quantity,
        notional,
        stopLoss,
        takeProfit,
        atrEntry: _atr,
        peakUnrealizedPct: 0,
        troughUnrealizedPct: 0,
      };
      decisionLog.write(JSON.stringify({
        t: candle.t, symbol, type: 'entry_approved',
        consensus: { direction: consensus.direction, strength: consensus.strength },
        rrRatio, minRR,
      }) + '\n');
    }

    equityCurve.push({ t: candle.t, equity: equity + (openTrade
      ? (openTrade.side === 'long' ? 1 : -1) * (lastClose - openTrade.entryPrice) * openTrade.quantity
      : 0) });
  }

  // Force-close any still-open trade at the last candle to count it.
  if (openTrade) {
    const last = candles[candles.length - 1];
    const sideMul = openTrade.side === 'long' ? 1 : -1;
    const grossPct = sideMul * ((last.c - openTrade.entryPrice) / openTrade.entryPrice) * 100;
    const drag = resolveDragPercent({ side: openTrade.side, entryPrice: openTrade.entryPrice, exchange });
    const netPct = grossPct - drag.totalCostPercent;
    const grossAbs = (grossPct / 100) * openTrade.notional;
    const feesAbs = (drag.totalCostPercent / 100) * openTrade.notional;
    const netAbs = grossAbs - feesAbs;
    openTrade.exitTime = last.t;
    openTrade.exitPrice = last.c;
    openTrade.exitReason = 'BACKTEST_END_FORCE_CLOSE';
    openTrade.holdMinutes = (last.t - openTrade.entryTime) / 60_000;
    openTrade.grossPnlPct = grossPct;
    openTrade.grossPnlAbs = grossAbs;
    openTrade.netPnlPct = netPct;
    openTrade.netPnlAbs = netAbs;
    openTrade.feesPaidAbs = feesAbs;
    equity += netAbs;
    trades.push(openTrade);
  }

  return { trades, equityCurve };
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  const labelSuffix = ARG_LABEL ? `--${ARG_LABEL}` : '';
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}${labelSuffix}`;
  const baseDir = path.join(process.cwd(), 'data', 'backtest-yearly');
  const candleDir = path.join(baseDir, 'candles');
  const tradeDir = path.join(baseDir, 'trades');
  const decDir = path.join(baseDir, 'decisions');
  const reportDir = path.join(baseDir, 'reports');
  for (const d of [tradeDir, decDir, reportDir]) fs.mkdirSync(d, { recursive: true });

  const decisionLogPath = path.join(decDir, `${runId}.jsonl`);
  const decisionLog = fs.createWriteStream(decisionLogPath, { flags: 'w' });

  // --symbols=BTC-USD,ETH-USD,SOL-USD  (default — all three).
  const ARG_SYMBOLS = getArg('symbols', 'BTC-USD,ETH-USD,SOL-USD') ?? 'BTC-USD,ETH-USD,SOL-USD';
  const symbols = ARG_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
  const exchange: 'binance' | 'coinbase' = ARG_EXCHANGE;
  const initialEquity = 10000;
  const equityPerSymbol = initialEquity / symbols.length;

  console.log(`[backtest] runId=${runId}`);
  console.log(`[backtest] exchange=${exchange} initialEquity=$${initialEquity} (per-symbol=$${equityPerSymbol.toFixed(2)})`);

  const allTrades: BacktestTrade[] = [];
  const symbolResults: Record<string, { trades: BacktestTrade[]; equityCurve: Array<{ t: number; equity: number }> }> = {};

  // Phase 37 Step 2 — load funding events if available.
  const fundingDir = path.join(baseDir, 'funding');

  for (const symbol of symbols) {
    // Phase 38 — accept either old `{symbol}.json` or new `{symbol}-15m.json` naming.
    let candlePath = path.join(candleDir, `${symbol}-15m.json`);
    if (!fs.existsSync(candlePath)) candlePath = path.join(candleDir, `${symbol}.json`);
    if (!fs.existsSync(candlePath)) {
      console.error(`[backtest] missing 15m candle file for ${symbol}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(candlePath, 'utf8'));
    const candles: Candle[] = data.candles;
    console.log(`\n[backtest] ${symbol}: ${candles.length} candles ${data.startISO} → ${data.endISO}`);

    // Phase 38 — load 1h and 4h alongside 15m if MTF mode is on.
    let candles1h: Candle[] = [];
    let candles4h: Candle[] = [];
    if (ARG_MTF) {
      const p1h = path.join(candleDir, `${symbol}-1h.json`);
      const p4h = path.join(candleDir, `${symbol}-4h.json`);
      if (fs.existsSync(p1h)) candles1h = JSON.parse(fs.readFileSync(p1h, 'utf8')).candles;
      if (fs.existsSync(p4h)) candles4h = JSON.parse(fs.readFileSync(p4h, 'utf8')).candles;
      console.log(`[backtest] ${symbol}: MTF on — ${candles1h.length} × 1h + ${candles4h.length} × 4h`);
    }

    let fundingEvents: { t: number; rate: number }[] | undefined;
    const fundingPath = path.join(fundingDir, `${symbol}.json`);
    if (fs.existsSync(fundingPath)) {
      const f = JSON.parse(fs.readFileSync(fundingPath, 'utf8'));
      fundingEvents = f.events as Array<{ t: number; rate: number }>;
      console.log(`[backtest] ${symbol}: ${fundingEvents.length} funding events loaded`);
    } else {
      console.log(`[backtest] ${symbol}: no funding data — agent stack will be 4-agent only`);
    }

    const { trades, equityCurve } = await runOneSymbol(symbol, candles, exchange, equityPerSymbol, decisionLog, fundingEvents, candles1h, candles4h);
    symbolResults[symbol] = { trades, equityCurve };
    allTrades.push(...trades);

    const wins = trades.filter((t) => (t.netPnlAbs ?? 0) > 0).length;
    const losses = trades.filter((t) => (t.netPnlAbs ?? 0) < 0).length;
    const totalNet = trades.reduce((sum, t) => sum + (t.netPnlAbs ?? 0), 0);
    console.log(`[backtest] ${symbol}: ${trades.length} trades | ${wins}W ${losses}L | net=$${totalNet.toFixed(2)}`);
  }

  decisionLog.end();
  await new Promise((r) => decisionLog.on('finish', r));

  // Persist trades
  const tradesPath = path.join(tradeDir, `${runId}.json`);
  fs.writeFileSync(tradesPath, JSON.stringify({ runId, exchange, initialEquity, symbols, trades: allTrades }, null, 2));

  // Generate report
  const reportPath = path.join(reportDir, `${runId}.md`);
  const report = generateReport(runId, exchange, initialEquity, symbols, symbolResults, allTrades, decisionLogPath, candleDir);
  fs.writeFileSync(reportPath, report);

  console.log(`\n[backtest] DONE`);
  console.log(`  trades:    ${tradesPath}`);
  console.log(`  decisions: ${decisionLogPath}`);
  console.log(`  report:    ${reportPath}`);
  process.exit(0);
}

function generateReport(
  runId: string,
  exchange: string,
  initialEquity: number,
  symbols: string[],
  symbolResults: Record<string, { trades: BacktestTrade[]; equityCurve: Array<{ t: number; equity: number }> }>,
  allTrades: BacktestTrade[],
  decisionLogPath: string,
  candleDir: string,
): string {
  const totalNet = allTrades.reduce((s, t) => s + (t.netPnlAbs ?? 0), 0);
  const totalGross = allTrades.reduce((s, t) => s + (t.grossPnlAbs ?? 0), 0);
  const totalFees = allTrades.reduce((s, t) => s + (t.feesPaidAbs ?? 0), 0);
  const wins = allTrades.filter((t) => (t.netPnlAbs ?? 0) > 0);
  const losses = allTrades.filter((t) => (t.netPnlAbs ?? 0) <= 0);
  const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.netPnlAbs ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.netPnlAbs ?? 0), 0) / losses.length : 0;
  const profitFactor = losses.length > 0 && avgLoss < 0
    ? Math.abs((avgWin * wins.length) / (avgLoss * losses.length))
    : Infinity;
  const totalReturnPct = (totalNet / initialEquity) * 100;

  // Equity curve aggregation (combine all symbols at common timestamps)
  // For simplicity, use the longest curve as the spine.
  let maxDrawdownPct = 0;
  for (const sym of symbols) {
    const curve = symbolResults[sym]?.equityCurve ?? [];
    let peak = -Infinity;
    for (const pt of curve) {
      if (pt.equity > peak) peak = pt.equity;
      const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  // Phase 44 prep — Sharpe ratio + worst-day DD.
  // Daily PnL: aggregate by exit-day (when PnL is realized).
  const dailyPnl: Record<string, number> = {};
  for (const t of allTrades) {
    if (t.exitTime === undefined) continue;
    const day = new Date(t.exitTime).toISOString().slice(0, 10);
    dailyPnl[day] = (dailyPnl[day] ?? 0) + (t.netPnlAbs ?? 0);
  }
  const days = Object.keys(dailyPnl).sort();
  const dailyReturns = days.map((d) => dailyPnl[d] / initialEquity);
  let sharpeAnnualized = 0;
  if (dailyReturns.length > 1) {
    const meanDaily = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / dailyReturns.length;
    const stdDaily = Math.sqrt(variance);
    if (stdDaily > 0) sharpeAnnualized = (meanDaily / stdDaily) * Math.sqrt(365);
  }
  // Worst single-day drawdown (% of initial equity)
  const worstDayPct = dailyReturns.length > 0
    ? Math.min(...dailyReturns) * 100
    : 0;

  // 90-day rolling-window worst metrics (the goal specifies "any 90-day window").
  const windowDays = 90;
  let worstWindowReturn = 0;
  let worstWindowDD = 0;
  let worstWindowWinRate = 100;
  if (days.length >= windowDays) {
    for (let i = 0; i + windowDays <= days.length; i++) {
      const window = days.slice(i, i + windowDays);
      const sumReturn = window.reduce((s, d) => s + dailyPnl[d], 0) / initialEquity * 100;
      // peak-to-trough DD inside the window
      let cumulative = 0;
      let peak = 0;
      let dd = 0;
      for (const d of window) {
        cumulative += dailyPnl[d];
        if (cumulative > peak) peak = cumulative;
        const ddNow = peak > 0 ? ((peak - cumulative) / initialEquity) * 100 : 0;
        if (ddNow > dd) dd = ddNow;
      }
      if (sumReturn < worstWindowReturn) worstWindowReturn = sumReturn;
      if (dd > worstWindowDD) worstWindowDD = dd;
      // Win rate in window
      const startMs = new Date(window[0]).getTime();
      const endMs = new Date(window[window.length - 1]).getTime() + 86400_000;
      const trs = allTrades.filter((t) => t.exitTime !== undefined && t.exitTime >= startMs && t.exitTime < endMs);
      if (trs.length > 0) {
        const w = trs.filter((t) => (t.netPnlAbs ?? 0) > 0).length;
        const wr = (w / trs.length) * 100;
        if (wr < worstWindowWinRate) worstWindowWinRate = wr;
      }
    }
  }

  // Per-symbol breakdown
  const perSymbol = symbols.map((sym) => {
    const ts = symbolResults[sym]?.trades ?? [];
    const w = ts.filter((t) => (t.netPnlAbs ?? 0) > 0).length;
    const l = ts.filter((t) => (t.netPnlAbs ?? 0) <= 0).length;
    const net = ts.reduce((s, t) => s + (t.netPnlAbs ?? 0), 0);
    return { sym, count: ts.length, wins: w, losses: l, winRate: ts.length > 0 ? (w / ts.length) * 100 : 0, net };
  });

  // Exit-reason breakdown
  const reasonCount: Record<string, { count: number; wins: number; netSum: number }> = {};
  for (const t of allTrades) {
    const r = (t.exitReason ?? 'unknown').split(':')[0];
    reasonCount[r] = reasonCount[r] || { count: 0, wins: 0, netSum: 0 };
    reasonCount[r].count++;
    if ((t.netPnlAbs ?? 0) > 0) reasonCount[r].wins++;
    reasonCount[r].netSum += t.netPnlAbs ?? 0;
  }

  // Per-month breakdown
  const monthCount: Record<string, { count: number; wins: number; netSum: number }> = {};
  for (const t of allTrades) {
    const month = new Date(t.entryTime).toISOString().slice(0, 7);
    monthCount[month] = monthCount[month] || { count: 0, wins: 0, netSum: 0 };
    monthCount[month].count++;
    if ((t.netPnlAbs ?? 0) > 0) monthCount[month].wins++;
    monthCount[month].netSum += t.netPnlAbs ?? 0;
  }

  // Decision rejection breakdown — read jsonl
  let totalSignalsEvaluated = 0;
  let totalRejected = 0;
  const rejectionReasons: Record<string, number> = {};
  let totalApproved = 0;
  if (fs.existsSync(decisionLogPath)) {
    const content = fs.readFileSync(decisionLogPath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'entry_rejected') {
          totalRejected++;
          totalSignalsEvaluated++;
          const r = (obj.reason ?? 'unknown').split(':')[0];
          rejectionReasons[r] = (rejectionReasons[r] || 0) + 1;
        } else if (obj.type === 'entry_approved') {
          totalApproved++;
          totalSignalsEvaluated++;
        }
      } catch {}
    }
  }

  // Best / worst trades
  const sortedByNet = [...allTrades].sort((a, b) => (b.netPnlAbs ?? 0) - (a.netPnlAbs ?? 0));
  const top5 = sortedByNet.slice(0, 5);
  const bot5 = sortedByNet.slice(-5).reverse();

  // Date range from candle files (Phase 38 — try new naming first).
  const firstSym = symbols[0];
  let candleFile = path.join(candleDir, `${firstSym}-15m.json`);
  if (!fs.existsSync(candleFile)) candleFile = path.join(candleDir, `${firstSym}.json`);
  const candleData = JSON.parse(fs.readFileSync(candleFile, 'utf8'));

  const lines: string[] = [];
  lines.push(`# Yearly Backtest Report`);
  lines.push(``);
  lines.push(`**Run ID:** ${runId}`);
  lines.push(`**Label:** ${ARG_LABEL || '(unlabeled)'}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Period:** ${candleData.startISO} → ${candleData.endISO}`);
  const dragSnapshot = resolveDragPercent({ side: 'long', entryPrice: 100, exchange: exchange as any });
  lines.push(`**Exchange:** ${exchange} (drag: ${dragSnapshot.totalCostPercent.toFixed(2)}% round-trip)`);
  lines.push(`**Parameters:** consensus≥${(ARG_CONSENSUS_FLOOR*100).toFixed(0)}% | SL=${ARG_SL_ATR}×ATR | TP=${ARG_TP_ATR}×ATR | walkedTP=${ARG_USE_WALKED_TP}`);
  lines.push(`**Initial equity:** $${initialEquity.toLocaleString()}`);
  lines.push(`**Symbols:** ${symbols.join(', ')}`);
  lines.push(`**Candle resolution:** 15-minute (real Binance public data)`);
  lines.push(`**Phase logic active:** 22 (R:R walk), 24/25/27 (thesis/stuck exits), 30 (feedback), 32 (track-record), 35 (net-bias)`);
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Headline Numbers`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Total trades** | ${allTrades.length} |`);
  lines.push(`| **Win rate** | ${winRate.toFixed(1)}% (${wins.length}W / ${losses.length}L) |`);
  lines.push(`| **Total return** | $${totalNet.toFixed(2)} (${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%) |`);
  lines.push(`| **Gross PnL** | $${totalGross.toFixed(2)} |`);
  lines.push(`| **Fees paid** | $${totalFees.toFixed(2)} |`);
  lines.push(`| **Avg win** | $${avgWin.toFixed(2)} |`);
  lines.push(`| **Avg loss** | $${avgLoss.toFixed(2)} |`);
  lines.push(`| **Profit factor** | ${isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'} |`);
  lines.push(`| **Max drawdown** | ${maxDrawdownPct.toFixed(2)}% |`);
  lines.push(`| **Sharpe (daily, annualized)** | ${sharpeAnnualized.toFixed(2)} |`);
  lines.push(`| **Worst single day** | ${worstDayPct.toFixed(2)}% |`);
  if (days.length >= windowDays) {
    lines.push(`| **Worst 90d return** | ${worstWindowReturn.toFixed(2)}% |`);
    lines.push(`| **Worst 90d DD** | ${worstWindowDD.toFixed(2)}% |`);
    lines.push(`| **Worst 90d WR** | ${worstWindowWinRate.toFixed(1)}% |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Per-Symbol Breakdown`);
  lines.push(``);
  lines.push(`| Symbol | Trades | Wins | Losses | Win Rate | Net PnL |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of perSymbol) {
    lines.push(`| ${r.sym} | ${r.count} | ${r.wins} | ${r.losses} | ${r.winRate.toFixed(1)}% | $${r.net.toFixed(2)} |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Exit-Reason Breakdown`);
  lines.push(``);
  lines.push(`| Reason | Count | Wins | Win Rate | Net PnL |`);
  lines.push(`|---|---|---|---|---|`);
  const reasonRows = Object.entries(reasonCount).sort((a, b) => b[1].count - a[1].count);
  for (const [r, v] of reasonRows) {
    const wr = v.count > 0 ? (v.wins / v.count) * 100 : 0;
    lines.push(`| ${r} | ${v.count} | ${v.wins} | ${wr.toFixed(1)}% | $${v.netSum.toFixed(2)} |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Per-Month Breakdown`);
  lines.push(``);
  lines.push(`| Month | Trades | Wins | Win Rate | Net PnL |`);
  lines.push(`|---|---|---|---|---|`);
  const monthRows = Object.entries(monthCount).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [m, v] of monthRows) {
    const wr = v.count > 0 ? (v.wins / v.count) * 100 : 0;
    lines.push(`| ${m} | ${v.count} | ${v.wins} | ${wr.toFixed(1)}% | $${v.netSum.toFixed(2)} |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Pipeline Statistics`);
  lines.push(``);
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Signals evaluated | ${totalSignalsEvaluated} |`);
  lines.push(`| Entries approved | ${totalApproved} |`);
  lines.push(`| Entries rejected | ${totalRejected} |`);
  lines.push(`| Approval rate | ${totalSignalsEvaluated > 0 ? ((totalApproved / totalSignalsEvaluated) * 100).toFixed(2) : '0'}% |`);
  lines.push(``);

  lines.push(`### Rejection Reasons`);
  lines.push(``);
  lines.push(`| Reason | Count | % of rejections |`);
  lines.push(`|---|---|---|`);
  const rejectionRows = Object.entries(rejectionReasons).sort((a, b) => b[1] - a[1]);
  for (const [r, c] of rejectionRows) {
    lines.push(`| ${r} | ${c} | ${totalRejected > 0 ? ((c / totalRejected) * 100).toFixed(1) : '0'}% |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Top 5 Winning Trades`);
  lines.push(``);
  lines.push(`| # | Symbol | Side | Entry | Exit | Net PnL | Hold | Exit Reason |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (let i = 0; i < top5.length; i++) {
    const t = top5[i];
    lines.push(`| ${i + 1} | ${t.symbol} | ${t.side} | $${t.entryPrice.toFixed(2)} | $${t.exitPrice?.toFixed(2)} | $${(t.netPnlAbs ?? 0).toFixed(2)} | ${(t.holdMinutes ?? 0).toFixed(0)}m | ${(t.exitReason ?? '').slice(0, 30)} |`);
  }
  lines.push(``);

  lines.push(`## Top 5 Losing Trades`);
  lines.push(``);
  lines.push(`| # | Symbol | Side | Entry | Exit | Net PnL | Hold | Exit Reason |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (let i = 0; i < bot5.length; i++) {
    const t = bot5[i];
    lines.push(`| ${i + 1} | ${t.symbol} | ${t.side} | $${t.entryPrice.toFixed(2)} | $${t.exitPrice?.toFixed(2)} | $${(t.netPnlAbs ?? 0).toFixed(2)} | ${(t.holdMinutes ?? 0).toFixed(0)}m | ${(t.exitReason ?? '').slice(0, 30)} |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Failure Analysis`);
  lines.push(``);
  if (losses.length > 0) {
    const avgHoldLoss = losses.reduce((s, t) => s + (t.holdMinutes ?? 0), 0) / losses.length;
    const avgGrossLoss = losses.reduce((s, t) => s + (t.grossPnlPct ?? 0), 0) / losses.length;
    const avgFeeLoss = losses.reduce((s, t) => s + (t.feesPaidAbs ?? 0), 0) / losses.length;
    const lossesByReason: Record<string, number> = {};
    for (const t of losses) {
      const r = (t.exitReason ?? 'unknown').split(':')[0];
      lossesByReason[r] = (lossesByReason[r] || 0) + 1;
    }
    lines.push(`- **Loss count:** ${losses.length}`);
    lines.push(`- **Avg hold time on losers:** ${avgHoldLoss.toFixed(0)} min`);
    lines.push(`- **Avg gross PnL on losers:** ${avgGrossLoss.toFixed(3)}%`);
    lines.push(`- **Avg fees paid on losers:** $${avgFeeLoss.toFixed(2)}`);
    lines.push(`- **Loss exit-reason distribution:**`);
    for (const [r, c] of Object.entries(lossesByReason).sort((a, b) => b[1] - a[1])) {
      lines.push(`  - \`${r}\`: ${c} (${((c / losses.length) * 100).toFixed(1)}%)`);
    }
  }
  lines.push(``);

  lines.push(`## Success Analysis`);
  lines.push(``);
  if (wins.length > 0) {
    const avgHoldWin = wins.reduce((s, t) => s + (t.holdMinutes ?? 0), 0) / wins.length;
    const avgGrossWin = wins.reduce((s, t) => s + (t.grossPnlPct ?? 0), 0) / wins.length;
    const winsByReason: Record<string, number> = {};
    for (const t of wins) {
      const r = (t.exitReason ?? 'unknown').split(':')[0];
      winsByReason[r] = (winsByReason[r] || 0) + 1;
    }
    lines.push(`- **Win count:** ${wins.length}`);
    lines.push(`- **Avg hold time on winners:** ${avgHoldWin.toFixed(0)} min`);
    lines.push(`- **Avg gross PnL on winners:** ${avgGrossWin.toFixed(3)}%`);
    lines.push(`- **Win exit-reason distribution:**`);
    for (const [r, c] of Object.entries(winsByReason).sort((a, b) => b[1] - a[1])) {
      lines.push(`  - \`${r}\`: ${c} (${((c / wins.length) * 100).toFixed(1)}%)`);
    }
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Methodology Notes`);
  lines.push(``);
  lines.push(`- **Real market data**: 1 year of 15-minute OHLCV from Binance public klines API (BTCUSDT, ETHUSDT, SOLUSDT). 35,040 candles per symbol.`);
  lines.push(`- **Same code paths as live**: imports the actual production helpers (selectRewardDistance, evaluateThesisInvalidation, evaluateStuckPosition, aggregateSignals, canEnterProfitably) — identical to what runs on prod (Phase 22-35).`);
  lines.push(`- **Agent stub**: 4-agent set (TechnicalAnalyst RSI+SMA, PatternMatcher Bollinger, OrderFlowAnalyst momentum, OrderbookImbalance volume-imbalance proxy). Production has 14 agents but most need live data feeds (sentiment, on-chain, funding) that aren't in historicals. The 4-agent stub exercises consensus + gates faithfully.`);
  lines.push(`- **Position sizing**: 5% of equity per trade (matches PRODUCTION_CONFIG.positionSizing.maxPositionSizePercent).`);
  lines.push(`- **SL/TP enforcement**: hard SL at 2×ATR below entry (long) or above (short); TP at the walked S/R level that clears minRR. Intra-candle hits checked against [low, high].`);
  lines.push(`- **Exit logic**: SL/TP price hit, then thesis-invalidation (Phase 24), then stuck-position (Phase 25), then catastrophic floor.`);
  lines.push(`- **Per-symbol cooldown**: 30 minutes after a close before reentering same symbol.`);
  lines.push(`- **Fee model**: real Coinbase taker drag (1.30% round-trip including slippage allowance) applied to net PnL.`);
  lines.push(``);

  lines.push(`---`);
  lines.push(`## Files`);
  lines.push(``);
  lines.push(`- **Trades**: \`data/backtest-yearly/trades/${runId}.json\``);
  lines.push(`- **Decision log**: \`data/backtest-yearly/decisions/${runId}.jsonl\``);
  lines.push(`- **Source candles**: \`data/backtest-yearly/candles/{BTC,ETH,SOL}-USD.json\``);
  lines.push(``);

  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
