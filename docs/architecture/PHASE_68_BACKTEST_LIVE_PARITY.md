# Phase 68 — Backtest = Live Parity

**Status:** Design + scaffolding. Multi-week to fully ship.

## Problem statement

Today the backtest engines (`server/backtest/*`) and the live engine
(`server/execution/RealTradingEngine.ts` + signal pipeline + IEM/PEM)
are two separate code paths that share **types** but not **logic**.
Consequences:

- Bugs that surface live (e.g. the May 7 cascade) cannot be reproduced
  by replaying historical data through the backtest.
- Strategy changes prove out in backtest but behave differently live
  because the actual decision/execution paths diverge.
- The backtest engine has its own R:R checks, sizing, exit logic — all
  drift over time relative to live without anyone noticing.
- Walk-forward optimization fits parameters to a model that doesn't
  match production, so optimal-in-backtest ≠ optimal-live.

## Target architecture

One **engine core** that takes a `Clock` and an `Exchange` interface.
- `Clock`: returns "now". Live = `Date.now()`. Backtest = the historical
  cursor advanced by tick.
- `Exchange`: the same `ExchangeInterface` we already have. Live = the
  real adapter (Binance Futures, Coinbase). Backtest = a deterministic
  in-memory book + fill simulator that uses the historical OHLCV.

Same `EngineCore` — same agents, same consensus, same `EnhancedTradeExecutor`,
same `RealTradingEngine.placeOrder`, same IEM/PEM, same SmartExecutor —
gets pointed at different `(Clock, Exchange)` pairs.

```
EngineCore(clock, exchange, db?)
  ├── AutomatedSignalProcessor (uses clock for timestamps)
  ├── EnhancedTradeExecutor (uses clock for cooldowns + daily reset)
  ├── RealTradingEngine (uses exchange.placeOrder/getPosition)
  └── IEM/PEM (uses clock for hold-time + exchange for order book)
```

A **backtest harness** then becomes:
1. Load historical ticks/candles for the window.
2. Construct a `MockExchange` that simulates fills from the next tick's
   OHLC at realistic slippage.
3. Construct a `MockClock` that the harness advances tick-by-tick.
4. Boot `EngineCore` with these.
5. Step the clock; engine runs identically to production.
6. Capture every trace event (Phase 67) and every decision row.

## Migration plan (high-level, 4-6 weeks)

| Week | Work |
|---|---|
| 1 | `Clock` interface; replace every `new Date()` and `Date.now()` in trading core with `clock.now()`. ~80 call sites. |
| 1 | `MockClock` + harness skeleton, can step through one symbol's history. |
| 2 | `MockExchange` implementing `ExchangeInterface` — fill from next tick's high/low with configurable slippage model. Handle `getPosition`, `placeMarketOrder`, `placeLimitOrder`, `getOrderBook`. |
| 2 | Backtest DB writer — replays into a separate `backtests.*` schema so live + backtest data don't mix. |
| 3 | Migrate `BacktestEngine.ts` to drive `EngineCore` instead of its own logic. Delete duplicated code. |
| 3 | Validate parity: run a known-good 1-day window through backtest, compare every order placed/filled and every position close to the matching live day's tradeDecisionLogs. Should match within rounding. |
| 4 | Walk-forward harness rebuilt on top of the new path. |
| 4 | Replay-from-incident: feed pm2 trace logs from a historical incident into the backtest harness; verify the bug reproduces. |
| 5-6 | Performance tuning. The Mock can run 1000× faster than real-time; engine code must not have wall-clock-bound waits or it stalls the backtest. Audit `setTimeout`, `setInterval`, `priceFeedService.on('price_update')` for clock-coupled behavior. |

## Scaffolding included today

- `server/_core/traceContext.ts` — already in place (Phase 67). Same trace
  events emit from backtest → can be diff'd against live.
- `ExchangeInterface` is already an abstraction — `MockExchange` just
  implements it.

## What's NOT in scope

- Replacing the two existing backtest engines (`InstitutionalBacktestEngine`,
  `APlusPlusBacktestEngine`) is week-3 work, not week-1. Their
  parameter-search loops can stay as a layer ON TOP of `EngineCore`.

## Verification gate

Phase 68 ships when: a 24-hour window of pm2 trace events from prod
plays through the backtest harness and produces an identical sequence
of `(symbol, side, quantity, decision, exit_reason)` rows. Diff = 0.
