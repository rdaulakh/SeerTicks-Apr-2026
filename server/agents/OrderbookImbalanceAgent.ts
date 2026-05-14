import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { agentLogger } from "../utils/logger";

/**
 * Phase 28 — OrderbookImbalanceAgent
 *
 * The 13-agent stack reaches 65% consensus on losing trades because it has
 * NO microstructure signal — agents see technicals, sentiment, regime, on-chain,
 * but the order book itself is invisible. This is the layer-2 microstructure
 * gap institutional HFT desks rely on to time entries.
 *
 * What this agent measures:
 *   1. Top-of-book imbalance: (bid_top - ask_top) / (bid_top + ask_top), [-1, 1]
 *   2. Depth ratio at ±5bp from mid: total bid vol / total ask vol within band
 *   3. Depth ratio at ±20bp from mid: same idea, wider band
 *   4. Persistence: rolling 30-tick history of imbalance signs → confidence
 *
 * Combined score = 0.5 × top + 0.3 × 5bp + 0.2 × 20bp.
 * Direction thresholds: > +0.15 bullish, < -0.15 bearish, else neutral.
 *
 * Confidence is persistence-weighted: matching signs / 30 × 0.9, clamped
 * [0.1, 0.9]. 30/30 same-sign = 0.9 conviction; alternating = 0.45.
 *
 * Data source: Coinbase Advanced Trade L2 (level2_batch channel) — already
 * subscribed by CoinbasePublicWebSocket which emits 'orderbook' events with
 * pre-sorted bids/asks arrays. We feed those into onOrderBook() and keep an
 * in-memory L2 book per symbol, capped at the top 50 levels per side.
 */

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing without touching network/state.
// ---------------------------------------------------------------------------

/**
 * Top-of-book imbalance: (bidSize_top - askSize_top) / (bidSize_top + askSize_top).
 * Returns 0 when either side is empty (no signal). Range [-1, 1].
 * Positive = bid pressure (bullish), negative = ask pressure (bearish).
 *
 * Phase 93.25 — MIN-NOTIONAL FILTER (data-driven, 2026-05-15).
 * Coinbase L2 batch updates can leave the best level briefly desynced
 * (e.g. bid_qty=1.0 contracts while ask_qty=0.001) which saturates this
 * ratio at ±1.0 from pure microstructure noise. Forensic audit attributed
 * -$14.84 of P&L bleed to this artifact. Require BOTH sides to carry
 * at least `minNotionalUsd` of resting depth before computing the ratio;
 * otherwise return 0 (no signal) and let the depth-band buckets dominate.
 */
const MIN_TOP_OF_BOOK_NOTIONAL_USD = 1000;
export function computeTopOfBookImbalance(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  minNotionalUsd: number = MIN_TOP_OF_BOOK_NOTIONAL_USD,
): number {
  if (bids.length === 0 || asks.length === 0) return 0;
  const bidPrice = bids[0][0];
  const bidSize = bids[0][1];
  const askPrice = asks[0][0];
  const askSize = asks[0][1];
  // L2-batch artifact guard: thin side → no usable top-of-book signal.
  if (bidPrice * bidSize < minNotionalUsd || askPrice * askSize < minNotionalUsd) {
    return 0;
  }
  const denom = bidSize + askSize;
  if (denom <= 0) return 0;
  return (bidSize - askSize) / denom;
}

/**
 * Depth ratio at ±bps from mid price: total bid volume / total ask volume
 * within `bpsRange` basis points of mid. Ratio > 1 = bullish (more buy depth),
 * < 1 = bearish. Returns 1.0 (neutral) on degenerate input rather than NaN/Infinity.
 *
 * Mid is computed from best bid/ask if not provided; we accept it as a param
 * to keep this helper pure and deterministic.
 */
export function computeDepthRatio(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  midPrice: number,
  bpsRange: number,
): number {
  if (!isFinite(midPrice) || midPrice <= 0 || bpsRange <= 0) return 1.0;
  const lowerBound = midPrice * (1 - bpsRange / 10_000);
  const upperBound = midPrice * (1 + bpsRange / 10_000);

  let bidVol = 0;
  for (const [price, size] of bids) {
    if (price >= lowerBound && price <= midPrice) bidVol += size;
  }

  let askVol = 0;
  for (const [price, size] of asks) {
    if (price >= midPrice && price <= upperBound) askVol += size;
  }

  // Both sides empty → no information → neutral.
  if (bidVol === 0 && askVol === 0) return 1.0;
  // One-sided: clamp to a large but finite signal so callers can still
  // mix it into the combined score without Infinity poisoning the math.
  if (askVol === 0) return 10.0;
  if (bidVol === 0) return 0.1;
  return bidVol / askVol;
}

/**
 * Combine the three imbalance components into a single [-1, +1] score.
 *
 * - `top` is already in [-1, 1] (top-of-book imbalance).
 * - `depth5bp` and `depth20bp` are ratios (1.0 = balanced). Convert each into
 *   a [-1, 1] signal via (r - 1) / (r + 1) which is symmetric around 1.0:
 *     ratio 2.0 → +0.333, ratio 0.5 → -0.333, ratio 1.0 → 0.0.
 *   This avoids unbounded values when one side is thin.
 *
 * Weights (Phase 93.25, 2026-05-15): 0.3 top + 0.3 depth5bp + 0.4 depth20bp.
 * Previous weights (0.5 / 0.3 / 0.2) let top-of-book L2 batch artifacts
 * dominate the score and bled -$14.84 of attributed P&L. Deeper buckets are
 * far more stable across batch boundaries and reveal genuine iceberg /
 * hidden absorption, so the weight is pushed outward. Top-of-book still
 * contributes (and the min-notional filter in computeTopOfBookImbalance
 * suppresses thin-side artifacts) but it no longer outweighs the depth
 * signal.
 */
export function combineImbalanceScores(
  top: number,
  depth5bp: number,
  depth20bp: number,
): number {
  const ratioToSignal = (r: number): number => {
    if (!isFinite(r) || r <= 0) return 0;
    return (r - 1) / (r + 1);
  };
  const sig5 = ratioToSignal(depth5bp);
  const sig20 = ratioToSignal(depth20bp);
  const clampedTop = Math.max(-1, Math.min(1, top));
  return 0.3 * clampedTop + 0.3 * sig5 + 0.4 * sig20;
}

/**
 * Persistence-weighted confidence: how many of the last 30 ticks had the
 * same imbalance sign as the current tick. Stable signals → high confidence;
 * choppy/alternating signals → low confidence.
 *
 * confidence = clamp(matching_ticks / window × 0.9, 0.1, 0.9)
 *
 * - 30/30 same sign        → 0.9 (cap)
 * - 15/30 same sign        → 0.45
 * -  3/30 same sign        → 0.1 (floor)
 * - currentSign === 0      → 0.1 (no opinion → no confidence)
 */
export function computePersistenceConfidence(
  history: Array<-1 | 0 | 1>,
  currentSign: -1 | 0 | 1,
): number {
  const WINDOW = 30;
  if (currentSign === 0) return 0.1;
  if (history.length === 0) return 0.1;

  const window = history.slice(-WINDOW);
  let matching = 0;
  for (const s of window) {
    if (s === currentSign) matching++;
  }
  // Normalize against the full WINDOW (not just history.length) so partial
  // history doesn't artificially inflate confidence on the first few ticks.
  const ratio = matching / WINDOW;
  return Math.max(0.1, Math.min(0.9, ratio * 0.9));
}

// ---------------------------------------------------------------------------
// Agent class
// ---------------------------------------------------------------------------

interface BookSide {
  // price string → size. Sparse storage so updates of size=0 are removals.
  // We use number-keyed maps because Coinbase L2 events are normalized into
  // numeric arrays before they reach this agent.
  levels: Map<number, number>;
}

interface OrderBook {
  bids: BookSide;
  asks: BookSide;
  lastUpdate: number;
}

const TOP_BAND_BPS = 5;
const WIDE_BAND_BPS = 20;
const PERSISTENCE_WINDOW = 30;
const MAX_BOOK_LEVELS = 50; // Cap each side at top 50 levels by mid-proximity.
const STALE_BOOK_MS = 5_000; // If no update in 5s, treat the book as stale.

const BULLISH_THRESHOLD = 0.15;
const BEARISH_THRESHOLD = -0.15;

export class OrderbookImbalanceAgent extends AgentBase {
  private books: Map<string, OrderBook> = new Map();
  private signHistory: Map<string, Array<-1 | 0 | 1>> = new Map();
  private readonly log = agentLogger.child({ agent: "OrderbookImbalanceAgent" });

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "OrderbookImbalanceAgent",
      enabled: true,
      updateInterval: 0, // Event-driven — fed by L2 stream via onOrderBook()
      timeout: 5_000,
      maxRetries: 1,
      ...config,
    });
  }

  protected async initialize(): Promise<void> {
    this.log.info("OrderbookImbalanceAgent initialized");
  }

  protected async cleanup(): Promise<void> {
    this.books.clear();
    this.signHistory.clear();
  }

  protected async periodicUpdate(): Promise<void> {
    // Not used — event-driven via onOrderBook().
  }

  /**
   * Apply a snapshot — replaces the book entirely. Called by upstream when
   * the L2 channel sends `type: 'snapshot'` (initial state or post-resync).
   *
   * Inputs are already-parsed numeric arrays (price, size) — the same shape
   * CoinbasePublicWebSocket emits via its `orderbook` event.
   */
  applySnapshot(
    symbol: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
  ): void {
    const book: OrderBook = {
      bids: { levels: new Map() },
      asks: { levels: new Map() },
      lastUpdate: getActiveClock().now(),
    };
    for (const [price, size] of bids) {
      if (size > 0) book.bids.levels.set(price, size);
    }
    for (const [price, size] of asks) {
      if (size > 0) book.asks.levels.set(price, size);
    }
    this.trimToTopLevels(book);
    this.books.set(symbol, book);
  }

  /**
   * Apply incremental L2 changes. Each change is [side, price, size] where
   * size === 0 means remove that level. Matches Coinbase's `l2update` shape
   * after numeric parsing.
   */
  applyUpdate(
    symbol: string,
    changes: Array<["buy" | "sell", number, number]>,
  ): void {
    let book = this.books.get(symbol);
    if (!book) {
      book = {
        bids: { levels: new Map() },
        asks: { levels: new Map() },
        lastUpdate: getActiveClock().now(),
      };
      this.books.set(symbol, book);
    }
    for (const [side, price, size] of changes) {
      const target = side === "buy" ? book.bids.levels : book.asks.levels;
      if (size === 0) {
        target.delete(price);
      } else {
        target.set(price, size);
      }
    }
    book.lastUpdate = getActiveClock().now();
    this.trimToTopLevels(book);
  }

  /**
   * Convenience entry point matching the CoinbasePublicWebSocket
   * `orderbook` event payload (pre-sorted bids / asks arrays). Treats every
   * call as a fresh snapshot — the upstream service maintains the
   * canonical book and re-emits on each change. This keeps the agent
   * decoupled from L2 protocol details.
   */
  onOrderBook(
    symbol: string,
    bids: Array<[number, number]>,
    asks: Array<[number, number]>,
  ): void {
    this.applySnapshot(symbol, bids, asks);
  }

  /**
   * Test/inspection hook — return the sorted top-N book for a symbol.
   * Bids descending by price, asks ascending. Used by tests to verify that
   * snapshot/update events produce the expected in-memory book state.
   */
  getBookSnapshot(symbol: string): {
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    lastUpdate: number;
  } | null {
    const book = this.books.get(symbol);
    if (!book) return null;
    const bids = Array.from(book.bids.levels.entries()).sort(
      (a, b) => b[0] - a[0],
    );
    const asks = Array.from(book.asks.levels.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    return { bids, asks, lastUpdate: book.lastUpdate };
  }

  protected async analyze(symbol: string, _context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();
    const book = this.books.get(symbol);

    if (!book) {
      return this.createNeutralSignal(
        symbol,
        "No order book data available yet",
      );
    }

    const dataFreshness = (getActiveClock().now() - book.lastUpdate) / 1000;
    if (dataFreshness * 1000 > STALE_BOOK_MS) {
      return this.createNeutralSignal(
        symbol,
        `Order book stale (${dataFreshness.toFixed(1)}s since last update)`,
      );
    }

    const sortedBids = Array.from(book.bids.levels.entries()).sort(
      (a, b) => b[0] - a[0],
    );
    const sortedAsks = Array.from(book.asks.levels.entries()).sort(
      (a, b) => a[0] - b[0],
    );

    if (sortedBids.length === 0 || sortedAsks.length === 0) {
      return this.createNeutralSignal(
        symbol,
        "One-sided order book — cannot compute imbalance",
      );
    }

    const bestBid = sortedBids[0][0];
    const bestAsk = sortedAsks[0][0];
    const midPrice = (bestBid + bestAsk) / 2;

    const top = computeTopOfBookImbalance(sortedBids, sortedAsks);
    const depth5bp = computeDepthRatio(sortedBids, sortedAsks, midPrice, TOP_BAND_BPS);
    const depth20bp = computeDepthRatio(sortedBids, sortedAsks, midPrice, WIDE_BAND_BPS);
    const combined = combineImbalanceScores(top, depth5bp, depth20bp);

    let signal: "bullish" | "bearish" | "neutral";
    let currentSign: -1 | 0 | 1;
    if (combined > BULLISH_THRESHOLD) {
      signal = "bullish";
      currentSign = 1;
    } else if (combined < BEARISH_THRESHOLD) {
      signal = "bearish";
      currentSign = -1;
    } else {
      signal = "neutral";
      currentSign = 0;
    }

    // Update sign history BEFORE computing confidence so the current tick
    // contributes to its own persistence count — a brand-new sign that
    // matches the prevailing trend should already register today.
    const history = this.signHistory.get(symbol) ?? [];
    history.push(currentSign);
    if (history.length > PERSISTENCE_WINDOW) {
      history.splice(0, history.length - PERSISTENCE_WINDOW);
    }
    this.signHistory.set(symbol, history);

    const confidence = computePersistenceConfidence(history, currentSign);
    const strength = Math.min(1, Math.abs(combined) / 0.5);

    const reasoning =
      `Top-of-book imbalance ${top.toFixed(3)}, ` +
      `±5bp depth ratio ${depth5bp.toFixed(2)}, ` +
      `±20bp depth ratio ${depth20bp.toFixed(2)} → combined ${combined.toFixed(3)}. ` +
      `Sign persistence ${history.filter((s) => s === currentSign).length}/${PERSISTENCE_WINDOW} ticks.`;

    // Execution score: tighter spreads + persistent imbalance = better timing.
    const spreadBps = midPrice > 0 ? ((bestAsk - bestBid) / midPrice) * 10_000 : 100;
    const spreadScore = Math.max(0, Math.min(50, 50 - spreadBps * 5));
    const persistenceScore = (confidence / 0.9) * 50;
    const executionScore = Math.round(spreadScore + persistenceScore);

    const processingTime = getActiveClock().now() - startTime;

    this.log.debug("Imbalance signal computed", {
      symbol,
      signal,
      combined: combined.toFixed(3),
      top: top.toFixed(3),
      depth5bp: depth5bp.toFixed(2),
      depth20bp: depth20bp.toFixed(2),
      confidence: confidence.toFixed(2),
      bookLevels: sortedBids.length + sortedAsks.length,
    });

    return {
      agentName: this.config.name,
      symbol,
      timestamp: getActiveClock().now(),
      signal,
      confidence,
      strength,
      executionScore,
      reasoning,
      evidence: {
        topImbalance: top,
        depthRatio5bp: depth5bp,
        depthRatio20bp: depth20bp,
        combinedScore: combined,
        midPrice,
        bestBid,
        bestAsk,
        spreadBps,
        bookLevelsBids: sortedBids.length,
        bookLevelsAsks: sortedAsks.length,
        persistenceWindow: PERSISTENCE_WINDOW,
        persistenceMatches: history.filter((s) => s === currentSign).length,
      },
      qualityScore: Math.min(
        1,
        (sortedBids.length + sortedAsks.length) / (MAX_BOOK_LEVELS * 2),
      ),
      processingTime,
      dataFreshness,
    };
  }

  /**
   * Trim each side to the top MAX_BOOK_LEVELS by proximity to mid.
   *
   * Without this, a long-running connection accumulates stale far-from-mid
   * levels indefinitely (some posted then never withdrawn). 50 levels per
   * side is plenty for ±20bp depth analysis on liquid pairs.
   */
  private trimToTopLevels(book: OrderBook): void {
    if (book.bids.levels.size > MAX_BOOK_LEVELS) {
      // Bids: keep highest prices (closest to mid from below).
      const sorted = Array.from(book.bids.levels.entries()).sort(
        (a, b) => b[0] - a[0],
      );
      book.bids.levels.clear();
      for (const [price, size] of sorted.slice(0, MAX_BOOK_LEVELS)) {
        book.bids.levels.set(price, size);
      }
    }
    if (book.asks.levels.size > MAX_BOOK_LEVELS) {
      // Asks: keep lowest prices (closest to mid from above).
      const sorted = Array.from(book.asks.levels.entries()).sort(
        (a, b) => a[0] - b[0],
      );
      book.asks.levels.clear();
      for (const [price, size] of sorted.slice(0, MAX_BOOK_LEVELS)) {
        book.asks.levels.set(price, size);
      }
    }
  }
}
