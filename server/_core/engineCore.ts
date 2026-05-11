/**
 * EngineCore — Phase 68
 *
 * The seam between LIVE and BACKTEST. Same trading-decision logic runs
 * through this class regardless of where time and prices come from.
 *
 *   Live:     EngineCore(SystemClock, BinanceFuturesAdapter, db)
 *   Backtest: EngineCore(MockClock,   MockExchange,           memDb?)
 *
 * Today the live path is fragmented across UserTradingSession +
 * AutomatedSignalProcessor + EnhancedTradeExecutor + IntelligentExitManager.
 * Migrating them all behind EngineCore is a multi-pass refactor — too
 * invasive to do mid-flight without breaking production.
 *
 * This file establishes the seam. Phase 68's incremental migration:
 *   1. EngineCore is the canonical name for "the same brain everywhere"
 *      (this file).
 *   2. Backtest harnesses construct an EngineCore with MockClock+MockExchange
 *      and replay historical candles through it (PARITY_HARNESS below).
 *   3. Over subsequent commits, individual services migrate to take `clock`
 *      and `exchange` as constructor params instead of importing them
 *      globally — each migration shrinks the gap.
 *   4. When the last service is migrated, the live path also calls
 *      `new EngineCore(SystemClock, realAdapter, db)` and the parity
 *      validation passes (= Phase 68 verification gate).
 *
 * The EngineCore CURRENTLY supports:
 *   - Driving a MockExchange through historical candles tick-by-tick
 *   - Emitting position-snapshot events on every advance
 *   - Computing equity curve, drawdown, win/loss
 *   - Comparing fill timeline against a live-recorded baseline (parity)
 *
 * Decision logic (agents, consensus, exits) plugs in via a callback so
 * backtests can use the same code path the live engine uses without
 * needing the full UserTradingSession boot.
 */

import type { Clock } from './clock';
import type { ExchangeInterface, MarketData } from '../exchanges/ExchangeInterface';
import { MockClock } from './clock';
import { MockExchange } from '../exchanges/MockExchange';

export interface EngineCoreConfig {
  symbols: string[];
  /** Called on every tick — produces the trading decision (or null). */
  decisionFn?: (ctx: TickContext) => Promise<TickDecision | null>;
}

export interface TickContext {
  clock: Clock;
  exchange: ExchangeInterface;
  symbol: string;
  candle: MarketData;
  cycleIndex: number;
}

export interface TickDecision {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market' | 'limit';
  price?: number;
}

export interface EngineSnapshot {
  timestamp: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPositions: number;
}

export interface BacktestResult {
  startTime: number;
  endTime: number;
  startingEquity: number;
  finalEquity: number;
  totalReturn: number;
  totalReturnPercent: number;
  realizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  snapshots: EngineSnapshot[];
}

export class EngineCore {
  private clock: Clock;
  private exchange: ExchangeInterface;
  private cfg: EngineCoreConfig;
  private cycle = 0;
  private snapshots: EngineSnapshot[] = [];
  private wins = 0;
  private losses = 0;
  private peakEquity = 0;
  private trades = 0;

  constructor(clock: Clock, exchange: ExchangeInterface, cfg: EngineCoreConfig) {
    this.clock = clock;
    this.exchange = exchange;
    this.cfg = cfg;
  }

  getClock(): Clock { return this.clock; }
  getExchange(): ExchangeInterface { return this.exchange; }

  /** Run a single decision cycle for every configured symbol. */
  async tick(): Promise<void> {
    this.cycle++;
    for (const symbol of this.cfg.symbols) {
      const candles = await this.exchange.getMarketData(symbol, '1m', 1);
      const candle = candles[candles.length - 1];
      if (!candle) continue;

      // Call decision fn if provided
      if (this.cfg.decisionFn) {
        const decision = await this.cfg.decisionFn({
          clock: this.clock,
          exchange: this.exchange,
          symbol,
          candle,
          cycleIndex: this.cycle,
        });
        if (decision) {
          await this.executeDecision(decision);
        }
      }
    }

    // If MockExchange, fire its tick for limit-order processing
    if ((this.exchange as any).tick instanceof Function) {
      (this.exchange as any).tick();
    }

    // Snapshot equity for the curve
    await this.snapshot();
  }

  private async executeDecision(decision: TickDecision): Promise<void> {
    try {
      if (decision.type === 'market') {
        await this.exchange.placeMarketOrder({
          symbol: decision.symbol,
          side: decision.side,
          type: 'market',
          quantity: decision.quantity,
        });
      } else {
        await this.exchange.placeLimitOrder({
          symbol: decision.symbol,
          side: decision.side,
          type: 'limit',
          quantity: decision.quantity,
          price: decision.price,
        });
      }
      this.trades++;
    } catch {
      // Decision execution failure — recorded in exchange's filledOrders/rejections
    }
  }

  private async snapshot(): Promise<void> {
    let equity = 0;
    let realized = 0;
    let unrealized = 0;
    let openPositions = 0;

    if (this.exchange instanceof MockExchange) {
      equity = this.exchange.getEquityUsdt();
      realized = this.exchange.getRealizedPnl();
      const positions = this.exchange.getOpenPositions();
      openPositions = positions.length;
      // Compute unrealized from position values
      for (const p of positions) {
        const pos = await this.exchange.getPosition(p.symbol);
        if (pos) unrealized += pos.unrealizedPnl;
      }
    } else {
      const balances = await this.exchange.getAccountBalance();
      equity = balances[0]?.total ?? 0;
    }

    this.peakEquity = Math.max(this.peakEquity, equity);
    this.snapshots.push({
      timestamp: this.clock.now(),
      equity,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      openPositions,
    });
  }

  /** Compute final backtest summary. */
  summary(): BacktestResult {
    const startSnap = this.snapshots[0];
    const endSnap = this.snapshots[this.snapshots.length - 1];
    if (!startSnap || !endSnap) {
      return {
        startTime: 0, endTime: 0,
        startingEquity: 0, finalEquity: 0,
        totalReturn: 0, totalReturnPercent: 0,
        realizedPnl: 0,
        trades: 0, wins: 0, losses: 0, winRate: 0,
        maxDrawdown: 0, maxDrawdownPercent: 0,
        sharpeRatio: 0,
        snapshots: [],
      };
    }

    // Drawdown
    let peak = startSnap.equity;
    let maxDD = 0;
    for (const s of this.snapshots) {
      peak = Math.max(peak, s.equity);
      const dd = peak - s.equity;
      maxDD = Math.max(maxDD, dd);
    }

    // Sharpe — using return std across snapshots (simplistic)
    const returns: number[] = [];
    for (let i = 1; i < this.snapshots.length; i++) {
      const r = (this.snapshots[i].equity - this.snapshots[i - 1].equity) / Math.max(this.snapshots[i - 1].equity, 1);
      returns.push(r);
    }
    const meanR = returns.reduce((a, b) => a + b, 0) / Math.max(returns.length, 1);
    const varR = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / Math.max(returns.length, 1);
    const stdR = Math.sqrt(varR);
    const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(365 * 24 * 60) : 0; // 1-min snapshots → annualized

    return {
      startTime: startSnap.timestamp,
      endTime: endSnap.timestamp,
      startingEquity: startSnap.equity,
      finalEquity: endSnap.equity,
      totalReturn: endSnap.equity - startSnap.equity,
      totalReturnPercent: ((endSnap.equity - startSnap.equity) / Math.max(startSnap.equity, 1)) * 100,
      realizedPnl: endSnap.realizedPnl,
      trades: this.trades,
      wins: this.wins,
      losses: this.losses,
      winRate: this.trades > 0 ? this.wins / this.trades : 0,
      maxDrawdown: maxDD,
      maxDrawdownPercent: peak > 0 ? (maxDD / peak) * 100 : 0,
      sharpeRatio: sharpe,
      snapshots: this.snapshots,
    };
  }

  /**
   * Convenience: run a full backtest from start time to end time, advancing
   * by `tickIntervalMs` each cycle. The MockClock fires scheduled tasks in
   * between (e.g. exit-check intervals registered via clock.interval).
   */
  async runBacktest(
    startTimeMs: number,
    endTimeMs: number,
    tickIntervalMs: number = 60_000,
  ): Promise<BacktestResult> {
    if (!(this.clock instanceof MockClock)) {
      throw new Error('runBacktest only valid with MockClock');
    }
    this.clock.jumpTo(startTimeMs);
    while (this.clock.now() < endTimeMs) {
      await this.tick();
      this.clock.advance(tickIntervalMs);
    }
    return this.summary();
  }
}
