/**
 * LiquidityVacuumAgent — Phase 53.17
 *
 * Detects when the perp top-5 order book is unusually thin compared to its
 * recent baseline. Thin liquidity amplifies any incoming taker pressure —
 * a $1M market order through a $5M book moves price 5x as much as through
 * a $25M book. Vacuum is a regime indicator: "expect amplified moves".
 *
 * Direction is determined by which side is thinner:
 *   - Thin asks (sellers stepping back) → upside vacuum → bullish
 *   - Thin bids (buyers stepping back) → downside vacuum → bearish
 *   - Both sides thin → range/breakout uncertain → neutral
 *
 * Data:
 *   global.__binancePerpDepth5[BTCUSDT] = { bids, asks, ... }
 *
 * Algorithm:
 *   1. Compute current Σbid_qty and Σask_qty over top-5
 *   2. Maintain rings of last 60 samples each (~30s baseline)
 *   3. For each side, compute current/median ratio
 *   4. If one side ≤ VACUUM_FACTOR × median AND other side ≥ NORMAL_FACTOR × median
 *      → directional vacuum signal
 *
 * Calibration:
 *   VACUUM_FACTOR  = 0.60  (a side is "vacuumed" at ≤60% of its median)
 *   NORMAL_FACTOR  = 0.85  (other side must be at least 85% of normal — clean asymmetry)
 *   STALE_MS       = 1500
 *   RING_SIZE      = 60
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';

interface DepthLevel { price: number; qty: number; }
interface DepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  receivedAt: number;
}

const VACUUM_FACTOR = 0.60;
const NORMAL_FACTOR = 0.85;
const STALE_MS = 1_500;
const RING_SIZE = 60;
const MAX_CONFIDENCE = 0.78;

export class LiquidityVacuumAgent extends AgentBase {
  private bidRings: Map<string, number[]> = new Map();
  private askRings: Map<string, number[]> = new Map();

  constructor() {
    const config: AgentConfig = {
      name: 'LiquidityVacuumAgent',
      enabled: true,
      updateInterval: 1000,
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    console.log('[LiquidityVacuumAgent] initialized (reads __binancePerpDepth5)');
  }

  protected async cleanup(): Promise<void> {
    this.bidRings.clear();
    this.askRings.clear();
  }
  protected async periodicUpdate(): Promise<void> { /* no periodic */ }

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

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const binSym = this.toBinanceSymbol(symbol);

    const depth = ((global as any).__binancePerpDepth5 || {})[binSym] as DepthSnapshot | undefined;
    if (!depth) return this.neutralSignal(symbol, startTime, `No depth5 for ${binSym}`);
    const age = getActiveClock().now() - depth.receivedAt;
    if (age > STALE_MS) return this.neutralSignal(symbol, startTime, `Depth stale (${age}ms)`);
    if (!depth.bids?.length || !depth.asks?.length) {
      return this.neutralSignal(symbol, startTime, `Empty depth (bids=${depth.bids?.length} asks=${depth.asks?.length})`);
    }

    const bidQty = depth.bids.reduce((s, l) => s + l.qty, 0);
    const askQty = depth.asks.reduce((s, l) => s + l.qty, 0);
    if (bidQty <= 0 || askQty <= 0) {
      return this.neutralSignal(symbol, startTime, `Zero quantity side (bid=${bidQty} ask=${askQty})`);
    }

    let bidRing = this.bidRings.get(symbol);
    let askRing = this.askRings.get(symbol);
    if (!bidRing) { bidRing = []; this.bidRings.set(symbol, bidRing); }
    if (!askRing) { askRing = []; this.askRings.set(symbol, askRing); }
    bidRing.push(bidQty);
    askRing.push(askQty);
    if (bidRing.length > RING_SIZE) bidRing.shift();
    if (askRing.length > RING_SIZE) askRing.shift();

    if (bidRing.length < 15 || askRing.length < 15) {
      return this.neutralSignal(symbol, startTime, `Building baselines (bid ${bidRing.length}/15, ask ${askRing.length}/15)`);
    }

    const bidMedian = this.median(bidRing);
    const askMedian = this.median(askRing);
    if (bidMedian <= 0 || askMedian <= 0) {
      return this.neutralSignal(symbol, startTime, `Degenerate baseline (bidMed=${bidMedian} askMed=${askMedian})`);
    }

    const bidRatio = bidQty / bidMedian;
    const askRatio = askQty / askMedian;

    const bidVacuumed = bidRatio <= VACUUM_FACTOR;
    const askVacuumed = askRatio <= VACUUM_FACTOR;
    const bidNormal = bidRatio >= NORMAL_FACTOR;
    const askNormal = askRatio >= NORMAL_FACTOR;

    if (bidVacuumed && askVacuumed) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Two-sided vacuum (bid ${(bidRatio * 100).toFixed(0)}%, ask ${(askRatio * 100).toFixed(0)}% of baseline) — directional uncertain`,
      );
    }
    if (!bidVacuumed && !askVacuumed) {
      return this.neutralSignal(
        symbol,
        startTime,
        `No vacuum (bid ${(bidRatio * 100).toFixed(0)}%, ask ${(askRatio * 100).toFixed(0)}%) — both sides ≥${(VACUUM_FACTOR * 100).toFixed(0)}% of baseline`,
      );
    }

    // Exactly one side vacuumed. Require the other side near normal for clean signal.
    if (bidVacuumed && !askNormal) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Bids thin (${(bidRatio * 100).toFixed(0)}%) but asks also below normal (${(askRatio * 100).toFixed(0)}% < ${(NORMAL_FACTOR * 100).toFixed(0)}%) — unclean signal`,
      );
    }
    if (askVacuumed && !bidNormal) {
      return this.neutralSignal(
        symbol,
        startTime,
        `Asks thin (${(askRatio * 100).toFixed(0)}%) but bids also below normal (${(bidRatio * 100).toFixed(0)}% < ${(NORMAL_FACTOR * 100).toFixed(0)}%) — unclean signal`,
      );
    }

    // Clean one-sided vacuum.
    // Asks thin (sellers stepping back) → upward vacuum → bullish.
    // Bids thin (buyers stepping back) → downward vacuum → bearish.
    const signal: 'bullish' | 'bearish' = askVacuumed ? 'bullish' : 'bearish';
    const vacuumRatio = askVacuumed ? askRatio : bidRatio;
    const oppositeRatio = askVacuumed ? bidRatio : askRatio;

    // Confidence: base 0.45
    //   + up to 0.22 from vacuum depth (lower vacuumRatio = more conviction)
    //   + up to 0.13 from opposite-side normality (higher = cleaner)
    const vacuumFactor = Math.min((VACUUM_FACTOR - vacuumRatio) / VACUUM_FACTOR, 1);
    const cleanFactor = Math.min((oppositeRatio - NORMAL_FACTOR) / (1 - NORMAL_FACTOR + 0.001), 1);
    const confidence = Math.min(0.45 + vacuumFactor * 0.22 + Math.max(0, cleanFactor) * 0.13, MAX_CONFIDENCE);

    const vacuumSide = askVacuumed ? 'asks' : 'bids';
    const reasoning =
      `Liquidity vacuum on ${binSym}: ${vacuumSide} ${(vacuumRatio * 100).toFixed(0)}% of baseline ` +
      `(${vacuumSide === 'asks' ? askQty.toFixed(2) : bidQty.toFixed(2)} vs median ${(vacuumSide === 'asks' ? askMedian : bidMedian).toFixed(2)}), ` +
      `opposite ${(oppositeRatio * 100).toFixed(0)}% — ${signal} break expected (${vacuumSide === 'asks' ? 'no sellers' : 'no buyers'})`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength: vacuumFactor,
      reasoning,
      evidence: {
        binanceSymbol: binSym,
        bidQty,
        askQty,
        bidMedian,
        askMedian,
        bidRatio,
        askRatio,
        vacuumSide,
        vacuumRatio,
        oppositeRatio,
        bidRingSize: bidRing.length,
        askRingSize: askRing.length,
        depthAgeMs: age,
        vacuumFactor,
        cleanFactor,
        source: 'binance-perp-depth5-vacuum',
      },
      qualityScore: 0.74,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: age,
      executionScore: Math.round(45 + vacuumFactor * 25 + Math.max(0, cleanFactor) * 10),
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
      evidence: {
        bidRingSize: this.bidRings.get(symbol)?.length || 0,
        askRingSize: this.askRings.get(symbol)?.length || 0,
      },
      qualityScore: 0.5,
      processingTime: getActiveClock().now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
