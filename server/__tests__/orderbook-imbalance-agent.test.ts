/**
 * Phase 28 — OrderbookImbalanceAgent unit + integration tests.
 *
 * Locks the four pure helpers (top imbalance, depth ratio, persistence
 * confidence, score combination) plus the in-memory L2 book maintenance
 * (snapshot + update events) and the end-to-end signal emission.
 *
 * The audit on 2026-04-25 found the existing 13-agent stack reaching 65%
 * consensus on losing trades because no agent saw microstructure. These
 * tests guard the new microstructure agent's math so a future tweak can't
 * silently invert its signal.
 */

import { describe, it, expect } from "vitest";
import {
  OrderbookImbalanceAgent,
  computeTopOfBookImbalance,
  computeDepthRatio,
  combineImbalanceScores,
  computePersistenceConfidence,
} from "../agents/OrderbookImbalanceAgent";

describe("OrderbookImbalanceAgent — pure helpers", () => {
  describe("computeTopOfBookImbalance", () => {
    it("returns +1 when only bid side has volume at top", () => {
      // Single-side: bid 10 vs ask 0 → (10-0)/(10+0) = 1.0
      const out = computeTopOfBookImbalance([[100, 10]], [[101, 0.000001]]);
      expect(out).toBeCloseTo(0.99999, 4);
    });

    it("is positive (bullish) when top bid > top ask size", () => {
      const out = computeTopOfBookImbalance([[100, 8]], [[101, 2]]);
      // (8-2)/(8+2) = 0.6
      expect(out).toBeCloseTo(0.6, 6);
    });

    it("is negative (bearish) when top ask > top bid size", () => {
      const out = computeTopOfBookImbalance([[100, 2]], [[101, 8]]);
      expect(out).toBeCloseTo(-0.6, 6);
    });

    it("is zero (neutral) when sides match", () => {
      const out = computeTopOfBookImbalance([[100, 5]], [[101, 5]]);
      expect(out).toBe(0);
    });

    it("returns 0 on empty book (no signal)", () => {
      expect(computeTopOfBookImbalance([], [])).toBe(0);
      expect(computeTopOfBookImbalance([[100, 5]], [])).toBe(0);
      expect(computeTopOfBookImbalance([], [[101, 5]])).toBe(0);
    });
  });

  describe("computeDepthRatio", () => {
    // Mid = 100. ±5bp band = 99.95 .. 100.05.
    const bids = [
      [99.99, 3], // inside 5bp
      [99.95, 1], // edge of 5bp
      [99.80, 5], // inside 20bp (±0.20)
      [99.50, 9], // outside 20bp
    ] as Array<[number, number]>;
    const asks = [
      [100.01, 1],
      [100.05, 1],
      [100.20, 4],
      [100.50, 9],
    ] as Array<[number, number]>;

    it("computes correct bid/ask ratio at ±5bp band (bullish when bid heavy)", () => {
      // Bid in band: 3 + 1 = 4. Ask in band: 1 + 1 = 2. Ratio = 2.0.
      const ratio = computeDepthRatio(bids, asks, 100, 5);
      expect(ratio).toBeCloseTo(2.0, 6);
    });

    it("computes correct bid/ask ratio at ±20bp band", () => {
      // Bid: 3 + 1 + 5 = 9. Ask: 1 + 1 + 4 = 6. Ratio = 1.5.
      const ratio = computeDepthRatio(bids, asks, 100, 20);
      expect(ratio).toBeCloseTo(1.5, 6);
    });

    it("returns < 1 (bearish) when ask side dominates a band", () => {
      const heavyAskAsks = [
        [100.01, 9],
        [100.04, 6],
      ] as Array<[number, number]>;
      const lightBidBids = [[99.99, 1]] as Array<[number, number]>;
      const ratio = computeDepthRatio(lightBidBids, heavyAskAsks, 100, 5);
      expect(ratio).toBeLessThan(1);
    });

    it("returns 1.0 (neutral) for empty book / degenerate inputs", () => {
      expect(computeDepthRatio([], [], 100, 5)).toBe(1.0);
      expect(computeDepthRatio(bids, asks, 0, 5)).toBe(1.0);
      expect(computeDepthRatio(bids, asks, 100, 0)).toBe(1.0);
    });

    it("handles one-sided book without producing Infinity", () => {
      // Bid-only inside band → finite large ratio.
      const onlyBids = computeDepthRatio(
        [[99.99, 5]],
        [[100.50, 5]],
        100,
        5,
      );
      expect(Number.isFinite(onlyBids)).toBe(true);
      expect(onlyBids).toBeGreaterThan(1);

      // Ask-only inside band → finite small ratio.
      const onlyAsks = computeDepthRatio(
        [[99.50, 5]],
        [[100.01, 5]],
        100,
        5,
      );
      expect(Number.isFinite(onlyAsks)).toBe(true);
      expect(onlyAsks).toBeLessThan(1);
    });
  });

  describe("combineImbalanceScores", () => {
    it("zero inputs → zero combined score", () => {
      expect(combineImbalanceScores(0, 1.0, 1.0)).toBe(0);
    });

    it("known mix yields predicted weighted result", () => {
      // top = +0.6, depth5bp = 2.0 → ratioToSignal = (2-1)/(2+1) = 0.333...
      // depth20bp = 1.5 → ratioToSignal = 0.5/2.5 = 0.2
      // combined = 0.5 * 0.6 + 0.3 * 0.333 + 0.2 * 0.2 = 0.3 + 0.1 + 0.04 = 0.44
      const out = combineImbalanceScores(0.6, 2.0, 1.5);
      expect(out).toBeCloseTo(0.44, 2);
    });

    it("symmetric — bearish mirror of bullish", () => {
      const bull = combineImbalanceScores(0.5, 1.5, 1.2);
      const bear = combineImbalanceScores(-0.5, 1 / 1.5, 1 / 1.2);
      expect(bear).toBeCloseTo(-bull, 5);
    });

    it("clamps top imbalance to [-1, 1] range", () => {
      // If a malformed top of 5 leaks through, weighting must cap at 0.5.
      const out = combineImbalanceScores(5, 1.0, 1.0);
      expect(out).toBeCloseTo(0.5, 6);
    });

    it("non-finite ratios are treated as neutral, not NaN", () => {
      const out = combineImbalanceScores(0, Number.POSITIVE_INFINITY, NaN);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBe(0);
    });
  });

  describe("computePersistenceConfidence", () => {
    it("30/30 same-sign ticks → 0.9 (the cap)", () => {
      const history = Array.from({ length: 30 }, () => 1) as Array<-1 | 0 | 1>;
      expect(computePersistenceConfidence(history, 1)).toBeCloseTo(0.9, 6);
    });

    it("alternating signs → ~0.45 (half persistence)", () => {
      const history = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : -1)) as Array<-1 | 0 | 1>;
      const out = computePersistenceConfidence(history, 1);
      expect(out).toBeCloseTo(0.45, 2);
    });

    it("15/30 same-sign → 0.45", () => {
      const history: Array<-1 | 0 | 1> = [
        ...Array(15).fill(1),
        ...Array(15).fill(-1),
      ] as Array<-1 | 0 | 1>;
      expect(computePersistenceConfidence(history, 1)).toBeCloseTo(0.45, 2);
    });

    it("clamps to floor 0.1 on weak persistence", () => {
      const history: Array<-1 | 0 | 1> = Array(30).fill(-1);
      // Looking for matches for sign=+1 in a window of all -1: ratio = 0/30 = 0,
      // floored to 0.1.
      expect(computePersistenceConfidence(history, 1)).toBe(0.1);
    });

    it("currentSign === 0 (neutral) → 0.1 (no opinion → no confidence)", () => {
      const history: Array<-1 | 0 | 1> = Array(30).fill(0);
      expect(computePersistenceConfidence(history, 0)).toBe(0.1);
    });

    it("partial history normalizes against full window — no early inflation", () => {
      // 5 ticks of +1 → ratio 5/30 = 0.166, × 0.9 = 0.15. Below the 0.45 you'd
      // see if we naively normalized to history.length.
      const history: Array<-1 | 0 | 1> = Array(5).fill(1);
      const out = computePersistenceConfidence(history, 1);
      expect(out).toBeCloseTo(0.15, 2);
    });
  });
});

describe("OrderbookImbalanceAgent — book maintenance + signal emission", () => {
  it("snapshot replaces the in-memory book", () => {
    const agent = new OrderbookImbalanceAgent();
    agent.applySnapshot(
      "BTC-USD",
      [[100, 5], [99.5, 3]],
      [[101, 2], [101.5, 4]],
    );
    const snap = agent.getBookSnapshot("BTC-USD")!;
    expect(snap).not.toBeNull();
    expect(snap.bids[0]).toEqual([100, 5]);
    expect(snap.asks[0]).toEqual([101, 2]);
    expect(snap.bids).toHaveLength(2);
    expect(snap.asks).toHaveLength(2);
  });

  it("update modifies existing levels and removes when size=0", () => {
    const agent = new OrderbookImbalanceAgent();
    agent.applySnapshot(
      "BTC-USD",
      [[100, 5], [99.5, 3]],
      [[101, 2], [101.5, 4]],
    );

    // Modify top bid up to 7, remove the 99.5 level, add a 102 ask.
    agent.applyUpdate("BTC-USD", [
      ["buy", 100, 7],
      ["buy", 99.5, 0],
      ["sell", 102, 1.5],
    ]);

    const snap = agent.getBookSnapshot("BTC-USD")!;
    expect(snap.bids).toEqual([[100, 7]]);
    expect(snap.asks.find(([p]) => p === 102)).toEqual([102, 1.5]);
    expect(snap.asks.find(([p]) => p === 99.5)).toBeUndefined();
  });

  it("caps each side at 50 levels, keeping levels closest to mid", () => {
    const agent = new OrderbookImbalanceAgent();
    // 60 bid levels descending from 100 in 0.1 steps, 60 ask levels ascending.
    const bids: Array<[number, number]> = Array.from({ length: 60 }, (_, i) => [100 - i * 0.1, 1]);
    const asks: Array<[number, number]> = Array.from({ length: 60 }, (_, i) => [101 + i * 0.1, 1]);
    agent.applySnapshot("BTC-USD", bids, asks);

    const snap = agent.getBookSnapshot("BTC-USD")!;
    expect(snap.bids.length).toBeLessThanOrEqual(50);
    expect(snap.asks.length).toBeLessThanOrEqual(50);
    // Closest-to-mid retained: top bid is 100, top ask is 101.
    expect(snap.bids[0][0]).toBe(100);
    expect(snap.asks[0][0]).toBe(101);
    // Far-from-mid pruned: 100 - 5.0 = 95.0 should NOT appear.
    expect(snap.bids.find(([p]) => p < 100 - 50 * 0.1 + 1e-9)).toBeUndefined();
  });

  it("emits a bullish signal when bid pressure dominates across all bands", () => {
    const agent = new OrderbookImbalanceAgent();
    // Heavy bids near mid, thin asks. Mid = 100.005.
    agent.applySnapshot(
      "BTC-USD",
      [[100, 50], [99.99, 30], [99.95, 20], [99.80, 10]],
      [[100.01, 1], [100.05, 1], [100.20, 1], [100.50, 1]],
    );
    return agent.generateSignal("BTC-USD").then((signal) => {
      expect(signal.signal).toBe("bullish");
      expect(signal.confidence).toBeGreaterThanOrEqual(0.1);
      expect(signal.confidence).toBeLessThanOrEqual(0.9);
      expect(signal.evidence.combinedScore).toBeGreaterThan(0.15);
      expect(signal.evidence.topImbalance).toBeGreaterThan(0);
      expect(signal.reasoning).toMatch(/imbalance/i);
    });
  });

  it("emits a bearish signal when ask pressure dominates", () => {
    const agent = new OrderbookImbalanceAgent();
    agent.applySnapshot(
      "BTC-USD",
      [[100, 1], [99.99, 1], [99.95, 1], [99.80, 1]],
      [[100.01, 50], [100.05, 30], [100.20, 20], [100.50, 10]],
    );
    return agent.generateSignal("BTC-USD").then((signal) => {
      expect(signal.signal).toBe("bearish");
      expect(signal.evidence.combinedScore).toBeLessThan(-0.15);
      expect(signal.evidence.topImbalance).toBeLessThan(0);
    });
  });

  it("emits a neutral signal on a balanced book", () => {
    const agent = new OrderbookImbalanceAgent();
    agent.applySnapshot(
      "BTC-USD",
      [[100, 5], [99.99, 5]],
      [[100.01, 5], [100.05, 5]],
    );
    return agent.generateSignal("BTC-USD").then((signal) => {
      expect(signal.signal).toBe("neutral");
      // Neutral path → confidence floor.
      expect(signal.confidence).toBeCloseTo(0.1, 5);
    });
  });

  it("returns a neutral signal when no book data has arrived", () => {
    const agent = new OrderbookImbalanceAgent();
    return agent.generateSignal("BTC-USD").then((signal) => {
      expect(signal.signal).toBe("neutral");
      expect(signal.reasoning).toMatch(/no order book/i);
    });
  });

  it("integration: snapshot + repeated updates maintain a coherent book and emit consistent bullish signals", async () => {
    const agent = new OrderbookImbalanceAgent();

    // 1) Initial snapshot — slightly bid-heavy.
    agent.applySnapshot(
      "BTC-USD",
      [[100, 10], [99.99, 5]],
      [[100.01, 5], [100.05, 5]],
    );

    // 2) A burst of updates that pile bids near mid (mimics a short squeeze
    //    / institutional bid stacking).
    for (let i = 0; i < 5; i++) {
      agent.applyUpdate("BTC-USD", [
        ["buy", 100, 20 + i * 5],
        ["buy", 99.99, 15 + i * 3],
      ]);
      // Drive a few signal computations so persistence builds up.
      const sig = await agent.generateSignal("BTC-USD");
      expect(sig.signal).toBe("bullish");
    }

    const final = await agent.generateSignal("BTC-USD");
    expect(final.signal).toBe("bullish");
    // After 5+ matching ticks, persistence should have lifted confidence
    // off the 0.1 floor toward the cap.
    expect(final.confidence).toBeGreaterThan(0.1);
    expect(final.evidence.persistenceMatches).toBeGreaterThanOrEqual(5);
    expect(final.evidence.bookLevelsBids).toBeGreaterThanOrEqual(2);
  });
});
