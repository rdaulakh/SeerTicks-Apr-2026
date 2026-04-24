/**
 * Phase 9 — Manual-close API routed through ProfitLockGuard.
 *
 * Pre-Phase 9 the user-facing `closePosition` tRPC endpoint was structurally
 * broken:
 *
 *   EngineAdapter.closePosition
 *     → wallet = session.getWallet()           // returns a *data* interface
 *     → typeof wallet.closePosition === 'function' // ALWAYS false
 *     → this.emit('manual_close_requested', ...)   // NOBODY listens
 *     → return { success: true }                    // lies to the user
 *
 * So every "Close Position" button click returned success while the position
 * stayed open — a silent, dangerous functional failure (user opens a new
 * position thinking the old one is gone → over-allocates capital → engine
 * exceeds risk budget on real money). Not a security-bypass of the guard,
 * but a silent bug that erodes trust in the entire exit system.
 *
 * Phase 9 fixes the call path (execute via `tradingEngine.closePositionById`)
 * AND gates it through `ProfitLockGuard.shouldAllowClose` so the prime-
 * directive net-profit floor applies to user-initiated exits too. If you
 * truly need to force-close a loser, pass a `manual_override_...` reason
 * which matches the guard's bypass patterns by design.
 *
 * These tests verify:
 *   1. Manual close is ACTUALLY executed (not silently dropped)
 *   2. Guard is called before execution
 *   3. Losing manual closes are BLOCKED with a structured error
 *   4. Profitable manual closes are allowed via net_profit_ok
 *   5. Explicit `manual_override_` reasons bypass the guard
 *   6. Error codes are surfaceable to the API (structured, not stringly-typed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  setTradingConfig,
  PRODUCTION_CONFIG,
} from '../config/TradingConfig';

// Mock priceFeedService BEFORE importing UserTradingSession.
const priceByScopeAndSymbol = new Map<string, number>();
function setMockPrice(symbol: string, price: number) {
  priceByScopeAndSymbol.set(symbol, price);
}
function clearMockPrices() {
  priceByScopeAndSymbol.clear();
}

vi.mock('../services/priceFeedService', () => ({
  priceFeedService: {
    getLatestPrice: (symbol: string) => {
      const p = priceByScopeAndSymbol.get(symbol);
      return p !== undefined ? { price: p, timestamp: Date.now() } : null;
    },
  },
}));

// Import AFTER the mock is registered.
// eslint-disable-next-line import/first
import { UserTradingSession } from '../services/UserTradingSession';

/**
 * Minimal fake trading engine — just enough surface for requestManualClose.
 * Mirrors `ITradingEngine` for the methods the function uses:
 *   - getPositions()
 *   - closePositionById(positionId, currentPrice, strategy)
 */
class FakeEngine extends EventEmitter {
  positions: Array<{
    id: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
  }> = [];
  closeCalls: Array<{ positionId: string; price: number; strategy: string }> =
    [];
  nextCloseError: string | null = null;

  getPositions() {
    return this.positions;
  }
  async closePositionById(
    positionId: string,
    currentPrice: number,
    strategy: string,
  ) {
    if (this.nextCloseError) {
      const msg = this.nextCloseError;
      this.nextCloseError = null;
      throw new Error(msg);
    }
    this.closeCalls.push({ positionId, price: currentPrice, strategy });
    this.positions = this.positions.filter((p) => p.id !== positionId);
  }
  // UserTradingSession public getters touch these — stubs keep them happy.
  getWallet() {
    return { balance: 10_000 };
  }
  getTradeHistory() {
    return [];
  }
}

function makeSession(): { session: UserTradingSession; engine: FakeEngine } {
  // Construct a session, then stamp in our fake engine via property injection.
  // The class's constructor wires heavy dependencies (GlobalSymbolAnalyzer,
  // DecisionEvaluator, etc.) that we don't want to exercise. `requestManualClose`
  // only reads `this.tradingEngine.getPositions()` and
  // `this.tradingEngine.closePositionById()` — so we stub the minimum.
  const session = Object.create(
    UserTradingSession.prototype,
  ) as UserTradingSession;
  // EventEmitter state (parent class)
  EventEmitter.call(session as unknown as EventEmitter);
  const engine = new FakeEngine();
  // Use `any` to poke private fields — these are the only bits requestManualClose touches.
  (session as any).tradingEngine = engine;
  (session as any).userId = 1;
  (session as any).exitRetryCount = new Map<string, number>();
  (session as any).MAX_EXIT_RETRIES = 3;
  return { session, engine };
}

describe('Phase 9 — UserTradingSession.requestManualClose (guard-gated)', () => {
  beforeEach(() => {
    setTradingConfig({ ...PRODUCTION_CONFIG });
    clearMockPrices();
  });

  it('throws [SESSION_NOT_READY] when engine is not initialized', async () => {
    const session = Object.create(
      UserTradingSession.prototype,
    ) as UserTradingSession;
    EventEmitter.call(session as unknown as EventEmitter);
    (session as any).tradingEngine = null;
    (session as any).exitRetryCount = new Map();

    await expect(session.requestManualClose('pos-1')).rejects.toThrow(
      /\[SESSION_NOT_READY\]/,
    );
  });

  it('throws [POSITION_NOT_FOUND] when the id does not match any open position', async () => {
    const { session, engine } = makeSession();
    engine.positions = [];
    await expect(
      session.requestManualClose('does-not-exist'),
    ).rejects.toThrow(/\[POSITION_NOT_FOUND\]/);
  });

  it('throws [PRICE_UNAVAILABLE] when there is no live price', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'BTC-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    // No price registered → mock returns null.
    await expect(session.requestManualClose('p1')).rejects.toThrow(
      /\[PRICE_UNAVAILABLE\]/,
    );
  });

  it('BLOCKS losing manual close with [PROFIT_LOCK_BLOCKED] and does NOT call engine close', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'BTC-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    // Gross -0.5% → net = -0.75% → below 0.15% floor, above -1.2% catastrophic.
    setMockPrice('BTC-USD', 99.5);

    const err = await session
      .requestManualClose('p1', 'manual_close')
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/\[PROFIT_LOCK_BLOCKED\]/);
    // Structured metadata for the API layer to build a 4xx response.
    expect((err as any).code).toBe('PROFIT_LOCK_BLOCKED');
    expect((err as any).grossPnlPercent).toBeCloseTo(-0.5, 4);
    expect((err as any).netPnlPercent).toBeCloseTo(-0.75, 4);
    // CRITICAL: engine close was never attempted.
    expect(engine.closeCalls).toHaveLength(0);
    // Position remains open in the engine.
    expect(engine.positions.find((p) => p.id === 'p1')).toBeDefined();
  });

  it('ALLOWS profitable manual close via net_profit_ok and calls closePositionById', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'BTC-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    // Gross +0.5% → net +0.25% → above 0.15% floor.
    setMockPrice('BTC-USD', 100.5);

    const exitEmitted = new Promise<any>((resolve) => {
      (session as any).once('exit_executed', (e: any) => resolve(e));
    });

    const res = await session.requestManualClose('p1', 'manual_close');

    expect(res.success).toBe(true);
    expect(res.price).toBeCloseTo(100.5, 4);
    expect(res.symbol).toBe('BTC-USD');
    expect(res.guardReason).toMatch(/net_profit_ok/);
    expect(res.grossPnlPercent).toBeCloseTo(0.5, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.25, 4);

    // Engine actually executed.
    expect(engine.closeCalls).toHaveLength(1);
    expect(engine.closeCalls[0]).toEqual({
      positionId: 'p1',
      price: 100.5,
      strategy: 'manual:manual_close',
    });
    // Position removed from engine map.
    expect(engine.positions.find((p) => p.id === 'p1')).toBeUndefined();

    // exit_executed event fired for downstream listeners (WS, audit, etc.).
    const evt = await exitEmitted;
    expect(evt.positionId).toBe('p1');
    expect(evt.reason).toBe('manual:manual_close');
  });

  it('ALLOWS loser close when reason contains manual_override_ (catastrophic bypass)', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'ETH-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    // Gross -0.5%, net -0.75% — would be BLOCKED for 'manual_close'.
    setMockPrice('ETH-USD', 99.5);

    const res = await session.requestManualClose(
      'p1',
      'manual_override_admin_unwind',
    );

    expect(res.success).toBe(true);
    expect(res.guardReason).toMatch(/catastrophic_reason/);
    expect(res.grossPnlPercent).toBeCloseTo(-0.5, 4);
    expect(engine.closeCalls).toHaveLength(1);
    expect(engine.closeCalls[0].strategy).toBe(
      'manual:manual_override_admin_unwind',
    );
  });

  it('ALLOWS loser close at gross ≤ -1.2% via catastrophic_grossPnl (hard-stop floor)', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'BTC-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    // Gross -1.5% → below -1.2% catastrophic floor.
    setMockPrice('BTC-USD', 98.5);

    const res = await session.requestManualClose('p1', 'manual_close');
    expect(res.success).toBe(true);
    expect(res.guardReason).toMatch(/catastrophic_grossPnl/);
    expect(engine.closeCalls).toHaveLength(1);
  });

  it('throws [CLOSE_FAILED] and does NOT emit exit_executed when engine close errors', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      { id: 'p1', symbol: 'BTC-USD', side: 'long', entryPrice: 100, quantity: 1 },
    ];
    setMockPrice('BTC-USD', 100.5);
    engine.nextCloseError = 'exchange 502 bad gateway';

    let exitEmitted = false;
    (session as any).on('exit_executed', () => {
      exitEmitted = true;
    });

    await expect(session.requestManualClose('p1', 'manual_close')).rejects.toThrow(
      /\[CLOSE_FAILED\].*exchange 502 bad gateway/,
    );
    // Phantom-close prevention: no exit_executed event, position stays in engine map.
    expect(exitEmitted).toBe(false);
    expect(engine.positions.find((p) => p.id === 'p1')).toBeDefined();
  });

  it('works for SHORT positions — gross PnL sign is inverted correctly', async () => {
    const { session, engine } = makeSession();
    engine.positions = [
      {
        id: 's1',
        symbol: 'BTC-USD',
        side: 'short',
        entryPrice: 100,
        quantity: 1,
      },
    ];
    // Short at 100, price 99 → +1% gross on short; net +0.75% → above floor.
    setMockPrice('BTC-USD', 99);

    const res = await session.requestManualClose('s1', 'manual_close');
    expect(res.success).toBe(true);
    expect(res.grossPnlPercent).toBeCloseTo(1, 4);
    expect(res.netPnlPercent).toBeCloseTo(0.75, 4);
    expect(res.guardReason).toMatch(/net_profit_ok/);

    // And the inverse — short under water: price moves UP from entry → loss.
    engine.positions = [
      {
        id: 's2',
        symbol: 'BTC-USD',
        side: 'short',
        entryPrice: 100,
        quantity: 1,
      },
    ];
    setMockPrice('BTC-USD', 100.5); // gross -0.5% on short
    const err = await session
      .requestManualClose('s2', 'manual_close')
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/\[PROFIT_LOCK_BLOCKED\]/);
    expect((err as any).grossPnlPercent).toBeCloseTo(-0.5, 4);
  });
});
