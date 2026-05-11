# SEER — Agent Profiles & Root-Cause Audit
**Audit date:** 2026-05-11
**Total agents inspected:** 40 (`server/agents/*.ts`)
**Live evidence basis:** 30-minute window of `agentSignals` from Tokyo prod

This document is the canonical reference for every agent in the platform. For each one it answers:

1. **Purpose** — what market behavior does it detect?
2. **Data dependencies** — what does it need to function?
3. **Trigger condition** — what should make it speak?
4. **Neutral condition** — when is silence correct?
5. **Diagnosed root cause** of current live behavior (firing rate + bull/bear/neutral split)
6. **Honest verdict** — working, threshold-tight, data-starved, bug, etc.
7. **Recommendation** — `keep-as-is` / `retune-threshold` / `wire-missing-data` / `rewrite` / `retire`

**No agent is recommended for blind deletion.** The default disposition is "understand first."

---

## Executive summary

Of 33 emitting agents:

| Category | Count | Agents |
|---|---|---|
| **Working as designed** | 7 | PatternMatcher, OrderFlowAnalyst, OrderbookImbalanceAgent, SpotTakerFlowAgent, LiquidityVacuumAgent, WhaleTracker, WhaleWallAgent |
| **Scenario-rare (correct silence)** | 1 | StopHuntAgent (round-number stop hunts genuinely rare) |
| **Data-starved (one upstream fix resurrects them)** | 9 | PerpTakerFlowAgent, VWAPDivergenceAgent, TradeBurstAgent, TradeSizeOutlierAgent, CVDDivergenceAgent, PriceImpactAgent, CorrelationBreakAgent, LeadLagAgent, CrossExchangeSpreadAgent |
| **Threshold too tight for current vol** | 4 | PerpDepthImbalanceAgent, PerpSpotPremiumAgent, VelocityAgent, MultiTFConvergenceAgent, SpreadCompressionAgent |
| **Asymmetric/one-sided logic (real bug)** | 4 | TechnicalAnalyst (perma-bull), SentimentAnalyst (perma-bull), NewsSentinel (perma-bull), VolumeProfileAnalyzer (perma-bear from `currentPrice` ref bug) |
| **Code bug (mild-bias fix backfired)** | 1 | LiquidationHeatmap (perma-bear from L/S ratio always >1.0) |
| **Macro fail-closed too aggressive** | 1 | MacroAnalyst (every API failure → 0.95-confidence bear vote) |
| **Slow-cadence by design + data flaky** | 1 | OnChainAnalyst (15-min update interval + no Whale Alert key) |
| **Geo-blocked dependency** | 2 | OpenInterestDeltaAgent, FundingRateFlipAgent (both hit Binance Futures REST → 451 on Tokyo) |
| **Wrong scale / API design mismatch** | 1 | FundingRateAnalyst (0.1% threshold; BTC funding rarely > 0.01%) |
| **Helper, not an agent** | 1 | PatternDetection (library file — exclude from agent count) |
| **Unregistered / data missing** | 2 | ForexCorrelationAgent (no MetaAPI), OnChainFlowAnalyst (not in registry, BGeometrics no key) |
| **Special role** | 1 | DeterministicFallback (base library for slow-agent fallbacks — surfaces through Sentiment/News/Macro) |
| **Infrastructure** | 1 | AgentBase (abstract base class) |
| **Data providers (not agents)** | 2 | FreeOnChainDataProvider, DuneAnalyticsProvider |
| **Redundant** | 1 | MLPredictionAgent (overlapped by `TradeSuccessPredictor` ML gate) |

**The single highest-leverage fix:** the Phase 53.x Binance futures aggTrade boot wiring (`global.__binancePerpTakerFlow`, `__binanceFuturesBook`, `__binancePerpDepth5`) is not populating on Tokyo. **One wiring fix resurrects 6 of the 9 data-starved zombies.** SpotTakerFlowAgent works → proves the pattern is right → diff spot vs perp boot to find the gap.

---

# Group A — Fast / Technical / Microstructure Agents

### TechnicalAnalyst
**Purpose:** Classic multi-indicator price-action confluence (RSI, MACD, MA cross, Bollinger, SuperTrend, VWAP, volume) on 1h candles.
**Data dependencies:** `getCandleCache()` 1h candles (≥50), DB fallback `loadCandlesFromDatabase`, optional multi-timeframe (1d/4h/5m), Dune Analytics on-chain (5-min cached). No REST API.
**Trigger condition:** Net vote `> +0.10` (≥1 bullish indicator) → bullish; `< -0.10` (≥1 bearish) → bearish. Each of 7 indicators casts one vote.
**Neutral condition:** RSI 30–70 AND MACD flat AND inside BB AND no SuperTrend flip AND volume change in (−20%, +20%).
**Diagnosed root cause (live 349/0/292 — perma-bull):** Asymmetric OVEREXTENSION/OVERSOLD damping at lines 783–804. The "OVERSOLD → flip bearish to neutral" branch (RSI<35 AND price<BB.lower×1.02 AND vwapDev<−2%) fires more often than its symmetric counterpart, because in a recovering market VWAP is dragged down by the lower tail. Bear signals get reclassified to neutral; bull signals survive.
**Verdict:** Working as designed, but with asymmetric damping that biases it bullish on Tokyo's current regime.
**Recommendation:** **retune-threshold** — make oversold/overextended damping symmetric, OR drop the `price < BB.lower × 1.02` clause from the oversold branch so it matches the looser bullish gate.

### PatternMatcher ✓ working
**Purpose:** Detects 19 classical chart patterns across 1d/4h/5m/1m and cross-references against `winningPatterns` DB for historical win-rate boost.
**Data dependencies:** `getCandleCache` (1h+1m primary, 1d/4h/5m secondary), `winningPatterns` table via `getValidatedPatterns(0.50)`, `detectAllPatterns` from PatternDetection.ts.
**Trigger condition:** Any of 19 patterns detected on any TF. Bullish basket → bullish; bearish basket → bearish.
**Neutral condition:** Zero patterns detected (rare), OR candles<20 on primary TFs.
**Diagnosed root cause (live 335/304/0):** Actually deliberates well. `winningPatterns` table is empty → always hits the unvalidated-fallback path with 15% confidence discount.
**Verdict:** Working as designed (most reliable in the set).
**Recommendation:** **keep-as-is**. Phase 23 pattern-validation loop (populates `winningPatterns`) would unlock historicalBoost.

### PatternDetection — HELPER, NOT AGENT
**Purpose:** Pure helper library — 19 standalone pattern-detection functions.
**Diagnosed root cause:** It does not extend `AgentBase`, has no `analyze()`, no constructor. **It cannot emit signals.** Its output flows only through PatternMatcher.
**Verdict:** Misclassified as agent — it's a library.
**Recommendation:** **keep-as-is** — but remove from any "agent registry" / "agent count" telemetry. Belongs alongside `utils/`.

### OrderFlowAnalyst ✓ working
**Purpose:** L2 orderbook imbalance + whale (10× avg) order detection + iceberg refill detection + CVD; composite −100..+100 score gated at ±20.
**Data dependencies:** `getHotPath()` `TICK_PROCESSED` events carrying `data.orderBook`. No REST fallback.
**Trigger condition:** Composite score > +20 → bullish; < −20 → bearish.
**Neutral condition:** No orderbook in `latestOrderBook` cache, OR composite ∈ (−20, +20).
**Diagnosed root cause (live 120/143/376):** Deliberates well. 376 neutrals = ticks where HotPath didn't relay an orderbook (Coinbase tick events don't always include `data.orderBook`).
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is**. (Optional: investigate why ~60% of ticks lack orderbook on HotPath.)

### OrderbookImbalanceAgent ✓ working
**Purpose:** Top-of-book imbalance + ±5bp/±20bp depth ratios on Coinbase L2; persistence-weighted (30-tick window) confidence.
**Data dependencies:** Direct L2 feed via `applySnapshot`/`applyUpdate`/`onOrderBook` from `CoinbasePublicWebSocket`.
**Trigger condition:** `combined = 0.5×top + 0.3×depth5bp + 0.2×depth20bp` > +0.15 → bullish; < −0.15 → bearish.
**Neutral condition:** No book, stale (>5s), one-sided book, or `|combined| ≤ 0.15`.
**Diagnosed root cause (live 202/273/164):** Healthy. Best-behaved on Coinbase data. The 164 neutrals are honest mid-band readings.
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is**.

### PerpDepthImbalanceAgent
**Purpose:** Σbid_qty vs Σask_qty over Binance perp top-5 depth, smoothed over 30-sample ring (~3s); persistence-gated at 66%.
**Data dependencies:** `global.__binancePerpDepth5[BTCUSDT]` (Phase 53.8 Binance futures depth5@100ms WS).
**Trigger condition:** `|avgImbalance| ≥ 0.20` AND ≥66% of ring samples on same side AND ≥5 samples AND fresh (≤1500ms).
**Neutral condition:** Missing depth, age>1.5s, ring building, `|avg|<0.20`, OR persistence<66%.
**Diagnosed root cause (live 22/46/571 — 10% directional):** Real data flowing. BTC top-5 perp imbalance hovers ±5–15% normally; sustained 20% + 66% persistence is rare.
**Verdict:** Threshold too tight for normal vol regimes.
**Recommendation:** **retune-threshold** — drop THRESHOLD to 0.12, PERSISTENCE_F to 0.55, OR widen ring to 60 samples.

### PerpSpotPremiumAgent
**Purpose:** Detects perp-leads-spot via (perpMid − spotMid)/spotMid in bps vs rolling 60-sample median; arbitrage lag exploitation.
**Data dependencies:** `global.__binanceFuturesBook[BTCUSDT]` + `global.__binanceSpotBook[BTCUSDT]`. `premiumRings` Map (60 samples).
**Trigger condition:** `|premiumBps − median| ≥ 1.5 bps`. Direction = sign of delta.
**Neutral condition:** Book missing/stale, <10 samples, OR `|delta| < 1.5 bps`.
**Diagnosed root cause (live 3/0/636 ≈ 99% neutral):** Perp-vs-spot mid spread on BTC/ETH is typically <1 bp during quiet periods. The 1.5 bps bar rarely trips.
**Verdict:** Threshold too tight for normal markets; mostly fires during news spikes.
**Recommendation:** **retune-threshold** — drop `ENTRY_BPS_THRESHOLD` to 0.5 bps, OR run also on more volatile pairs (ETH/SOL).

### PerpTakerFlowAgent — DATA-STARVED ZOMBIE
**Purpose:** CVD on Binance perp aggTrades — sum of taker buy vs sell notional over last 10s; |imbalance|≥30% AND total≥$100K → directional.
**Data dependencies:** `global.__binancePerpTakerFlow[BTCUSDT]` ring (Phase 53.5 Binance futures aggTrade WS).
**Trigger condition:** Last 10s ≥$100K total AND `|imbalance| ≥ 0.30`.
**Neutral condition:** No ring, no recent fills, totalNotional<$100K, OR balanced.
**Diagnosed root cause (live 0/0/632 — 100% zombie):** `global.__binancePerpTakerFlow` not being populated. The Phase 53.5 boot wiring in `_core/index.ts` is not running, or symbol-mapping mismatch. **Critical evidence:** `SpotTakerFlowAgent` (which reads the analogous `__binanceSpotTakerFlow` populated by Phase 53.7) works fine. Same code pattern; only perp wiring is broken.
**Verdict:** Needs data source — Binance futures aggTrade WS feed not active for this symbol.
**Recommendation:** **wire-missing-data** — diff Phase 53.5 (perp) vs Phase 53.7 (spot) boot wiring; fix the perp side. **Once data flows, 4 zombies re-animate at once: PerpTakerFlow, VWAPDivergence, TradeBurst, TradeSizeOutlier.**

### SpotTakerFlowAgent ✓ working
**Purpose:** Same as PerpTakerFlowAgent but for Binance spot aggTrade ($250K floor, $5M saturation).
**Data dependencies:** `global.__binanceSpotTakerFlow[BTCUSDT]` (Phase 53.7).
**Diagnosed root cause (live 206/127/306):** Deliberates well. Spot wiring works.
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is** — use its working boot pattern to fix `__binancePerpTakerFlow`.

### VWAPDivergenceAgent — DATA-STARVED ZOMBIE
**Purpose:** Rolling 5-min volume-weighted avg price on perp aggTrades; mean-reversion signal when price diverges ≥1.5σ from VWAP.
**Data dependencies:** `global.__binancePerpTakerFlow[BTCUSDT]` (needs ≥50 fills) + `global.__binanceFuturesBook[BTCUSDT]` for mid.
**Trigger condition:** `|divergenceStds| ≥ 1.5`. Above VWAP → bearish (mean revert down); below → bullish.
**Neutral condition:** Missing globals, book stale, <50 fills in 5-min window, zero stdev, OR `|σ| < 1.5`.
**Diagnosed root cause (live 0/0/639):** Cascading dependency on `__binancePerpTakerFlow` (empty per PerpTakerFlowAgent diagnosis). `recent.length < MIN_FILLS` (50) returns neutral immediately.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data** (same fix as PerpTakerFlowAgent unblocks this).

### VelocityAgent
**Purpose:** Multi-timeframe price acceleration — short-window (3s) bps/s vs long-window (15s); signals when short rate ≥2× long AND same sign.
**Data dependencies:** `global.__binanceFuturesBook[BTCUSDT]` (perp mid sampled into own 30s ring).
**Trigger condition:** Short bps/s ≥0.5 AND `sign(short)===sign(long)` AND `|short|/|long| ≥ 2.0`.
**Neutral condition:** Stale book, <5 samples, sign mismatch, short rate <0.5 bps/s, OR ratio <2.0.
**Diagnosed root cause (live 4/3/632):** `__binanceFuturesBook` IS populated (the few signals confirm it). Floor of 0.5 bps/s + 2× ratio is too strict for current BTC vol — BTC moves <0.5 bps/s most of the time at 3s scale.
**Verdict:** Threshold too tight.
**Recommendation:** **retune-threshold** — drop `MIN_SHORT_BPS_PER_S` to 0.2, `ACCEL_RATIO` to 1.5, OR widen `SHORT_MS` to 5s.

### TradeBurstAgent — DATA-STARVED ZOMBIE
**Purpose:** Detects fill-frequency surges on Binance perp aggTrade (fills/s in 3s vs 60s baseline); direction from side imbalance.
**Data dependencies:** `global.__binancePerpTakerFlow[BTCUSDT]`.
**Diagnosed root cause (live 0/0/639):** Same as PerpTakerFlowAgent. Fails at `baselineFills.length < 30` check immediately.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data**.

### TradeSizeOutlierAgent — DATA-STARVED ZOMBIE
**Purpose:** Detects single perp fills ≥5× rolling median notional; side-aggregates outliers over 30s.
**Data dependencies:** `global.__binancePerpTakerFlow[BTCUSDT]`.
**Diagnosed root cause (live 0/0/639):** Same upstream failure. `recent.length < 20` → immediate neutral.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data**.

---

# Group B — Derivatives / Flow / Whale Agents

### CVDDivergenceAgent — DATA-STARVED ZOMBIE
**Purpose:** Wyckoff-style "speculation vs real demand" — detects when perp taker flow imbalance diverges from spot taker flow imbalance; fades the perp leg.
**Data dependencies:** `global.__binancePerpTakerFlow` AND `global.__binanceSpotTakerFlow` rings.
**Trigger condition:** Last 10s ≥$100K perp AND ≥$200K spot AND `|perp_imbalance − spot_imbalance| ≥ 0.40`.
**Neutral condition:** Either tape quiet, or aligned within 40%.
**Diagnosed root cause (live 0/0/632):** Line 117 `if (!perpRing || !spotRing)` → neutral. Same Phase 53.5 wiring gap.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data**, then retune $200K spot floor down to $50K.

### CorrelationBreakAgent — DATA-STARVED ZOMBIE
**Purpose:** Detects when BTC moves significantly but ETH/SOL haven't followed — emits catch-up signal on lagging asset.
**Data dependencies:** `global.__binanceFuturesBook[BTC/ETH/SOL USDT]`.
**Trigger condition:** Symbol ≠ BTC, 60s rings populated, `|btcMove| ≥ 8 bps`, lag ratio `(thisMove/btcMove) < 0.40`.
**Diagnosed root cause (live 0/0/632):** Three causes: `__binanceFuturesBook` likely not populated for all three symbols on Tokyo, OR Binance perp WS laggy (book freshness ≤1500ms gate), OR 8 bps BTC move floor too high for current low-vol regime.
**Verdict:** Threshold too tight + likely data dependency.
**Recommendation:** **retune-threshold** (drop `MIN_BTC_MOVE_BPS` to 4) + verify `__binanceFuturesBook` populated for BTC/ETH/SOL.

### CrossExchangeSpreadAgent — DATA-STARVED ZOMBIE
**Purpose:** Detects when Binance-spot and Coinbase mid prices diverge beyond their rolling median (arbs reconverge).
**Data dependencies:** `global.__binanceSpotBook[BINSYM]` AND `global.__coinbaseTopOfBook[SYMBOL]`.
**Trigger condition:** Both books fresh (<2000ms), ≥10 samples, `|delta_from_median| ≥ 2.0 bps` AND `|spreadBps| ≥ 1.5 bps`.
**Diagnosed root cause (live 0/0/632):** `if (!bin || !cb)` returns neutral if either book missing. `__binanceSpotBook` likely not populated on Tokyo OR `__coinbaseTopOfBook` keyed differently than passed symbol. Even with data, BTC/ETH actual cross-venue spread is ≤2 bps 99% of the time.
**Verdict:** Threshold too tight + possible missing data.
**Recommendation:** **wire-missing-data** first; retune `THRESHOLD` to 1.0 bps if data flows.

### ForexCorrelationAgent — UNREGISTERED
**Purpose:** Macro signals (DXY/Gold/EURUSD trends + risk-on/off) translated to crypto direction via inverse DXY correlation.
**Data dependencies:** `fetchCandles()` from `../metaapi` — requires MetaAPI account with DXY, XAUUSD, EURUSD subscriptions.
**Diagnosed root cause (not in live registry):** Not registered for Tokyo. MetaAPI is not wired. With all 3 returning `[]` (line 195 try/catch), trends all = 'neutral', dxyStrength ≈ 0, defaults to neutral.
**Verdict:** Needs data source. Built for an integration that isn't active.
**Recommendation:** **retire** (or wire-missing-data if MetaAPI subscription is in roadmap). Macro lives in MacroAnalyst already — duplicative.

### LeadLagAgent — DATA-STARVED ZOMBIE
**Purpose:** Translates `LeadLagTracker` Binance-leads-Coinbase events into a momentum signal — when 2+ recent lead-lag events agree on direction, signal that way.
**Data dependencies:** `getLeadLagTracker()` singleton subscribed to `'lead_lag_event'`.
**Trigger condition:** ≥2 events in last 8s, dominant direction ≥66% of events.
**Diagnosed root cause (live 0/0/632):** Either `LeadLagTracker` not started in `_core/index.ts` boot, OR started but emits no events because Binance feed isn't reaching it. `recentEvents.length === 0` → always neutral.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data** — verify `getLeadLagTracker()` is started + emitting. Check `recentEventCount` evidence in neutral output — if always 0, tracker is dead.

### LiquidationHeatmap — CODE BUG (perma-bear)
**Purpose:** Detects long/short-side liquidation cascades on Binance perp (fast path) and analyzes long/short ratio / OI extremes (slow path).
**Data dependencies:** Fast: `global.__lastLiquidations` (Phase 52 Binance forceOrder WS). Slow: `multiExchangeLiquidationService` (Bybit/OKX/Binance OI+LSR REST). Final fallback: `DeterministicFallback`.
**Trigger condition:** Fast path: ≥$500K cascade in 60s. Slow path: L/S ratio > 1.1 (bearish) or < 0.9 (bullish).
**Diagnosed root cause (live 0/103/33 — perma-bear):** The "no agent should be neutral" mitigation at lines 572–584 introduced a perma-bear bias. Retail long/short ratio is structurally >1.0 on Binance (longs always dominate retail positioning) → line 572 `if (ratio > 1.1) → bearish` fires every tick. The fast path never triggers because no cascades hit $500K. Phase-fix overshoot.
**Verdict:** Code bug — mild-bias mitigation caused perma-bear.
**Recommendation:** **rewrite** the mild-bias branch — either revert to neutral when ratio ∈ [0.9, 1.1] OR normalize against a 7-day rolling median (so "mild bias" means relative to recent history, not absolute >1.0).

### LiquidityVacuumAgent ✓ working
**Purpose:** Detects when top-5 perp book is thin on one side relative to its 30–60s baseline median — predicts amplified moves in the thin direction.
**Data dependencies:** `global.__binancePerpDepth5[BINSYM]`.
**Trigger condition:** Top-5 fresh, ≥15 samples both rings, one side ≤60% of median AND other side ≥85% of normal.
**Diagnosed root cause (live 38/47/554):** Working as designed. Most of the time book is within ±15% of median; ~13% of time one side genuinely thins out with other side normal. Balanced bull/bear split confirms no bias.
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is**.

### MultiTFConvergenceAgent
**Purpose:** Looks for directional agreement across 1s/5s/15s/60s price-change rates on perp mid; classifies accelerating-continuation, decelerating-fade, confirmed-mixed.
**Data dependencies:** `global.__binanceFuturesBook[BINSYM]` + internal price ring.
**Trigger condition:** ALL 4 windows same sign AND every window `|rate| ≥ 0.3 bps/s`.
**Diagnosed root cause (live 0/0/632):** The ALL-OR-NOTHING gate is brutal. In sideways markets the 60s window often hovers near 0, instantly failing. P(all 4 same sign) × P(all 4 above floor) very low in non-trending regimes.
**Verdict:** Threshold too tight — strict ALL-4-windows gate.
**Recommendation:** **retune-threshold** — relax to "≥3 of 4 windows agree" and drop floor to 0.15 bps/s for longer windows.

### OpenInterestDeltaAgent — GEO-BLOCKED
**Purpose:** Classifies OI-vs-Price quadrant over 5 min (fresh longs/shorts/short-cover/long-capitulation) for continuation signal.
**Data dependencies:** Polls `https://fapi.binance.com/fapi/v1/openInterest` every 60s.
**Diagnosed root cause (live 0/0/134):** Binance Futures REST is geo-blocked from Tokyo (LiquidationHeatmap logs this same 451 issue at line 386–391). Silent fail at line 120 `if (!r.ok) return`; history never grows past 1 sample → "Building OI history, have <N>, need 2+" → neutral.
**Verdict:** Needs data source — Binance Futures REST geo-blocked.
**Recommendation:** **wire-missing-data** — route through `multiExchangeLiquidationService` (use Bybit/OKX OI as fallback), or proxy Binance through non-blocked region.

### PriceImpactAgent — DATA-STARVED ZOMBIE
**Purpose:** Compares realized price impact per $1M taker flow in 10s window vs 60s baseline; when impact ≥2× baseline + directional imbalance, fires.
**Data dependencies:** `global.__binancePerpTakerFlow[BINSYM]` + `global.__binanceFuturesBook[BINSYM]`.
**Diagnosed root cause (live 0/0/632):** Same perp taker-flow dependency. Even with data, multi-conjunctive gate ($200K in 10s + 2× impact + 25% imbalance) is strict.
**Verdict:** Needs data source.
**Recommendation:** **wire-missing-data**. If data flows but still silent, retune `MIN_NOTIONAL` to $50K and `IMPACT_RATIO` to 1.5.

### SpreadCompressionAgent
**Purpose:** Detects when perp bid-ask spread compresses to ≤60% of rolling median (leading indicator of pending move); direction from depth5 imbalance.
**Data dependencies:** `global.__binanceFuturesBook[BINSYM]` + `global.__binancePerpDepth5[BINSYM]`.
**Diagnosed root cause (live 0/0/632):** `MIN_BASELINE_BPS = 0.30` is a killer for BTC/ETH perp — typical spread is 0.1–0.2 bps. Line 128 returns neutral every tick because "Baseline already tight". Phase fix that meant to filter noise → muted the agent on the most liquid pairs (the ones it's supposed to monitor).
**Verdict:** Threshold too tight.
**Recommendation:** **retune-threshold** — drop `MIN_BASELINE_BPS` to 0.10 bps, OR replace with relative compression test (z-score of spread).

### StopHuntAgent ✓ scenario-rare (working)
**Purpose:** Detects price spike through a round number (e.g., $80K BTC) followed by reversal back through it — fires opposite the spike (manipulator's intent).
**Data dependencies:** `global.__binanceFuturesBook[BINSYM].midPrice` + internal price ring.
**Trigger condition:** Extreme within 5 bps of round level → reverses ≥5 bps past it → within 30s. 60s per-level cooldown.
**Diagnosed root cause (live 0/0/632):** Round-number stop hunts ARE rare. The gate is fundamentally narrow by design — extreme must pierce a round by 0–5 bps THEN reverse ≥5 bps past it THEN spike size ≥8 bps. In 30 min you may see zero such events. **Correct scenario-rare behavior.**
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is** — but verify `__binanceFuturesBook` is populated so it CAN fire when the scenario occurs.

### WhaleTracker ✓ working — GOLD STANDARD
**Purpose:** Combines on-chain whale-transfer flow (exchange in/out) + iceberg-order detection on live book.
**Data dependencies:** `getAggregatedWhaleData()` (Whale Alert + multi-source), `context.recentTrades`, `context.orderBookData`. Volume fallback when whale data dry.
**Diagnosed root cause (live 69/59/69):** Working well. The ~50/50 bull/bear split with similar neutral count is the signature of a well-calibrated multi-source signal.
**Verdict:** Working as designed — gold standard to compare other agents against.
**Recommendation:** **keep-as-is**.

### WhaleWallAgent ✓ working
**Purpose:** Detects single oversized quote levels in perp top-5 book (3× median) — bullish on bid walls, bearish on ask walls.
**Data dependencies:** `global.__binancePerpDepth5[BINSYM]`.
**Diagnosed root cause (live 6/5/628):** Working as designed but at low end of useful. The 3.0× threshold on top-5 only is genuinely rare. 6/5 balance shows no bias.
**Verdict:** Working as designed; could be retuned for more sensitivity.
**Recommendation:** **retune-threshold** (optional) — drop `WALL_THRESHOLD` to 2.2 and use top-10 if available; OR **keep-as-is** as a "rare-but-high-conviction" complement to WhaleTracker's iceberg detection.

---

# Group C — Slow / Macro / Sentiment / ML Agents

### SentimentAnalyst
**Purpose:** Crowd sentiment (LLM web search of Twitter/Reddit + Alternative.me Fear & Greed) → contrarian signal only at statistical extremes (Z-Score > 1.5σ).
**Data dependencies:** `api.alternative.me/fng/?limit=30` (free); OpenAI LLM via `callLLM()`; `ZScoreSentimentModel`; `fallbackManager.getSentimentFallback()`.
**Trigger condition:** Z-Score confidence ≥ 0.10 with `|Z| > 1.5σ` → bullish on extreme fear, bearish on extreme greed.
**Neutral condition:** F&G in normal 35–65 band; contrarian framing expects 50–70% neutrals.
**Diagnosed root cause (live 104/0/41 — perma-bull):** Deterministic-fallback path fires every cycle. When `zScoreResult.confidence < 0.10` (F&G history failed to load OR LLM social call returned 0), routes through `SentimentDeterministicFallback`. That fallback **only emits bullish** for F&G ≤ 35. Live F&G has been <35 for weeks → every fallback call returns bullish.
**Verdict:** Asymmetric / one-sided logic — fallback dominates because Z-Score gating is too strict.
**Recommendation:** **retune-threshold** — lower Z-Score floor from 1.5 to 1.0 once F&G history is loaded; widen fallback neutral band so 35–65 returns neutral not bullish.

### NewsSentinel
**Purpose:** Aggregates real news headlines, scores impact (source tier × recency × category), emits direction when weighted sentiment > 0.10.
**Data dependencies:** CoinGecko news (free, 429-prone), RSS feeds (CoinDesk, CoinTelegraph, The Block, Decrypt — no key), CryptoPanic free, OpenAI LLM enhancement, `fallbackManager.getNewsFallback()`.
**Trigger condition:** `normalizedSentiment > 0.10` → bullish; `< -0.10` → bearish.
**Diagnosed root cause (live 83/0/61 — perma-bull):** Keyword-list asymmetry. Positive list has 23 keywords ("gain", "rise", "growth", "buy", "support"); negative list pruned to 9 strong-negative ("crash", "plunge", "hack", "ban"). The fix to reduce "96.9% bearish bias" overshot — most crypto headlines contain a mild-positive keyword and zero strong-negatives → almost always trips +0.10 bullish threshold.
**Verdict:** Asymmetric / one-sided logic — over-correction.
**Recommendation:** **rewrite-bipolar** — rebalance keyword weights; restore "regulation", "warning", "lawsuit", "decline", "sell-off" to moderate-negative list.

### MacroAnalyst — FAIL-CLOSED TOO AGGRESSIVE
**Purpose:** DXY/VIX/S&P/BTC-dominance/stablecoin-supply/Dune on-chain → risk-on/off regime + veto authority for Fed/FOMC events.
**Data dependencies:** Local 90d BTCUSDT 1d candles, yfinance (S&P/Gold/DXY), `^VIX` via `callDataApi`, CoinGecko `/api/v3/global` (BTC dominance, stablecoin %), `DuneAnalyticsProvider`, `NewsSentinel.hasFedAnnouncement()`, `fallbackManager.getMacroFallback()` + fail-closed path (lines 216–220).
**Trigger condition:** `detectMarketRegime` returns risk-on/off when `|normalizedScore| > 0.2`.
**Diagnosed root cause (live 0/140/3 — perma-bear):** Macro fail-closed path. When `fetchMacroIndicators()` throws (yfinance child_process failure, VIX 429, CoinGecko 429), `macroFailClosed` default is true → returns `MacroDeterministicFallback` with `vetoActive=true` AND `calculateSignalFromMacro` short-circuits to **signal=bearish, confidence=0.95, strength=1.0**. Every failure = bearish vote with maximal weight.
**Verdict:** Working as designed — but the design (fail-closed → forced bearish veto) is too aggressive given data-source flakiness.
**Recommendation:** **retune-threshold** — set `TradingConfig.macro.failClosed=false` OR change fail-closed to emit `neutral + vetoActive=true` rather than `bearish + 0.95-confidence`. Also fix yfinance child_process reliability.

### OnChainAnalyst
**Purpose:** Whale Alert transactions + exchange in/outflow + miner behavior + stablecoin flow + SOPR/MVRV/NVT zones → single on-chain signal.
**Data dependencies:** `WHALE_ALERT_API_KEY` (Whale Alert paid), `FreeOnChainDataProvider` (mempool.space + blockchain.info + CoinGecko free), `ExternalAPIRateLimiter`.
**Trigger condition:** `(bullCount − bearCount)/6 > 0.2` (bullish) or `< -0.2` (bearish) across 6 sub-signals.
**Diagnosed root cause (live 0/0/15 — near-silent):** Rate-limits self at `updateInterval: 900_000` (15 min) + `CACHE_TTL: 900_000`. Cannot emit faster than 15 min. Without `WHALE_ALERT_API_KEY` falls into free-data path; mempool fee heuristics (`avgFeeRate > 50 → -1`) almost always return 0 because real mempool fees rarely cross 50 sat/vB. Stablecoin flow hardcoded to 0. Result: all 15 outputs are neutral.
**Verdict:** Genuinely useful in scenario X (with Whale Alert key + extreme valuation zones) — currently silent.
**Recommendation:** **wire-missing-data** — set `WHALE_ALERT_API_KEY`, replace mempool fee heuristic with real exchange-balance API, lower `updateInterval` to 5 min.

### OnChainFlowAnalyst — UNREGISTERED
**Purpose:** Phase 2 institutional-grade signal — BGeometrics MVRV/SOPR/NUPL (60% weight) + multi-source exchange-flow (40%).
**Data dependencies:** `BGeometricsService` (requires API key), `getAggregatedOnChainData`, `FreeOnChainDataProvider` fallback.
**Diagnosed root cause:** Not registered for live use. Singleton exported but not in `index.ts` registry. Even if running, BGeometrics has no key → collapses to flow-only → tends neutral.
**Verdict:** Genuinely useful if BGeometrics wired — currently redundant with OnChainAnalyst.
**Recommendation:** **retire** (consolidate into OnChainAnalyst) OR wire BGeometrics key + register.

### FundingRateAnalyst — WRONG SCALE
**Purpose:** Reads perpetual funding rates (Bybit/OKX/Binance aggregated) → contrarian signal (extreme positive = overleveraged longs → bearish).
**Data dependencies:** `multiExchangeFundingService.getAggregatedFundingRate()`, `https://fapi.binance.com/fapi/v1/premiumIndex` (geo-blocked), `historicalRates` 50-sample cache, `generateFundingFallback()`.
**Trigger condition:** `avgRate ≥ 0.001` (0.1%) → strong bearish; `≥ 0.0003` (0.03%) → mild bearish; mirrored negative → bullish.
**Diagnosed root cause (live 0/0/135):** Two layers of failure: (1) Binance geo-blocked + multi-exchange service falling into momentum fallback that stays neutral when bullish/bearish scores equal. (2) Even with data, real BTC funding sits 0.005–0.01% (i.e. 0.00005–0.0001 — **an order of magnitude below the 0.0003 mild threshold**). The "extreme positive/negative" branch never fires.
**Verdict:** Threshold too tight — institutional 0.1%/0.03% thresholds were designed for altcoin perps but BTC funding rarely exceeds 0.01%.
**Recommendation:** **retune-threshold** — drop extreme from 0.001 to 0.0002, mild from 0.0003 to 0.00005; OR rely entirely on z-score deviation from historical mean.

### FundingRateFlipAgent
**Purpose:** Detects discrete sign-change events in Binance USDT-M funding (positive→negative or vice versa) within 30-min lookback — distinct from FundingRateAnalyst which classifies static levels.
**Data dependencies:** `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT` polled every 60s into 80-sample history buffer.
**Trigger condition:** Sample in last 30 min has opposite sign from current AND `|current rate| ≥ 0.00005`.
**Diagnosed root cause (live 0/0/135):** Three compounding reasons: (1) Binance Futures geo-blocked → polling silently fails, buffer never populates beyond initial samples. (2) BTC funding rates **rarely flip sign** in normal markets — they sit positive (0.005–0.01%) for days/weeks. Sign flips happen maybe a few times per month. (3) `MIN_RATE_FOR_SIGNAL = 0.00005` noise filter further suppresses flips near zero.
**Verdict:** Working as designed — rare-event tagger. But Binance geo-block leaves it offline.
**Recommendation:** **wire-missing-data** — switch from Binance to Bybit/OKX premiumIndex via `multiExchangeFundingService`.

### VolumeProfileAnalyzer — CODE BUG
**Purpose:** Builds VWAP±σ bands, POC, Value Area (VAH/VAL), HVN/LVN from 1h candles; mean-reversion signals — bearish when price ≥ +2σ, bullish when ≤ −2σ.
**Data dependencies:** `WebSocketCandleCache.getCandles(symbol, '1h', 200)` → DB fallback. No external API.
**Trigger condition:** `combinedScore = bandSignal*0.4 + vaSignal*0.3 + deltaSignal*0.3` > 0.1 → bullish; < −0.1 → bearish.
**Diagnosed root cause (live 0/136/0 — perma-bear, ZERO neutrals):** **Real defect.** `analyzeValueArea` (lines 540–557) compares `analysis.vwapBands.vwap` (a single number) to VAH/VAL — NOT the current market price. In a rising market, VWAP (cumulative 24h volume-weighted) lags behind the most-traded zone and typically sits **above VAH** → returns `vaSignal = -0.5` (bearish) every cycle. The signal generator at line 430 uses `currentPrice = analysis.vwapBands.vwap` instead of `candles[last].close` → entire downstream framing treats VWAP as price → always reads "above VA" in uptrends → vaSignal = -0.5 → combinedScore ≤ -0.1 → bearish. Zero neutrals because the math is deterministic given an uptrend.
**Verdict:** **Code bug** — wrong `currentPrice` reference.
**Recommendation:** **rewrite** — fix `currentPrice` at line 430 to use `candles[candles.length-1].close`; `analyzeValueArea` should compare actual price to VAH/VAL.

### MLPredictionAgent — REDUNDANT
**Purpose:** Wraps `EnsemblePredictor` (LSTM + Transformer in TypeScript) for directional NN price forecasts; runs as a consensus voter.
**Data dependencies:** `EnsemblePredictor.predict(candleBuffer)` with `REQUIRED_CANDLES=30`; `candleBuffers` Map populated from `context.ohlcv`.
**Diagnosed root cause:** Not appearing in `agentSignals`. Either unregistered for this user, OR running but `candleBuffer.length < 30` (no `context.ohlcv` ever passed from signal pipeline). `userId=1` hardcoded at line 97 may not match live user. TradingConfig references `TradeSuccessPredictor` as the canonical ML quality-gate; this duplicate ensemble agent adds complexity without value.
**Verdict:** Genuinely useful in scenario X — but currently dormant/redundant.
**Recommendation:** **retire** (the per-trade `TradeSuccessPredictor` ML gate is the canonical ML path per CLAUDE.md).

### DeterministicFallback — LIBRARY
**Purpose:** Rule-based fallback module: `SentimentDeterministicFallback`, `NewsDeterministicFallback`, `MacroDeterministicFallback`. Pure math, no LLM, no APIs. Invoked when slow-agent data sources fail. NOT a voting agent.
**Data dependencies:** None external; consumes `MarketDataInput` from caller.
**Diagnosed root cause:** Not a direct emitter. Its outputs surface through host agents. But its `SentimentDeterministicFallback` (lines 85–175) is asymmetric for current market: F&G ≤ 35 → bullish, ≥ 65 → bearish; real BTC F&G has been < 50 for weeks → bullish dominates every call. Module is correct in isolation; callers' overreliance on it is what surfaces as perma-bull.
**Verdict:** Working as designed — base library.
**Recommendation:** **keep-as-is** — but callers (SentimentAnalyst) need to gate it differently.

### AgentBase — INFRASTRUCTURE
**Purpose:** Abstract base class — standardized `AgentSignal` interface, health metrics, signal-history ring (100), LLM circuit-breaker wrapper, DB persistence, lifecycle.
**Data dependencies:** `invokeLLM` from `_core/llm`, `getDb()` Drizzle, `agentSignals` table, `LLMCircuitBreaker`, `CrossCycleMemory` (optional).
**Diagnosed root cause:** Clean. Two relevant patterns: (1) `createNeutralSignal()` returns `confidence: 0, strength: 0` — and **every error in `generateSignal()` falls through to this** (lines 243–249). Errored signals DO get into consensus with confidence=0 (not dropped) — consistent with "OnChainAnalyst 15 signals all neutral". (2) Neutral outputs ARE persisted (no dead-letter filter), so live counts include legitimate neutral votes from agents that ran fine but had no opinion. This is why VolumeProfileAnalyzer's `0 neutral / 136 bearish` is anomalous — a healthy agent should produce SOME neutrals.
**Verdict:** Working as designed.
**Recommendation:** **keep-as-is**.

### FreeOnChainDataProvider — DATA PROVIDER
**Purpose:** Free, no-API-key data layer providing approximated SOPR/MVRV/NVT, hashrate trend, mempool-based exchange-flow proxies, whale-tx parsing. Used as fallback by OnChainAnalyst, OnChainFlowAnalyst, DuneAnalyticsProvider.
**Data dependencies:** `mempool.space` (hashrate, blocks, mempool, fees), CoinGecko (market data, 200-day prices, stablecoin category), via `rateLimitedFetch` + `retryWithBackoff`.
**Diagnosed root cause:** Upstream root cause for OnChainAnalyst's silence. Failure modes are all neutral-by-default (no Math.random — Phase 1 fixed that). CoinGecko free tier 429s aggressively; `getPriceHistory` defaults to synthetic `Math.sin` curve on failure → sopr/mvrv hover at 1.0/2.0 → `valuationZone='neutral'`. Mempool fee proxy uses `avgFeeRate > 50` threshold but real rates are 5–20 sat/vB → netFlow = 0 almost always.
**Verdict:** Working as designed — correctly conservative. But defaults are so aggressive-neutral that consumers receive zero signal.
**Recommendation:** **keep-as-is** (provider is fine; consumers need to handle the "all neutral" output rather than treating it as a real bear/bull signal).

### DuneAnalyticsProvider — DATA PROVIDER
**Purpose:** Optional paid Dune Analytics integration providing real exchange netflow, whale movements via 5 hardcoded query IDs.
**Data dependencies:** `process.env.DUNE_API_KEY` (paid), 5 Dune query IDs at lines 78–87, `FreeOnChainDataProvider` fallback.
**Diagnosed root cause:** If `DUNE_API_KEY` unset, `isConfigured()=false` and `MacroAnalyst` skips it. When set but query 4xx/5xx, errors cache for 30 min (silent). When falling back to free-data, collapses to single mempool data point → `totalNetFlow24h/7d` tiny → `netScore < 3` → neutral. Net effect: provides no actionable signal in current config.
**Verdict:** Genuinely useful with paid Dune + live queries — currently dead-or-neutral.
**Recommendation:** **retire** (unless paid Dune key acquired) OR **wire-missing-data**. Current cost is unjustified vs FreeOnChainDataProvider direct integration.

---

# Cross-cutting findings

## 1. The boot-wiring bombshell — one fix resurrects 6 agents

**6 agents share one root cause:** the global state for Binance futures data is not being populated on Tokyo.

```
global.__binancePerpTakerFlow[BTCUSDT]   ← missing (Phase 53.5)
global.__binanceFuturesBook[BTCUSDT]     ← missing or partial
global.__binancePerpDepth5[BTCUSDT]      ← partial
```

**Affected (perp-flow):** PerpTakerFlowAgent, VWAPDivergenceAgent, TradeBurstAgent, TradeSizeOutlierAgent, CVDDivergenceAgent, PriceImpactAgent

**Affected (perp-book mid):** CorrelationBreakAgent (also reads BTC mid), StopHuntAgent (correctly silent in scenario, but blocked when book missing)

**Smoking gun:** `SpotTakerFlowAgent` (which reads the analogous `__binanceSpotTakerFlow` populated by Phase 53.7) works fine — 206 bull, 127 bear, 306 neutral. Same architecture, same code shape; only Phase 53.5 (perp) is broken.

**Action:** diff Phase 53.5 (perp aggTrade) vs Phase 53.7 (spot aggTrade) boot wiring in `server/_core/index.ts` (or wherever it lives). Find the gap. **One fix, six agents come back online.**

## 2. The geo-block — Binance Futures REST blocked from Tokyo

LiquidationHeatmap explicitly logs the 451 response on the Binance Futures REST endpoint. OpenInterestDeltaAgent and FundingRateFlipAgent both hit the same path silently and stay neutral.

**Action:** route all Binance Futures REST through `multiExchangeLiquidationService` / `multiExchangeFundingService` which already fall back to Bybit/OKX. Or proxy through non-blocked region.

## 3. The dual-scale bug confirmed in live signal

We caught it on Tokyo:
```
[Pipeline] CONSENSUS symbol=ETH-USD dir=bullish conf=0.0% reason="1B/3Be/0N of 4 agents"
"Not enough high-confidence agents for consensus: 1/3 eligible, need ≥2 (min confidence: 65%)"
```
Three agents report bearish, one bullish → consensus output **"bullish at 0.0% confidence"**. Eligibility threshold is 65% (0-1 scale) but agents output 0.05–0.20 (Phase 40 scale). Only 1 of 3 agents is "eligible" because of scale mismatch.

**Action:** locate every threshold gate in the signal pipeline; verify each is using the post-Phase-40 scale; fix the consensus aggregator math (`dir=bullish` when bears outweigh bulls is a bug, full stop).

## 4. Asymmetric / one-sided logic across 4 slow agents

- **TechnicalAnalyst** — oversold damping (RSI<35) fires more often than overextension damping (RSI>65) → bull signals survive, bear signals get reclassified.
- **SentimentAnalyst** — F&G ≤ 35 → bullish branch (always fires in current F&G regime); no neutral band for 35-65.
- **NewsSentinel** — positive keyword list (23) vs negative (9) — over-correction of prior bearish bias.
- **MacroAnalyst** — fail-closed path emits bearish-0.95 instead of neutral-with-veto.

**Action:** rebalance each. They're all single-file fixes; not architectural.

## 5. The position-pipeline asymmetry

Live evidence from earlier audit query showed 3 short positions with **stopLoss = NULL** and 3 long positions with proper stops. The entry pipeline has a path that creates shorts without computing levels. This is distinct from the agent issues — but worth noting it's another asymmetry pattern.

## 6. Most agents emit neutral when ANY dependency fails silently

`AgentBase.generateSignal()` falls through to `createNeutralSignal()` on every error (lines 243–249). Errored signals enter consensus with `confidence: 0` rather than being dropped. This **dilutes consensus toward neutral** every time a sensor fails.

**Action:** explicit signal kinds — `kind: 'data_unavailable' | 'neutral_opinion' | 'directional'`. Don't pretend "no data" is the same as "studied and found nothing".

---

# Recommendations roll-up (no deletions)

| Action | Count | Agents |
|---|---|---|
| **keep-as-is** | 9 | PatternMatcher, OrderFlowAnalyst, OrderbookImbalanceAgent, SpotTakerFlowAgent, LiquidityVacuumAgent, WhaleTracker, StopHuntAgent, AgentBase, FreeOnChainDataProvider, DeterministicFallback |
| **retune-threshold** | 8 | TechnicalAnalyst, PerpDepthImbalanceAgent, PerpSpotPremiumAgent, VelocityAgent, CorrelationBreakAgent, MultiTFConvergenceAgent, SpreadCompressionAgent, WhaleWallAgent, FundingRateAnalyst, MacroAnalyst, SentimentAnalyst |
| **wire-missing-data** | 8 | PerpTakerFlowAgent, VWAPDivergenceAgent, TradeBurstAgent, TradeSizeOutlierAgent, CVDDivergenceAgent, PriceImpactAgent, LeadLagAgent, CrossExchangeSpreadAgent, OpenInterestDeltaAgent, FundingRateFlipAgent, OnChainAnalyst |
| **rewrite** | 3 | LiquidationHeatmap (mild-bias bug), VolumeProfileAnalyzer (`currentPrice` bug), NewsSentinel (bipolar keyword rebalance) |
| **retire** (only after consolidation) | 3 | ForexCorrelationAgent (no MetaAPI, duplicative), OnChainFlowAnalyst (unregistered, redundant with OnChainAnalyst), MLPredictionAgent (redundant with TradeSuccessPredictor), DuneAnalyticsProvider (no paid key) |
| **misclassified** | 1 | PatternDetection (library, not agent — remove from telemetry) |
