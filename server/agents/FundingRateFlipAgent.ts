/**
 * FundingRateFlipAgent — Phase 53.19
 *
 * Detects DISCRETE funding-rate sign-change events on Binance USDT-M perps.
 * Distinct from FundingRateAnalyst which classifies static levels — this
 * agent specifically tags the moment funding crosses zero (positive →
 * negative or vice-versa) within a recent window, which is a known turning-
 * point signature in perp markets.
 *
 * Mechanism:
 *   - Funding flips POSITIVE → NEGATIVE: previously over-positioned longs are
 *     now being paid by shorts. Long crowding peaked. Short squeeze risk
 *     just dropped. Mild bullish bias (longs no longer have to bleed funding;
 *     more sustainable directional pressure).
 *   - Funding flips NEGATIVE → POSITIVE: shorts crowded, now have to pay.
 *     Bearish positioning peaked. Mild bearish bias as shorts cover and pay.
 *
 *   Note: This is the OPPOSITE of contrarian-on-extreme. The flip itself
 *   tells you the prior crowd has CAPITULATED. Continuation in the new
 *   direction often follows for a few hours.
 *
 * Cadence: 60s polling — funding doesn't update faster than that anyway.
 *   Endpoint: GET /fapi/v1/premiumIndex?symbol=BTCUSDT
 *   Returns: { lastFundingRate: "0.0001", markPrice, ... }
 *
 * History buffer: keep last 60 samples (1 hour). Detect flip if any sample
 * in last FLIP_LOOKBACK_MS has opposite sign from current rate AND the gap
 * between them spans the zero crossing (any intermediate sample with sign
 * change closes the lookout).
 *
 * Calibration:
 *   POLL_MS              = 60_000
 *   FLIP_LOOKBACK_MS     = 30 * 60_000   (look back 30 min for the flip)
 *   MIN_RATE_FOR_SIGNAL  = 0.00005       (don't fire for noise around zero)
 *   FRESH_FLIP_BONUS_MS  = 5 * 60_000    (flips within 5 min get max confidence)
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface FundingSample {
  timestamp: number;
  rate: number;
}

const BINANCE_FUTURES_API = "https://fapi.binance.com";
const POLL_MS = 60_000;
const FLIP_LOOKBACK_MS = 30 * 60_000;
const MIN_RATE_FOR_SIGNAL = 0.00005;
const FRESH_FLIP_BONUS_MS = 5 * 60_000;
const HISTORY_KEEP = 80; // ~80 minutes
const MAX_CONFIDENCE = 0.80;

export class FundingRateFlipAgent extends AgentBase {
  private history: Map<string, FundingSample[]> = new Map();
  private pollerHandle?: NodeJS.Timeout;
  private trackedSymbols: string[] = []; // populated lazily by analyze()

  constructor() {
    const config: AgentConfig = {
      name: 'FundingRateFlipAgent',
      enabled: true,
      updateInterval: 60_000,
      timeout: 10_000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[FundingRateFlipAgent] initialized — polling premiumIndex every 60s');
    this.pollerHandle = setInterval(() => { void this.pollAll(); }, POLL_MS);
  }

  protected async cleanup(): Promise<void> {
    if (this.pollerHandle) clearInterval(this.pollerHandle);
    this.pollerHandle = undefined;
    this.history.clear();
  }

  protected async periodicUpdate(): Promise<void> { /* polling has its own interval */ }

  private toBinanceSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
      const [b, q] = upper.split('-');
      return `${b}${q === 'USD' ? 'USDT' : q}`;
    }
    if (upper.includes('/')) {
      const [b, q] = upper.split('/');
      return `${b}${q === 'USD' ? 'USDT' : q}`;
    }
    return upper;
  }

  private async pollOne(binSym: string): Promise<void> {
    try {
      const r = await fetch(
        `${BINANCE_FUTURES_API}/fapi/v1/premiumIndex?symbol=${binSym}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!r.ok) return;
      const j = await r.json() as { lastFundingRate?: string };
      const rate = parseFloat(j.lastFundingRate || '0');
      if (!isFinite(rate)) return;

      const hist = this.history.get(binSym) || [];
      hist.push({ timestamp: getActiveClock().now(), rate });
      if (hist.length > HISTORY_KEEP) hist.shift();
      this.history.set(binSym, hist);
    } catch { /* swallow — next poll retries */ }
  }

  private async pollAll(): Promise<void> {
    await Promise.all(this.trackedSymbols.map(s => this.pollOne(s)));
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    if (!this.trackedSymbols.includes(binSym)) {
      this.trackedSymbols.push(binSym);
      // Kick off first poll asynchronously so future analyze() calls have data
      void this.pollOne(binSym);
      return this.neutralSignal(symbol, startTime, `Added ${binSym} to funding tracker — first poll in flight`);
    }

    const hist = this.history.get(binSym);
    if (!hist || hist.length < 2) {
      return this.neutralSignal(symbol, startTime, `Building history (${hist?.length || 0} samples, need ≥2)`);
    }

    const now = hist[hist.length - 1];
    if (Math.abs(now.rate) < MIN_RATE_FOR_SIGNAL) {
      return this.neutralSignal(symbol, startTime, `Funding near zero (${(now.rate * 100).toFixed(4)}%) — too noisy`);
    }

    // Look back: find the most recent sample with OPPOSITE sign from current.
    // The flip happened between that sample and the next-newer sample.
    const cutoff = now.timestamp - FLIP_LOOKBACK_MS;
    let flipFromSample: FundingSample | null = null;
    for (let i = hist.length - 2; i >= 0; i--) {
      const s = hist[i];
      if (s.timestamp < cutoff) break;
      if (Math.sign(s.rate) !== Math.sign(now.rate) && s.rate !== 0) {
        flipFromSample = s;
        break;
      }
    }

    if (!flipFromSample) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No flip in last ${FLIP_LOOKBACK_MS / 60_000}min (current ${(now.rate * 100).toFixed(4)}%)`,
      );
    }

    // Direction logic: + → − flip = bullish (longs no longer bleeding, sustainable)
    //                  − → + flip = bearish (shorts now paying, capitulation)
    const wasPositive = flipFromSample.rate > 0;
    const isPositive = now.rate > 0;
    let signal: 'bullish' | 'bearish';
    let scenario: string;
    if (wasPositive && !isPositive) {
      signal = 'bullish';
      scenario = '+ → − flip (long crowding peaked)';
    } else if (!wasPositive && isPositive) {
      signal = 'bearish';
      scenario = '− → + flip (short crowding peaked)';
    } else {
      return this.neutralSignal(symbol, startTime, `Indeterminate flip pattern`);
    }

    const ageMs = now.timestamp - flipFromSample.timestamp;
    const freshnessFactor = Math.max(0, 1 - ageMs / FRESH_FLIP_BONUS_MS);
    const magFactor = Math.min(Math.abs(now.rate) / 0.001, 1); // 0.1% saturates
    const confidence = Math.min(0.50 + freshnessFactor * 0.20 + magFactor * 0.10, MAX_CONFIDENCE);

    const reasoning =
      `${scenario} on ${binSym}: from ${(flipFromSample.rate * 100).toFixed(4)}% to ${(now.rate * 100).toFixed(4)}% ` +
      `${(ageMs / 60_000).toFixed(1)}min ago → ${signal} (${signal === 'bullish' ? 'long pressure released' : 'short pressure peaking'})`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: magFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        currentRate: now.rate,
        flipFromRate: flipFromSample.rate,
        flipAgeMs: ageMs,
        scenario,
        sampleCount: hist.length,
        freshnessFactor,
        magFactor,
        source: 'binance-fapi-premiumIndex',
      },
      qualityScore: 0.70,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: getActiveClock().now() - now.timestamp,
      executionScore: Math.round(40 + freshnessFactor * 25 + magFactor * 15),
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
      evidence: { historyLength: this.history.get(this.toBinanceSymbol(symbol))?.length || 0 },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
