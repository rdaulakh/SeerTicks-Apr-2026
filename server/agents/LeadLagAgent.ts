/**
 * LeadLagAgent — Phase 53.3
 *
 * Converts the Phase 52 LeadLagTracker measurements into a consensus signal.
 *
 * Premise: Binance is the price-discovery venue for crypto. Our Tokyo
 * placement and 4 days of measurement confirmed:
 *   SOL — median lead 167ms, p95 1454ms, 88% Binance leads
 *   ETH — median lead  91ms, p95  350ms, 83% Binance leads
 *   BTC — median lead  54ms, p95  359ms, 79% Binance leads
 *
 * Rather than just observing this, fold it into trade decisions:
 *   - On every analyze(), look at the last few seconds of lead-lag events
 *     for this symbol (pulled from LeadLagTracker via singleton).
 *   - If the dominant Binance-led direction in the recent window is
 *     consistent (e.g. last 3 of 4 events were Binance-led UP), emit a
 *     directional signal in that direction.
 *   - Confidence scales with: (a) how recent the most-recent event is
 *     (fresher = stronger), (b) the Binance-leads fraction (higher =
 *     stronger), (c) magnitude of the move in bps (bigger = stronger).
 *
 * This agent fires on every analyze() — no async REST calls — so it's
 * effectively instantaneous and adds zero latency.
 */

import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getLeadLagTracker, type LeadLagEvent } from "../services/LeadLagTracker";

const LOOKBACK_MS = 8_000;             // Consider events from last 8 seconds
const MIN_EVENTS = 2;                  // Need at least 2 events to call a direction
const DOMINANCE_THRESHOLD = 0.66;      // 2/3 of recent events must agree

export class LeadLagAgent extends AgentBase {
  private recentEvents: LeadLagEvent[] = [];
  private readonly MAX_RING = 200;

  constructor() {
    const config: AgentConfig = {
      name: 'LeadLagAgent',
      enabled: true,
      updateInterval: 1000, // not really used — agent reacts to events
      timeout: 5000,
      maxRetries: 3,
    };
    super(config);
  }

  protected async initialize(): Promise<void> {
    // Subscribe to the LeadLagTracker singleton's event stream.
    // The tracker is started in _core/index.ts boot sequence.
    const tracker = getLeadLagTracker();
    tracker.on('lead_lag_event', (evt: LeadLagEvent) => {
      this.recentEvents.push(evt);
      if (this.recentEvents.length > this.MAX_RING) this.recentEvents.shift();
    });
    console.log('[LeadLagAgent] subscribed to LeadLagTracker events');
  }

  protected async cleanup(): Promise<void> {
    this.recentEvents = [];
  }

  protected async periodicUpdate(): Promise<void> {
    // No periodic work — agent reacts on analyze() with whatever is in the ring
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = Date.now();
    const cutoff = startTime - LOOKBACK_MS;

    const recent = this.recentEvents.filter(e => e.symbol === symbol && e.resolvedAt >= cutoff);

    if (recent.length < MIN_EVENTS) {
      return this.neutralSignal(symbol, startTime, `Insufficient lead-lag events for ${symbol} (have ${recent.length}, need ${MIN_EVENTS})`);
    }

    // Tally direction within the window
    let upCount = 0, downCount = 0;
    let binanceLedCount = 0;
    let totalMoveBps = 0;
    let totalLeadMs = 0;
    for (const e of recent) {
      if (e.direction === 'up') upCount++;
      else if (e.direction === 'down') downCount++;
      if (e.leader === 'binance') binanceLedCount++;
      totalMoveBps += e.moveBps;
      totalLeadMs += Math.max(e.leadMs, 0); // ignore negative (Coinbase-led) for averaging
    }

    const dominantDirection = upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'tie';
    const dominantCount = Math.max(upCount, downCount);
    const dominanceRatio = dominantCount / recent.length;
    const binanceLeadFraction = binanceLedCount / recent.length;
    const avgMoveBps = totalMoveBps / recent.length;
    const avgLeadMs = totalLeadMs / Math.max(binanceLedCount, 1);

    if (dominantDirection === 'tie' || dominanceRatio < DOMINANCE_THRESHOLD) {
      return this.neutralSignal(symbol, startTime, `Lead-lag direction split: ${upCount}↑/${downCount}↓ (need ≥${DOMINANCE_THRESHOLD * 100}% one-side)`);
    }

    // Confidence: combine binance-leads fraction, dominance, and recency.
    // Most recent event freshness — the closer to "now", the higher the score.
    const mostRecent = recent.reduce((acc, e) => e.resolvedAt > acc ? e.resolvedAt : acc, 0);
    const ageMs = startTime - mostRecent;
    const recencyFactor = Math.max(0, 1 - ageMs / LOOKBACK_MS); // 1.0 just-now → 0.0 at lookback edge

    // Confidence formula: starts at 0.40, adds:
    //   + up to +0.20 from Binance-leads fraction (scales 0.50→1.00 → 0.0→+0.20)
    //   + up to +0.20 from dominance (scales DOMINANCE_THRESHOLD→1.00 → 0.0→+0.20)
    //   + up to +0.10 from recency
    const binanceLeadBoost = Math.max(0, binanceLeadFraction - 0.5) * 0.40; // ≤ 0.20
    const dominanceBoost = (dominanceRatio - DOMINANCE_THRESHOLD) / (1 - DOMINANCE_THRESHOLD) * 0.20;
    const confidence = Math.min(0.40 + binanceLeadBoost + dominanceBoost + recencyFactor * 0.10, 0.85);

    const signal = dominantDirection === 'up' ? 'bullish' : 'bearish';
    const reasoning =
      `Lead-lag: ${upCount}↑/${downCount}↓ in last ${LOOKBACK_MS}ms, ` +
      `Binance led ${(binanceLeadFraction * 100).toFixed(0)}% (avg lead ${avgLeadMs.toFixed(0)}ms), ` +
      `avg move ${avgMoveBps.toFixed(1)}bps`;

    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal,
      confidence,
      strength: dominanceRatio,
      reasoning,
      evidence: {
        eventCount: recent.length,
        upCount,
        downCount,
        binanceLeadFraction,
        dominanceRatio,
        avgMoveBps,
        avgLeadMs,
        recencyFactorMostRecentAgeMs: ageMs,
      },
      qualityScore: 0.75,
      processingTime: Date.now() - startTime,
      dataFreshness: ageMs,
      executionScore: Math.round(50 + recencyFactor * 40), // fresher = better timing
    };
  }

  private neutralSignal(symbol: string, startTime: number, reason: string): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      timestamp: Date.now(),
      signal: 'neutral',
      confidence: 0.5,
      strength: 0,
      reasoning: reason,
      evidence: { recentEventCount: this.recentEvents.length },
      qualityScore: 0.5,
      processingTime: Date.now() - startTime,
      dataFreshness: 0,
      executionScore: 0,
    };
  }
}
