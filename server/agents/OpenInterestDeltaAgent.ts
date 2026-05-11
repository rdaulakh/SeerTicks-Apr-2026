/**
 * OpenInterestDeltaAgent — Phase 53.9
 *
 * Open interest (OI) on USDT-M perpetuals = sum of all open contracts. The
 * change in OI relative to the change in price reveals positioning intent:
 *
 *   ΔOI > 0, ΔPrice > 0  → fresh LONGS opening    (bullish continuation)
 *   ΔOI > 0, ΔPrice < 0  → fresh SHORTS opening   (bearish continuation)
 *   ΔOI < 0, ΔPrice > 0  → SHORT COVERING / squeeze (bullish, may extend)
 *   ΔOI < 0, ΔPrice < 0  → LONG CAPITULATION      (bearish continuation)
 *
 * Source:
 *   GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT
 *   → { symbol, openInterest: "<number>", time }
 *
 * Cadence: 60s polling per symbol. Endpoint weight 1, no auth, no rate-limit
 * concerns at this cadence (60 calls/hour/symbol = trivial).
 *
 * Algorithm on each analyze():
 *   1. From local history, fetch the OI sample ~5 minutes back (closest)
 *   2. Compute ΔOI% = (now - then) / then
 *   3. Compute ΔPrice% = (current price - price 5m ago) / price 5m ago
 *   4. If both deltas above their respective floors → quadrant signal
 *   5. Confidence scales with magnitude of ΔOI% (saturates at 2%)
 *
 * Calibration:
 *   POLL_MS         = 60_000
 *   LOOKBACK_MS     = 5 * 60_000  (5 min window for delta)
 *   MIN_OI_DELTA    = 0.0030      (0.3% change in OI minimum)
 *   MIN_PRICE_DELTA = 0.0010      (0.1% price move minimum)
 *   OI_DELTA_SAT    = 0.020       (2% saturates confidence)
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface OISample {
  timestamp: number;
  oi: number;
  price: number;
}

const BINANCE_FUTURES_API = "https://fapi.binance.com";
const POLL_MS = 60_000;
const LOOKBACK_MS = 5 * 60_000;
const MIN_OI_DELTA = 0.0030;
const MIN_PRICE_DELTA = 0.0010;
const OI_DELTA_SAT = 0.020;
const HISTORY_KEEP = 30; // 30 samples * 60s = 30 min lookback ceiling

export class OpenInterestDeltaAgent extends AgentBase {
  private oiHistory: Map<string, OISample[]> = new Map();
  private pollerHandle?: NodeJS.Timeout;
  // Start empty — analyze() adds the symbols it's asked about. With one
  // OI agent per GlobalSymbolAnalyzer instance, this gives 1 symbol per
  // poller (≤3 calls/min total across BTC/ETH/SOL analyzers).
  private trackedSymbols: string[] = [];

  constructor() {
    const config: AgentConfig = {
      name: 'OpenInterestDeltaAgent',
      enabled: true,
      updateInterval: 60_000,
      timeout: 10_000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[OpenInterestDeltaAgent] initialized — polling OI every 60s');
    // Kick off an immediate poll so the first analyze() has data to work with.
    void this.pollAll();
    this.pollerHandle = setInterval(() => { void this.pollAll(); }, POLL_MS);
  }

  protected async cleanup(): Promise<void> {
    if (this.pollerHandle) {
      clearInterval(this.pollerHandle);
      this.pollerHandle = undefined;
    }
    this.oiHistory.clear();
  }

  protected async periodicUpdate(): Promise<void> {
    // Polling handled by our own setInterval in initialize().
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

  /** Pull current spot/perp price from the in-memory book globals. */
  private currentPriceFor(binSym: string): number | null {
    const perp = ((global as any).__binanceFuturesBook || {})[binSym];
    if (perp && isFinite(perp.midPrice)) return perp.midPrice;
    const spot = ((global as any).__binanceSpotBook || {})[binSym];
    if (spot && isFinite(spot.midPrice)) return spot.midPrice;
    return null;
  }

  /** Fetch OI for one symbol and append to history. */
  private async pollOne(binSym: string): Promise<void> {
    try {
      const r = await fetch(
        `${BINANCE_FUTURES_API}/fapi/v1/openInterest?symbol=${binSym}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!r.ok) return; // silently — geo-block or transient
      const j = await r.json() as { openInterest?: string };
      const oi = parseFloat(j.openInterest || '0');
      if (!isFinite(oi) || oi <= 0) return;

      const price = this.currentPriceFor(binSym);
      if (price === null) return; // no price ref → skip this sample

      const hist = this.oiHistory.get(binSym) || [];
      hist.push({ timestamp: getActiveClock().now(), oi, price });
      if (hist.length > HISTORY_KEEP) hist.shift();
      this.oiHistory.set(binSym, hist);
    } catch {
      // swallow — next poll will retry
    }
  }

  private async pollAll(): Promise<void> {
    await Promise.all(this.trackedSymbols.map(s => this.pollOne(s)));
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    // If the analyzer asks for a symbol we don't track yet, add it (so future
    // polls cover it) and return neutral until we have history.
    if (!this.trackedSymbols.includes(binSym)) {
      this.trackedSymbols.push(binSym);
      return this.neutralSignal(symbol, startTime, `Added ${binSym} to OI tracker — awaiting first poll`);
    }

    const hist = this.oiHistory.get(binSym);
    if (!hist || hist.length < 2) {
      return this.neutralSignal(symbol, startTime, `Building OI history (have ${hist?.length || 0}, need 2+)`);
    }

    const now = hist[hist.length - 1];
    const targetTs = now.timestamp - LOOKBACK_MS;
    // Closest sample at-or-before target. If oldest sample is already after target,
    // use oldest sample (acceptable proxy until we have full window).
    let then: OISample = hist[0];
    for (const s of hist) {
      if (s.timestamp <= targetTs) then = s;
    }

    // If "then" is the same as "now", we need more history.
    if (then.timestamp === now.timestamp) {
      return this.neutralSignal(symbol, startTime, `OI window not filled — only one sample available`);
    }

    if (then.oi <= 0 || then.price <= 0) {
      return this.neutralSignal(symbol, startTime, `Invalid baseline OI/price`);
    }

    const oiDelta = (now.oi - then.oi) / then.oi;            // signed
    const priceDelta = (now.price - then.price) / then.price; // signed

    if (Math.abs(oiDelta) < MIN_OI_DELTA || Math.abs(priceDelta) < MIN_PRICE_DELTA) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Below threshold: ΔOI=${(oiDelta * 100).toFixed(2)}% ΔPrice=${(priceDelta * 100).toFixed(2)}% over ${((now.timestamp - then.timestamp) / 60000).toFixed(1)}min`,
      );
    }

    // Quadrant classification
    let scenario: string;
    let signal: 'bullish' | 'bearish';
    let confidenceBase: number;
    if (oiDelta > 0 && priceDelta > 0) {
      scenario = 'fresh-longs (continuation)';
      signal = 'bullish';
      confidenceBase = 0.55;
    } else if (oiDelta > 0 && priceDelta < 0) {
      scenario = 'fresh-shorts (continuation)';
      signal = 'bearish';
      confidenceBase = 0.55;
    } else if (oiDelta < 0 && priceDelta > 0) {
      scenario = 'short-squeeze (covering)';
      signal = 'bullish';
      confidenceBase = 0.50; // squeeze tendency is real but quicker to fade
    } else {
      scenario = 'long-capitulation';
      signal = 'bearish';
      confidenceBase = 0.55;
    }

    const magFactor = Math.min(Math.abs(oiDelta) / OI_DELTA_SAT, 1);
    const confidence = Math.min(confidenceBase + magFactor * 0.25, 0.85);

    const reasoning =
      `${scenario} on ${binSym}: ΔOI ${(oiDelta * 100).toFixed(2)}%, ΔPrice ${(priceDelta * 100).toFixed(2)}% ` +
      `over ${((now.timestamp - then.timestamp) / 60000).toFixed(1)}min — ` +
      `OI now ${(now.oi).toFixed(2)} (was ${then.oi.toFixed(2)})`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: Math.min(Math.abs(oiDelta) / OI_DELTA_SAT, 1),
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        nowOI: now.oi,
        thenOI: then.oi,
        oiDelta,
        nowPrice: now.price,
        thenPrice: then.price,
        priceDelta,
        scenario,
        windowMs: now.timestamp - then.timestamp,
        sampleCount: hist.length,
        source: 'binance-fapi-openInterest',
      },
      qualityScore: 0.75,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: getActiveClock().now() - now.timestamp,
      executionScore: Math.round(40 + magFactor * 30),
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
      evidence: { historyLength: this.oiHistory.get(this.toBinanceSymbol(symbol))?.length || 0 },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
