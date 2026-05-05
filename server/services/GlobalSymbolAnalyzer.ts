// Phase 22: Cached AuditLogger import (ESM-compatible)
let _auditLoggerCache: any = null;
async function _getAuditLoggerModule() {
  if (!_auditLoggerCache) _auditLoggerCache = await import("./AuditLogger");
  return _auditLoggerCache;
}

/**
 * Phase 14A: GlobalSymbolAnalyzer
 *
 * Runs 29 agents for ONE symbol, shared across ALL users.
 * Extracted from SymbolOrchestrator — signal generation only, no trade decisions.
 *
 * Key difference from SymbolOrchestrator:
 * - NO userId — this is global, not per-user
 * - NO StrategyOrchestrator — no consensus, no trade decisions
 * - NO wallet/balance — purely observational
 * - Emits raw agent signals that UserTradingSessions consume
 *
 * Signal flow:
 *   CoinbasePublicWS tick → handleTick() → fast agents (debounced 2s)
 *   Every 5 minutes → slow agents
 *   → emit('signals_updated', symbol, rawSignals[])
 */

import { EventEmitter } from 'events';
import { AgentManager } from '../agents/AgentBase';
import { coinbasePublicWebSocket } from './CoinbasePublicWebSocket';
import { getCandleCache } from '../WebSocketCandleCache';
import { priceFeedService } from './priceFeedService';
import { TechnicalAnalyst } from '../agents/TechnicalAnalyst';
import { PatternMatcher } from '../agents/PatternMatcher';
import { OrderFlowAnalyst } from '../agents/OrderFlowAnalyst';
import { SentimentAnalyst } from '../agents/SentimentAnalyst';
import { NewsSentinel } from '../agents/NewsSentinel';
import { MacroAnalyst } from '../agents/MacroAnalyst';
import { OnChainAnalyst } from '../agents/OnChainAnalyst';
import { WhaleTracker } from '../agents/WhaleTracker';
import { FundingRateAnalyst } from '../agents/FundingRateAnalyst';
import { LiquidationHeatmap } from '../agents/LiquidationHeatmap';
import { OnChainFlowAnalyst } from '../agents/OnChainFlowAnalyst';
import { VolumeProfileAnalyzer } from '../agents/VolumeProfileAnalyzer';
import { MLPredictionAgent } from '../agents/MLPredictionAgent';
import { ForexCorrelationAgent } from '../agents/ForexCorrelationAgent';
import { OrderbookImbalanceAgent } from '../agents/OrderbookImbalanceAgent';
import { LeadLagAgent } from '../agents/LeadLagAgent';
import { PerpSpotPremiumAgent } from '../agents/PerpSpotPremiumAgent';
import { PerpTakerFlowAgent } from '../agents/PerpTakerFlowAgent';
import { SpotTakerFlowAgent } from '../agents/SpotTakerFlowAgent';
import { PerpDepthImbalanceAgent } from '../agents/PerpDepthImbalanceAgent';
import { OpenInterestDeltaAgent } from '../agents/OpenInterestDeltaAgent';
import { getMLIntegrationService } from './MLIntegrationService';
import { webSocketFallbackManager } from './WebSocketFallbackManager';
import { getMarketRegimeAI, MarketContext } from './MarketRegimeAI';
import { getSkipAgents } from './RegimeCalibration';
import { getCrossCycleMemory } from './CrossCycleMemory';

export interface GlobalSignal {
  agentName: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  strength: number;
  reasoning: string;
  qualityScore: number;
  evidence?: any;
  timestamp: number;
}

export interface GlobalSymbolStatus {
  symbol: string;
  exchange: string;
  running: boolean;
  currentPrice: number;
  lastSignalUpdate: number;
  agentCount: number;
  agentHealth: any[];
  latestSignals: GlobalSignal[];
  cachedSlowSignalCount: number;
  lastSlowAgentUpdate: string | null;
  nextSlowAgentUpdate: string | null;
  tickCount: number;
}

export class GlobalSymbolAnalyzer extends EventEmitter {
  private symbol: string;
  private exchangeName: string;
  private agentManager: AgentManager;

  private isRunning: boolean = false;
  private currentPrice: number = 0;
  private tickCount: number = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private fastAgentDebounceTimer: NodeJS.Timeout | null = null;

  // Cached latest signals for on-demand access
  private latestSignals: GlobalSignal[] = [];
  private lastSignalUpdateMs: number = 0;

  // Market context from MarketRegimeAI (Intent Analyzer)
  private currentMarketContext: MarketContext | null = null;

  // Timing constants (same as SymbolOrchestrator)
  private readonly FAST_AGENT_DEBOUNCE_MS = 2000;
  private readonly UPDATE_INTERVAL_MS = 5000;
  private readonly SLOW_AGENT_INTERVAL_MS = 300_000; // 5 minutes

  private lastSlowAgentUpdate: Date = new Date(0);
  private nextSlowAgentUpdate: Date = new Date(0);
  private wsHealthy: boolean = false;

  // Ticker listener reference for cleanup
  private tickerHandler: ((event: any) => void) | null = null;
  private connectedHandler: (() => void) | null = null;
  private disconnectedHandler: (() => void) | null = null;
  private orderbookHandler: ((event: any) => void) | null = null;

  constructor(symbol: string, exchangeName: string = 'coinbase') {
    super();
    this.symbol = symbol;
    this.exchangeName = exchangeName;
    this.agentManager = new AgentManager();
  }

  /**
   * Start analyzing this symbol globally.
   * Initializes agents, subscribes to WebSocket, starts slow agent loop.
   */
   async start(initialSlowAgentDelayMs: number = 0): Promise<void> {
    if (this.isRunning) return;
    console.log(`[GlobalSymbolAnalyzer] Starting ${this.symbol} (initialSlowAgentDelay: ${initialSlowAgentDelayMs}ms)`);

    // Initialize all agents (same set as SymbolOrchestrator)
    await this.initializeAgents();

    // Start all agents with a 30s timeout — agents with slow network calls
    // (SentimentAnalyst, MacroAnalyst, FundingRateAnalyst, etc.) may hang on external APIs.
    // The timeout ensures the engine always starts; agents fetch data on demand if init fails.
    const AGENT_START_TIMEOUT_MS = 30_000;
    try {
      await Promise.race([
        this.agentManager.startAll(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`agentManager.startAll() timed out after ${AGENT_START_TIMEOUT_MS}ms`)), AGENT_START_TIMEOUT_MS)
        ),
      ]);
      console.log(`[GlobalSymbolAnalyzer] All agents started for ${this.symbol}`);
    } catch (err) {
      console.warn(`[GlobalSymbolAnalyzer] ${this.symbol} - Agent startup timed out (agents will continue initializing in background):`, (err as Error)?.message);
    }

    this.isRunning = true;
    this.lastSlowAgentUpdate = new Date();
    this.nextSlowAgentUpdate = new Date(Date.now() + this.SLOW_AGENT_INTERVAL_MS);

    // Subscribe to Coinbase public WebSocket
    // Handler registration is synchronous; candle seeding runs in background (non-blocking)
    await this.setupWebSocket();

    // Start slow agent update loop
    this.startUpdateLoop();

    // Trigger slow agents with staggered delay to avoid API rate limit contention
    // BTC-USD starts at 1s, ETH-USD at 31s, etc.
    const slowAgentInitDelay = 1000 + initialSlowAgentDelayMs;
    console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Scheduling initial slow agents in ${slowAgentInitDelay}ms`);
    setTimeout(async () => {
      try {
        await this.runSlowAgents();
        console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Initial slow agent update complete`);
      } catch (err) {
        console.error(`[GlobalSymbolAnalyzer] ${this.symbol} - Initial slow agent update failed:`, (err as Error)?.message);
      }
    }, slowAgentInitDelay);

    console.log(`[GlobalSymbolAnalyzer] ${this.symbol} started (${this.agentManager.getAgentNames().length} agents)`);
  }

  /**
   * Stop analyzing this symbol.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(`[GlobalSymbolAnalyzer] Stopping ${this.symbol}`);

    // Remove WebSocket listeners
    if (this.tickerHandler) {
      coinbasePublicWebSocket.removeListener('ticker', this.tickerHandler);
      this.tickerHandler = null;
    }
    if (this.connectedHandler) {
      coinbasePublicWebSocket.removeListener('connected', this.connectedHandler);
      this.connectedHandler = null;
    }
    if (this.disconnectedHandler) {
      coinbasePublicWebSocket.removeListener('disconnected', this.disconnectedHandler);
      this.disconnectedHandler = null;
    }
    if (this.orderbookHandler) {
      coinbasePublicWebSocket.removeListener('orderbook', this.orderbookHandler);
      this.orderbookHandler = null;
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.fastAgentDebounceTimer) {
      clearTimeout(this.fastAgentDebounceTimer);
      this.fastAgentDebounceTimer = null;
    }

    await this.agentManager.stopAll();
    this.isRunning = false;

    console.log(`[GlobalSymbolAnalyzer] ${this.symbol} stopped`);
  }

  /**
   * Get current status for this symbol's global analysis.
   */
  getStatus(): GlobalSymbolStatus {
    return {
      symbol: this.symbol,
      exchange: this.exchangeName,
      running: this.isRunning,
      currentPrice: this.currentPrice,
      lastSignalUpdate: this.lastSignalUpdateMs,
      agentCount: this.agentManager.getAgentNames().length,
      agentHealth: this.agentManager.getAllHealth(),
      latestSignals: this.latestSignals,
      cachedSlowSignalCount: this.cachedSlowSignals.length,
      lastSlowAgentUpdate: this.lastSlowAgentUpdate?.toISOString() || null,
      nextSlowAgentUpdate: this.nextSlowAgentUpdate?.toISOString() || null,
      tickCount: this.tickCount,
    };
  }

  /**
   * Get the latest cached signals for this symbol.
   */
  getLatestSignals(): GlobalSignal[] {
    return this.latestSignals;
  }

  /**
   * Get the AgentManager (for advanced queries).
   */
  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  // ========================================
  // PRIVATE: Agent initialization
  // ========================================

  private async initializeAgents(): Promise<void> {
    // Create core agents (Phase 1)
    const technical = new TechnicalAnalyst();
    const pattern = new PatternMatcher();
    const orderFlow = new OrderFlowAnalyst();
    const sentiment = new SentimentAnalyst();
    const news = new NewsSentinel();
    const macro = new MacroAnalyst();
    const onChain = new OnChainAnalyst();

    // Create Phase 2 agents
    const whaleTracker = new WhaleTracker();
    const fundingRate = new FundingRateAnalyst();
    const liquidation = new LiquidationHeatmap();
    const onChainFlow = new OnChainFlowAnalyst();
    const volumeProfile = new VolumeProfileAnalyzer();
    const forexCorrelation = new ForexCorrelationAgent();

    // Phase 28: Orderbook microstructure agent — fills the L2 imbalance gap
    // identified by the 2026-04-25 audit (65% consensus on losing trades).
    const orderbookImbalance = new OrderbookImbalanceAgent();

    // Phase 53.3 — LeadLagAgent: turns the LeadLagTracker measurements into
    // a consensus signal. SOL median lead 167ms (88% Binance leads) is real
    // exploitable information that was previously just observation.
    const leadLag = new LeadLagAgent();

    // Phase 53.4 — PerpSpotPremiumAgent: reads perp + spot bookTicker globals
    // populated by the boot wiring and signals when perp leads spot via a
    // statistically-elevated premium delta. Perp leverage compresses 1-3s
    // of leading-flow information vs cash market.
    const perpSpotPremium = new PerpSpotPremiumAgent();

    // Phase 53.5 — PerpTakerFlowAgent: cumulative volume delta on perps. Big
    // one-sided taker bursts (aggressive market orders) lead price by 0.5-2s
    // even on the same venue. Reads __binancePerpTakerFlow from the boot WS.
    const perpTakerFlow = new PerpTakerFlowAgent();

    // Phase 53.7 — SpotTakerFlowAgent: spot CVD. Pairs with PerpTakerFlow in
    // consensus — agreement = real demand/supply, divergence = perp speculation
    // that's likely to fade. Reads __binanceSpotTakerFlow from the boot WS.
    const spotTakerFlow = new SpotTakerFlowAgent();

    // Phase 53.8 — PerpDepthImbalanceAgent: top-5 order book imbalance on
    // Binance USDT-M perps. Resting bid/ask quantity over the top 5 levels
    // is a much more stable signal than top-of-book alone.
    const perpDepthImbalance = new PerpDepthImbalanceAgent();

    // Phase 53.9 — OpenInterestDeltaAgent: slow-path REST poll of perp OI.
    // ΔOI × ΔPrice quadrant reveals positioning (fresh longs/shorts, squeeze,
    // capitulation). 60s cadence, polls only the symbol this analyzer owns.
    const openInterestDelta = new OpenInterestDeltaAgent();

    // Connect MacroAnalyst to NewsSentinel for Fed veto detection
    macro.setNewsSentinel(news);

    // Register all agents
    this.agentManager.registerAgent(technical);
    this.agentManager.registerAgent(pattern);
    this.agentManager.registerAgent(orderFlow);
    this.agentManager.registerAgent(sentiment);
    this.agentManager.registerAgent(news);
    this.agentManager.registerAgent(macro);
    this.agentManager.registerAgent(onChain);
    this.agentManager.registerAgent(whaleTracker);
    this.agentManager.registerAgent(fundingRate);
    this.agentManager.registerAgent(liquidation);
    // Phase 13 — OnChainFlowAnalyst disabled by default. Its primary upstream
    // (Hetzner blockchain node 65.109.171.16) is dead as of 2026-04-21; the
    // agent cascades to FreeOnChainDataProvider which is CoinGecko-backed and
    // rate-limited (429 every 2 min). Net effect: emits low-confidence or
    // throwing signals that pollute the consensus calculation. Re-enable via
    // env flag only when the upstream is restored.
    if (process.env.ENABLE_ONCHAIN_FLOW_ANALYST === 'true') {
      this.agentManager.registerAgent(onChainFlow);
    } else {
      void onChainFlow; // Keep the constructor side-effect parity; discard.
    }
    this.agentManager.registerAgent(volumeProfile);
    this.agentManager.registerAgent(forexCorrelation);
    // Phase 28: Register the orderbook imbalance agent. It consumes L2 events
    // forwarded from CoinbasePublicWebSocket via the orderbook handler below.
    this.agentManager.registerAgent(orderbookImbalance);

    // Phase 53.3: LeadLagAgent — instant cross-exchange lead-lag signal.
    // Subscribes to LeadLagTracker events on init, no external API calls.
    this.agentManager.registerAgent(leadLag);

    // Phase 53.4: PerpSpotPremiumAgent — perp-vs-spot premium reading.
    // Pure in-memory reads of __binanceFuturesBook + __binanceSpotBook.
    this.agentManager.registerAgent(perpSpotPremium);

    // Phase 53.5: PerpTakerFlowAgent — CVD on perp aggTrade stream.
    this.agentManager.registerAgent(perpTakerFlow);

    // Phase 53.7: SpotTakerFlowAgent — CVD on spot aggTrade. Pairs with perp.
    this.agentManager.registerAgent(spotTakerFlow);

    // Phase 53.8: PerpDepthImbalanceAgent — top-5 order book imbalance on perps.
    this.agentManager.registerAgent(perpDepthImbalance);

    // Phase 53.9: OpenInterestDeltaAgent — perp OI quadrant signal (slow path).
    this.agentManager.registerAgent(openInterestDelta);

    // ML Prediction Agent (Phase 3)
    try {
      const mlService = getMLIntegrationService();
      if (mlService.isMLPredictionEnabled()) {
        const mlPrediction = new MLPredictionAgent();
        this.agentManager.registerAgent(mlPrediction);
        console.log(`[GlobalSymbolAnalyzer] ML Prediction Agent registered for ${this.symbol}`);
      }
    } catch (err) {
      console.warn(`[GlobalSymbolAnalyzer] Failed to register ML Prediction Agent:`, (err as Error)?.message);
    }

    console.log(`[GlobalSymbolAnalyzer] Initialized ${this.agentManager.getAgentNames().length} agents for ${this.symbol}`);
  }

  // ========================================
  // PRIVATE: WebSocket setup
  // ========================================

  private async setupWebSocket(): Promise<void> {
    // STEP 1: Register WebSocket handlers FIRST (must always succeed)
    // This ensures ticks flow immediately, even if candle seeding times out.
    const publicWs = coinbasePublicWebSocket;

    this.tickerHandler = (event: any) => {
      if (event.product_id === this.symbol) {
        const normalizedEvent = {
          symbol: event.product_id,
          lastPrice: parseFloat(event.price),
          price: parseFloat(event.price),
          volume: parseFloat(event.volume_24_h || '0'),
          high: parseFloat(event.high_24_h || '0'),
          low: parseFloat(event.low_24_h || '0'),
          timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
        };
        this.handleTick(normalizedEvent);
      }
    };

    this.connectedHandler = () => {
      this.wsHealthy = true;
      webSocketFallbackManager.reportPrimaryConnected();
    };

    this.disconnectedHandler = () => {
      this.wsHealthy = false;
      webSocketFallbackManager.reportPrimaryDisconnected();
    };

    // Order book handler — feed L2 data to OrderFlowAnalyst and (Phase 28)
    // OrderbookImbalanceAgent. CoinbasePublicWebSocket already maintains the
    // canonical book and re-emits sorted bids/asks on every l2update; both
    // agents are decoupled from the L2 protocol.
    this.orderbookHandler = (event: any) => {
      if (event.product_id === this.symbol) {
        const orderFlowAgent = this.agentManager.getAgent('OrderFlowAnalyst');
        if (orderFlowAgent && typeof (orderFlowAgent as any).updateOrderBook === 'function') {
          (orderFlowAgent as any).updateOrderBook(this.symbol, {
            bids: event.bids,
            asks: event.asks,
          });
        }
        const orderbookImbalanceAgent = this.agentManager.getAgent('OrderbookImbalanceAgent');
        if (orderbookImbalanceAgent && typeof (orderbookImbalanceAgent as any).onOrderBook === 'function') {
          (orderbookImbalanceAgent as any).onOrderBook(this.symbol, event.bids, event.asks);
        }
      }
    };

    publicWs.on('ticker', this.tickerHandler);
    publicWs.on('connected', this.connectedHandler);
    publicWs.on('disconnected', this.disconnectedHandler);
    publicWs.on('orderbook', this.orderbookHandler);

    // Start the public WebSocket if not already running
    if (!publicWs.isHealthy()) {
      const defaultSymbols = ['BTC-USD', 'ETH-USD'];
      await publicWs.start(defaultSymbols);
    }

    console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - WebSocket handlers registered, ticks flowing`);

    // STEP 2: Initialize candle cache buffers (synchronous, always succeeds)
    const candleCache = getCandleCache();
    candleCache.initializeBuffer(this.symbol, '1m', 500);
    candleCache.initializeBuffer(this.symbol, '5m', 500);
    candleCache.initializeBuffer(this.symbol, '1h', 500);
    candleCache.initializeBuffer(this.symbol, '4h', 500);
    candleCache.initializeBuffer(this.symbol, '1d', 500);

    // STEP 3: Seed historical candles from database (can be slow, non-blocking)
    // Run in background so it doesn't block the WebSocket setup
    this.seedHistoricalCandlesInBackground();
  }

  /**
   * Seed historical candles in the background. Non-blocking — if it fails or times out,
   * the analyzer still works with live ticks.
   */
  private seedHistoricalCandlesInBackground(): void {
    const candleCache = getCandleCache();
    (async () => {
      try {
        for (const timeframe of ['1m', '5m', '1h', '4h', '1d']) {
          await candleCache.seedHistoricalCandles(this.symbol, timeframe);
        }
        console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Historical candles seeded successfully`);
      } catch (err) {
        console.warn(`[GlobalSymbolAnalyzer] ${this.symbol} - Failed to seed candles, will build from ticks:`, (err as Error)?.message);
      }
    })();
  }

  // ========================================
  // PRIVATE: Tick handling + fast agents
  // ========================================

  private handleTick(event: any): void {
    try {
      this.currentPrice = event.price;
      this.tickCount++;

      // Feed tick into TickToCandleAggregator (global singleton)
      import('./TickToCandleAggregator').then(({ getTickToCandleAggregator }) => {
        getTickToCandleAggregator().processTick(this.symbol, event.price, event.volume || 0, event.timestamp || Date.now());
      }).catch(() => { /* non-critical */ });

      // Update priceFeedService
      priceFeedService.updatePrice(this.symbol, event.price, 'websocket', {
        volume24h: event.volume,
      });

      // Feed ticks to fast agents for tick-level confidence
      const tickData = { price: event.price, timestamp: event.timestamp || Date.now(), symbol: this.symbol };
      for (const agentName of ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'OrderbookImbalanceAgent']) {
        const agent = this.agentManager.getAgent(agentName);
        if (agent && typeof agent.onTick === 'function') {
          agent.onTick(tickData);
        }
      }

      // Inject live price into PatternMatcher and OrderFlowAnalyst
      const patternMatcher = this.agentManager.getAgent('PatternMatcher');
      if (patternMatcher && typeof (patternMatcher as any).setCurrentPrice === 'function') {
        (patternMatcher as any).setCurrentPrice(this.currentPrice);
      }
      const orderFlowAnalyst = this.agentManager.getAgent('OrderFlowAnalyst');
      if (orderFlowAnalyst && typeof (orderFlowAnalyst as any).setCurrentPrice === 'function') {
        (orderFlowAnalyst as any).setCurrentPrice(this.currentPrice);
      }

      // Debounce fast agent analysis (2s window)
      if (this.fastAgentDebounceTimer) {
        clearTimeout(this.fastAgentDebounceTimer);
      }

      this.fastAgentDebounceTimer = setTimeout(async () => {
        try {
          // Phase 30: Get MarketContext from MarketRegimeAI (Intent Analyzer)
          // This provides regime, volatility, trend, and per-agent guidance to every agent
          try {
            this.currentMarketContext = await getMarketRegimeAI().getMarketContext(this.symbol);
          } catch (err) {
            console.warn(`[GlobalSymbolAnalyzer] ${this.symbol} - MarketRegimeAI failed, using cached context:`, (err as Error)?.message);
            // Keep using previous context if available, otherwise agents get empty context
          }
          // Phase 35: Inject cross-cycle memory context alongside MarketRegimeAI context
          const crossCycleCtx = getCrossCycleMemory().getContext(this.symbol);
          const agentContext = {
            ...(this.currentMarketContext || {}),
            crossCycleMemory: crossCycleCtx,
          };

          // Run fast agents via AgentManager (TechnicalAnalyst, PatternMatcher,
          // OrderFlowAnalyst, OrderbookImbalanceAgent). Phase 28 added the
          // imbalance agent here so its L2 signal flows into consensus alongside
          // the other tick-driven agents.
          const fastAgentNames = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'OrderbookImbalanceAgent'];
          const signals: GlobalSignal[] = [];

          // Phase 33: Selective agent activation — skip agents irrelevant to current regime
          const currentRegime = (agentContext as any)?.regime as string || '';
          const skipList = currentRegime ? getSkipAgents(currentRegime) : [];

          for (const agentName of fastAgentNames) {
            // Phase 33: Skip agents that are irrelevant to current regime
            if (skipList.includes(agentName)) {
              console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Skipping ${agentName} (regime: ${currentRegime})`);
              continue;
            }
            const agent = this.agentManager.getAgent(agentName);
            if (agent) {
              try {
                const startMs = Date.now();
                // Phase 30: Pass MarketContext to agent instead of empty {}
                const signal = await agent.generateSignal(this.symbol, agentContext);
                const execTimeMs = Date.now() - startMs;
                if (signal) {
                  signals.push({
                    agentName,
                    signal: signal.signal || 'neutral',
                    confidence: signal.confidence || 0,
                    strength: signal.strength || 0,
                    reasoning: signal.reasoning || '',
                    qualityScore: signal.qualityScore || 0,
                    evidence: signal.evidence,
                    timestamp: Date.now(),
                  });
                  // Phase 22: Log every fast agent signal to DB
                  try {
                    const { getAuditLogger } = await import('./AuditLogger');
                    getAuditLogger().logAgentSignal({
                      symbol: this.symbol,
                      agentName,
                      agentCategory: 'fast',
                      signal: signal.signal || 'neutral',
                      confidence: signal.confidence || 0,
                      reasoning: (signal.reasoning || '').substring(0, 500),
                      executionTimeMs: execTimeMs,
                      dataSource: 'live_tick',
                    });
                  } catch { /* audit logger not ready */ }
                }
              } catch (err) {
                // Individual agent failure doesn't stop others
              }
            }
          }

          // Merge with cached slow agent signals
          const allSignals = [...signals, ...this.getSlowAgentSignals()];

          // Phase 35: Record cycle insights in CrossCycleMemory
          try {
            const memory = getCrossCycleMemory();
            memory.recordCycle(
              this.symbol,
              allSignals.map((s: any) => ({
                agentName: s.agentName,
                symbol: s.symbol || this.symbol,
                signal: s.signal,
                confidence: s.confidence,
                strength: s.strength,
                reasoning: s.reasoning,
                qualityScore: s.qualityScore,
                evidence: s.evidence || {},
                timestamp: s.timestamp,
                executionScore: s.executionScore || 0,
                processingTime: s.processingTime || 0,
                dataFreshness: s.dataFreshness || 0,
              })),
              (agentContext as any)?.regime || 'unknown',
              this.currentPrice
            );
          } catch { /* memory recording non-critical */ }

          // Update cache
          this.latestSignals = allSignals;
          this.lastSignalUpdateMs = Date.now();

          // Emit signals for all UserTradingSessions to consume
          // Phase 30: Include market context in emission for downstream consumers
          this.emit('signals_updated', this.symbol, allSignals, this.currentMarketContext);
        } catch (err) {
          console.error(`[GlobalSymbolAnalyzer] Fast agent error for ${this.symbol}:`, (err as Error)?.message);
        }
      }, this.FAST_AGENT_DEBOUNCE_MS);
    } catch (err) {
      console.error(`[GlobalSymbolAnalyzer] Tick handling error for ${this.symbol}:`, (err as Error)?.message);
    }
  }

  // ========================================
  // PRIVATE: Slow agents (5-minute cycle)
  // ========================================

  private cachedSlowSignals: GlobalSignal[] = [];

  private startUpdateLoop(): void {
    this.updateInterval = setInterval(() => {
      if (!this.isRunning) return;

      const timeSinceLastSlowUpdate = Date.now() - this.lastSlowAgentUpdate.getTime();
      if (timeSinceLastSlowUpdate >= this.SLOW_AGENT_INTERVAL_MS) {
        this.runSlowAgents().catch(err => {
          console.error(`[GlobalSymbolAnalyzer] Slow agent update error for ${this.symbol}:`, (err as Error)?.message);
        });
      }
    }, this.UPDATE_INTERVAL_MS);
  }

  private async runSlowAgents(): Promise<void> {
    const slowAgentNames = [
      'SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst',
      'WhaleTracker', 'FundingRateAnalyst', 'LiquidationHeatmap',
      'OnChainFlowAnalyst', 'VolumeProfileAnalyzer', 'MLPredictionAgent',
    ];

    // Inject live price into SentimentAnalyst
    const sentiment = this.agentManager.getAgent('SentimentAnalyst');
    if (sentiment && typeof (sentiment as any).setCurrentPrice === 'function') {
      (sentiment as any).setCurrentPrice(this.currentPrice);
    }

    const signals: GlobalSignal[] = [];
    let successCount = 0;
    let failCount = 0;

    const SLOW_AGENT_TIMEOUT_MS = 120_000; // 120s per-agent timeout (some agents make multiple API calls with retries)

    // Phase 33: Selective agent activation — skip agents irrelevant to current regime
    const currentRegime = (this.currentMarketContext as any)?.regime as string || '';
    const skipList = currentRegime ? getSkipAgents(currentRegime) : [];
    let skippedCount = 0;

    for (const agentName of slowAgentNames) {
      // Phase 33: Skip agents that are irrelevant to current regime
      if (skipList.includes(agentName)) {
        console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Skipping slow agent ${agentName} (regime: ${currentRegime})`);
        skippedCount++;
        continue;
      }
      const agent = this.agentManager.getAgent(agentName);
      if (!agent) continue;

      const agentStartMs = Date.now();
      try {
        // Wrap each agent call with a timeout to prevent a single hanging agent
        // from blocking the entire slow agent cycle
        // Phase 30: Pass MarketContext to slow agents too
        const slowContext = this.currentMarketContext || {};
        const signal = await Promise.race([
          agent.generateSignal(this.symbol, slowContext),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Agent ${agentName} timed out after ${SLOW_AGENT_TIMEOUT_MS}ms`)), SLOW_AGENT_TIMEOUT_MS)
          ),
        ]);
        const agentExecMs = Date.now() - agentStartMs;
        if (signal) {
          signals.push({
            agentName,
            signal: signal.signal || 'neutral',
            confidence: signal.confidence || 0,
            strength: signal.strength || 0,
            reasoning: signal.reasoning || '',
            qualityScore: signal.qualityScore || 0,
            evidence: signal.evidence,
            timestamp: Date.now(),
          });
          successCount++;

          // Phase 22: Log slow agent signal + activity to DB
          try {
            const { getAuditLogger } = await import('./AuditLogger');
            const logger = getAuditLogger();
            logger.logAgentSignal({
              symbol: this.symbol,
              agentName,
              agentCategory: 'slow',
              signal: signal.signal || 'neutral',
              confidence: signal.confidence || 0,
              reasoning: (signal.reasoning || '').substring(0, 500),
              executionTimeMs: agentExecMs,
              dataSource: 'periodic',
            });
            logger.logSlowAgent({
              symbol: this.symbol,
              agentName,
              status: 'success',
              executionTimeMs: agentExecMs,
              signal: signal.signal || 'neutral',
              confidence: signal.confidence || 0,
            });
          } catch { /* audit logger not ready */ }
        }
      } catch (err) {
        const agentExecMs = Date.now() - agentStartMs;
        failCount++;
        console.warn(`[GlobalSymbolAnalyzer] ${this.symbol} - Slow agent ${agentName} failed:`, (err as Error)?.message);

        // Phase 22: Log slow agent failure to DB
        try {
          const { getAuditLogger } = await import('./AuditLogger');
          getAuditLogger().logSlowAgent({
            symbol: this.symbol,
            agentName,
            status: 'error',
            executionTimeMs: agentExecMs,
            errorMessage: (err as Error)?.message || 'Unknown error',
          });
        } catch { /* audit logger not ready */ }
      }

      // Small delay between agents to avoid API rate limit contention
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.cachedSlowSignals = signals;
    this.lastSlowAgentUpdate = new Date();
    this.nextSlowAgentUpdate = new Date(Date.now() + this.SLOW_AGENT_INTERVAL_MS);

    console.log(`[GlobalSymbolAnalyzer] ${this.symbol} - Slow agent update: ${successCount} succeeded, ${failCount} failed, ${skippedCount} skipped (regime: ${currentRegime || 'unknown'}), ${signals.length} signals cached. Next: ${this.nextSlowAgentUpdate.toISOString()}`);

    // Emit updated signals (fast + slow combined)
    const allSignals = [...this.getFastAgentSignals(), ...signals];
    this.latestSignals = allSignals;
    this.lastSignalUpdateMs = Date.now();
    this.emit('signals_updated', this.symbol, allSignals, this.currentMarketContext);
  }

  private getSlowAgentSignals(): GlobalSignal[] {
    return this.cachedSlowSignals;
  }

  private getFastAgentSignals(): GlobalSignal[] {
    const fastAgentNames = new Set(['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'OrderbookImbalanceAgent']);
    return this.latestSignals.filter(s => fastAgentNames.has(s.agentName));
  }
}
