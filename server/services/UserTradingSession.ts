/**
 * Phase 14B: UserTradingSession — Per-User Trade Decision Session
 *
 * Lightweight session that subscribes to global signals from GlobalMarketEngine
 * and makes user-specific trade decisions based on per-user settings.
 *
 * What's per-user (this session owns):
 * - Agent weights (AgentWeightManager)
 * - Consensus threshold, confidence settings
 * - AutomatedSignalProcessor (applies user weights → trade/no-trade decision)
 * - EnhancedTradeExecutor (executes trades with user's risk limits)
 * - IntelligentExitManager (manages exits for user's positions)
 * - PaperTradingEngine (user's wallet, positions, trade history)
 * - PositionManager + RiskManager
 *
 * What's shared globally (this session subscribes to):
 * - GlobalMarketEngine → GlobalSymbolAnalyzer → raw agent signals
 * - CoinbasePublicWS → price ticks (via priceFeedService)
 * - PriceFabric → multi-source price data
 *
 * Replaces the heavy per-user SEERMultiEngine with:
 * - NO SymbolOrchestrator per user (global now)
 * - NO AgentManager per user (global now)
 * - NO WebSocket subscription per user (global now)
 * - Just signal consumption + trade decisions + position management
 */

import { EventEmitter } from 'events';
import { priceFeedService } from './priceFeedService';
import { GlobalSignal } from './GlobalSymbolAnalyzer';
import { getTradingConfig } from '../config/TradingConfig';
import { getDecisionEvaluator } from './DecisionEvaluator';
import { getAgentRetriggerService } from './AgentRetriggerService';
import { getScenarioEngine } from './ScenarioEngine';
import { getMonteCarloSimulator } from './MonteCarloSimulator';
import { shouldAllowClose as profitLockShouldAllowClose } from './ProfitLockGuard';

export interface UserTradingSessionConfig {
  userId: number;
  autoTradingEnabled: boolean;
  tradingMode: 'paper' | 'real';
  subscribedSymbols: string[];
  consensusThreshold?: number;
  minConfidence?: number;
}

export interface UserTradingSessionStatus {
  userId: number;
  isRunning: boolean;
  autoTradingEnabled: boolean;
  tradingMode: 'paper' | 'real';
  subscribedSymbols: string[];
  positionCount: number;
  lastSignalProcessed: number;
  lastTradeExecuted: number;
  totalTradesExecuted: number;
  totalTradesRejected: number;
  walletBalance: number;
  exitManagerActive: boolean;
}

export class UserTradingSession extends EventEmitter {
  private userId: number;
  private autoTradingEnabled: boolean = false;
  private tradingMode: 'paper' | 'real' = 'paper';
  private subscribedSymbols: Set<string> = new Set();
  private isRunning: boolean = false;
  private priceUpdateHandler: ((data: { symbol: string; price: number }) => void) | null = null;

  // Per-user components (lazy-initialized)
  private signalProcessor: any = null;       // AutomatedSignalProcessor
  private tradeExecutor: any = null;         // EnhancedTradeExecutor
  private exitManager: any = null;           // IntelligentExitManager
  private tradingEngine: any = null;         // PaperTradingEngine
  private weightManager: any = null;         // AgentWeightManager
  private positionManager: any = null;       // PositionManager
  private riskManager: any = null;           // RiskManager

  // Stats
  private lastSignalProcessedMs: number = 0;
  private lastTradeExecutedMs: number = 0;
  private totalTradesExecuted: number = 0;
  private totalTradesRejected: number = 0;

  // Settings sync interval
  private settingsSyncInterval: NodeJS.Timeout | null = null;
  private readonly SETTINGS_SYNC_INTERVAL_MS = 30_000; // 30 seconds

  // Phase 40 FIX: Paper position price update interval
  // Updates paper position prices in DB every 10 seconds so the UI shows current P&L
  private paperPriceUpdateInterval: NodeJS.Timeout | null = null;
  private readonly PAPER_PRICE_UPDATE_INTERVAL_MS = 10_000; // 10 seconds

  // Phase 46: Single-source exit ownership. When true, IntelligentExitManager
  // owns all exit decisions and the safety-net in the price-update interval
  // skips threshold evaluation (DB-sync path still runs). Flipped true when
  // IEM.addPosition() succeeds, false on teardown / IEM unavailable.
  private exitManagerActive: boolean = false;

  // Phase 46: Retry tracking for failed exits (phantom-close prevention).
  // On engine-close failure we no longer write status='closed' to DB blindly;
  // instead we schedule up to MAX_EXIT_RETRIES attempts, then emergency-alert.
  private exitRetryCount: Map<string, number> = new Map();
  private readonly MAX_EXIT_RETRIES = 3;

  constructor(config: UserTradingSessionConfig) {
    super();
    this.userId = config.userId;
    this.autoTradingEnabled = config.autoTradingEnabled;
    this.tradingMode = config.tradingMode;
    this.subscribedSymbols = new Set(config.subscribedSymbols);
  }

  /**
   * Initialize all per-user components.
   * Called once when session is created.
   */
  async initialize(): Promise<void> {
    if (this.isRunning) return;

    console.log(`[UserTradingSession] Initializing session for user ${this.userId}...`);

    try {
      // 1. Initialize AgentWeightManager (loads per-user weights from DB)
      const { getAgentWeightManager } = await import('./AgentWeightManager');
      this.weightManager = getAgentWeightManager(this.userId);
      await this.weightManager.loadFromDatabase();

      // 2. Initialize trading engine.
      //
      // Phase B-2 — when USE_TESTNET_ENGINE=1 we route through RealTradingEngine
      // pointed at Binance Spot Testnet (testnet.binance.vision). Same testnet
      // keys via BINANCE_API_KEY/BINANCE_SECRET_KEY, with BINANCE_USE_TESTNET=1
      // telling BinanceAdapter to use testnet base URL. Converts paper trading
      // from "in-memory simulator" to "real order book mechanics with fake
      // money" — actual fills, real spread, real partial fills, exchange-side
      // rejections. Both engines emit the same events (position_opened,
      // position_closed, wallet_updated, etc.) per ITradingEngine contract.
      //
      // Default falls back to in-memory PaperTradingEngine for users without
      // testnet keys configured.
      const useTestnetEngine = process.env.USE_TESTNET_ENGINE === '1'
        && !!process.env.BINANCE_API_KEY
        && !!process.env.BINANCE_SECRET_KEY;

      if (useTestnetEngine && this.tradingMode === 'paper') {
        const { RealTradingEngine } = await import('../execution/RealTradingEngine');
        this.tradingEngine = new RealTradingEngine({
          userId: this.userId,
          exchange: 'binance',
          apiKey: process.env.BINANCE_API_KEY!,
          apiSecret: process.env.BINANCE_SECRET_KEY!,
          dryRun: false, // place REAL orders on testnet
          maxDailyLossPercent: 0.05,
          maxSingleTradePercent: 0.02,
          maxOpenPositions: 6,
          positionSizeRampUp: 1.0,
        });
        console.log(`[UserTradingSession] 🧪 Using RealTradingEngine on Binance TESTNET (paper-mode)`);
      } else {
        const { PaperTradingEngine } = await import('../execution/PaperTradingEngine');
        // Phase 44 alignment — paper-trade against Binance perp economics
        // (0.10% taker / 0.02% maker, ~0.25% drag), matching the AS champion
        // backtest. Coinbase's 0.50% taker → 1.30% drag is incompatible with
        // the strategy's small-edge geometry, which the audit + a manual
        // close-attempt confirmed (ProfitLockGuard correctly refused to book
        // a +0.20% gross win that would have netted -1.10% under Coinbase).
        // Override via PAPER_EXCHANGE=coinbase if you need to test that path.
        const paperExchange = (process.env.PAPER_EXCHANGE as 'binance' | 'coinbase') || 'binance';
        this.tradingEngine = new PaperTradingEngine({
          userId: this.userId,
          initialBalance: 10000,
          exchange: paperExchange,
          enableSlippage: true,
          enableCommission: true,
          enableMarketImpact: true,
          enableLatency: true,
        });
      }

      // 3. Initialize PositionManager
      const { PositionManager } = await import('../PositionManager');
      this.positionManager = new PositionManager();

      // Forward position price updates
      this.positionManager.on('position_prices', (priceUpdates: any) => {
        this.emit('position_prices', priceUpdates);
      });

      // 4. Initialize RiskManager (with wallet balance)
      const { RiskManager } = await import('../RiskManager');
      const wallet = this.tradingEngine.getWallet();
      this.riskManager = new RiskManager(wallet?.balance || 10000);

      // 5. Initialize AutomatedSignalProcessor — Phase 18: thresholds from TradingConfig
      const { AutomatedSignalProcessor } = await import('./AutomatedSignalProcessor');
      const consensusCfg = getTradingConfig().consensus;
      this.signalProcessor = new AutomatedSignalProcessor(this.userId, {
        minConfidence: consensusCfg.minConfidence,
        minExecutionScore: consensusCfg.minExecutionScore,
        consensusThreshold: consensusCfg.minConsensusStrength,
      });

      // 6. Initialize EnhancedTradeExecutor — Phase 18: limits from TradingConfig
      const { EnhancedTradeExecutor } = await import('./EnhancedTradeExecutor');
      const sizingCfg = getTradingConfig().positionSizing;
      this.tradeExecutor = new EnhancedTradeExecutor(this.userId, {
        requireEntryValidation: true,
        useIntegratedExitManager: true,
        useWeek9RiskManager: true,
        maxPositionSize: sizingCfg.maxPositionSizePercent,
        defaultStopLoss: Math.abs(getTradingConfig().exits.hardStopLossPercent) / 100,
        defaultTakeProfit: getTradingConfig().exits.profitTargets[2] / 100,
        maxPositions: sizingCfg.maxConcurrentPositions,
      });

      // Wire dependencies
      this.tradeExecutor.setDependencies(
        this.tradingEngine,
        this.positionManager
      );

      // Phase 20: Sync existing open positions into the risk manager.
      // Without this, the PositionLimitTracker starts empty on every restart
      // and allows duplicate positions in the same symbol.
      // NOTE: We use paperPositions table (via direct DB query) because
      // PositionManager.getOpenPositions() uses the `positions` table which
      // is for real trading — paper positions are in `paperPositions`.
      try {
        const { getDb } = await import('../db');
        const db = await getDb();
        if (db) {
          const { eq, and } = await import('drizzle-orm');
          const { paperPositions } = await import('../../drizzle/schema');
          const existingPositions = await db
            .select()
            .from(paperPositions)
            .where(and(
              eq(paperPositions.userId, this.userId),
              eq(paperPositions.status, 'open')
            ));
          // Deduplicate by symbol — only register one position per symbol
          const symbolsSeen = new Set<string>();
          for (const pos of existingPositions) {
            if (symbolsSeen.has(pos.symbol)) continue;
            symbolsSeen.add(pos.symbol);
            const direction: 'long' | 'short' = (pos.side === 'short') ? 'short' : 'long';
            const size = Math.abs(parseFloat(pos.quantity || '0') * parseFloat(pos.entryPrice || '0'));
            this.tradeExecutor.registerExistingPosition(pos.symbol, size, direction);
          }
          if (symbolsSeen.size > 0) {
            console.log(`[UserTradingSession] Synced ${symbolsSeen.size} existing positions into risk manager for user ${this.userId}: ${Array.from(symbolsSeen).join(', ')}`);
          }
        }
      } catch (err) {
        console.warn(`[UserTradingSession] Failed to sync existing positions:`, (err as Error)?.message);
      }

      // 7. Initialize IntelligentExitManager
      const { IntelligentExitManager } = await import('./IntelligentExitManager');
      this.exitManager = new IntelligentExitManager({
        // Phase 7 — fee-aware breakeven (see IntelligentExitManager DEFAULT_CONFIG).
        breakevenActivationPercent: 0.8,
        breakevenBuffer: 0.5,
        partialProfitLevels: [
          { pnlPercent: 1.0, exitPercent: 25 },
          { pnlPercent: 1.5, exitPercent: 25 },
          { pnlPercent: 2.0, exitPercent: 50 },
        ],
        trailingActivationPercent: 1.5,
        trailingPercent: 0.5,
        useATRTrailing: true,
        atrTrailingMultiplier: 2.0,
        exitConsensusThreshold: 0.6,
        maxHoldTimeHours: 4,
        minProfitForTimeExit: 0,
        agentCheckIntervalMs: 5000,
        priceCheckIntervalMs: 100,
        useHardExitRules: true,
      });

      // Set exit manager callbacks
      this.exitManager.setCallbacks({
        getAgentSignals: async (symbol: string, _position: any) => {
          // Get agent signals from GlobalMarketEngine
          try {
            const { getGlobalMarketEngine } = await import('./GlobalMarketEngine');
            const globalEngine = getGlobalMarketEngine();
            const analyzer = globalEngine.getAnalyzer(symbol);
            if (!analyzer) return [];

            const agentManager = analyzer.getAgentManager();
            const agents = agentManager.getAllAgentsWithSignals();

            return agents
              .filter((a: any) => a.latestSignal)
              .map((a: any) => ({
                agentName: a.agentName,
                signal: a.latestSignal?.signal || 'neutral',
                confidence: a.latestSignal?.confidence || 0,
                exitRecommendation: a.latestSignal?.exitRecommendation,
                evidence: a.latestSignal?.evidence,
              }));
          } catch {
            return [];
          }
        },
        getCurrentPrice: async (symbol: string) => {
          const priceData = priceFeedService.getLatestPrice(symbol);
          return priceData?.price || 0;
        },
        executeExit: async (positionId: string, quantity: number, reason: string) => {
          // Phase 54.2 — visibility + engine-desync fallback.
          //
          // Pre-Phase-54.2: this callback bailed silently if `this.tradingEngine` was
          // null, AND if the engine threw "Position not found" the Phase 46 retry
          // budget would burn out without ever marking the DB row closed. Result:
          // IEM logs "FULL EXIT" (and removes from its monitoring map), engine
          // never closes the row, paperPositions.status stays 'open' forever.
          // Found 2026-05-06 with 3 positions hung at 25-26h, no error logs.
          //
          // Now: log loudly on missing engine. For the specific "engine doesn't
          // know about this position" case (which is an internal-state-desync,
          // NOT a real-exchange-failure), fall back to a direct DB UPDATE since
          // the IEM has the position state and there's no exchange-side position
          // to leak with paper trades. For real engine errors (network, exchange
          // API), keep the Phase 46 retry+escalate behavior.
          let symbol = 'BTC-USD';
          if (this.tradingEngine) {
            try {
              const positions = this.tradingEngine.getPositions();
              const found = positions.find((p: any) => p.id === positionId);
              if (found?.symbol) symbol = found.symbol;
            } catch { /* engine.getPositions edge-case — keep default */ }
          }

          // Always look up real symbol from DB so price+fallback don't depend on engine state
          let dbSymbol: string | null = null;
          let dbExchange: string | null = null;
          let dbCurrentPrice: number = 0;
          let dbUnrealizedPnL: number = 0;
          let dbPositionRowId: number | null = null;
          try {
            const { getDb } = await import('../db');
            const db = await getDb();
            if (db) {
              const { paperPositions } = await import('../../drizzle/schema');
              const { eq, and } = await import('drizzle-orm');
              const numericId = Number(positionId);
              const rows = isFinite(numericId)
                ? await db.select().from(paperPositions).where(and(eq(paperPositions.id, numericId), eq(paperPositions.status, 'open'))).limit(1)
                : [];
              if (rows.length > 0) {
                dbSymbol = rows[0].symbol;
                dbExchange = rows[0].exchange || 'binance';
                dbCurrentPrice = parseFloat(rows[0].currentPrice || rows[0].entryPrice || '0');
                dbUnrealizedPnL = parseFloat(rows[0].unrealizedPnL || '0');
                dbPositionRowId = rows[0].id;
                if (dbSymbol) symbol = dbSymbol;
              }
            }
          } catch (dbLookupErr) {
            console.warn(`[UserTradingSession] DB lookup for ${positionId} failed:`, (dbLookupErr as Error)?.message);
          }

          const priceData = priceFeedService.getLatestPrice(symbol);
          const price = priceData?.price || dbCurrentPrice || 0;

          if (!this.tradingEngine) {
            console.warn(`[UserTradingSession] executeExit(${positionId}, ${reason}): tradingEngine is null — falling back to direct DB close`);
            await this.directDbClosePosition(positionId, dbPositionRowId, price, dbUnrealizedPnL, `engine_null:${reason}`, symbol);
            return;
          }

          if (price <= 0) {
            console.warn(`[UserTradingSession] executeExit(${positionId}, ${reason}): no usable price (feed=${priceData?.price ?? 'n/a'} db=${dbCurrentPrice}) — emitting exit_failed`);
            this.emit('exit_failed', { positionId, reason, attempts: 0, maxAttempts: this.MAX_EXIT_RETRIES, error: 'no_price', symbol });
            return;
          }

          let closedViaEngine = false;
          let engineErrMsg: string | undefined;
          try {
            await this.tradingEngine.closePositionById(positionId, price, `exit:${reason}`);
            closedViaEngine = true;
          } catch (engineErr) {
            engineErrMsg = (engineErr as Error)?.message;
            console.warn(`[UserTradingSession] tradingEngine.closePositionById failed for ${positionId}:`, engineErrMsg);
          }

          if (closedViaEngine) {
            this.exitRetryCount.delete(positionId);
            this.emit('exit_executed', { positionId, reason, price, symbol });
            return;
          }

          // Engine refused to close. Distinguish two failure modes:
          //   A) "Position not found" → engine's in-memory map doesn't have it.
          //      This is internal state desync (e.g. positions persisted before a
          //      restart that never re-loaded into the engine, or Phase 31 dedup
          //      reaped a duplicate, or the engine was re-instantiated mid-flight).
          //      No real exchange-side close to leak — direct-DB close is correct.
          //   B) Anything else → real exchange/network failure. Stick with Phase 46
          //      retry+escalate so we don't booking-close while the exchange
          //      position is still live.
          const isStateDesync = !!engineErrMsg && /not found/i.test(engineErrMsg);
          if (isStateDesync) {
            console.warn(`[UserTradingSession] Engine state desync for ${positionId} (${engineErrMsg}) — falling back to direct DB close`);
            await this.directDbClosePosition(positionId, dbPositionRowId, price, dbUnrealizedPnL, `engine_desync:${reason}`, symbol);
            this.exitRetryCount.delete(positionId);
            return;
          }

          // Real engine failure → Phase 46 retry+escalate.
          const attempts = (this.exitRetryCount.get(positionId) || 0) + 1;
          this.exitRetryCount.set(positionId, attempts);
          console.error(`[UserTradingSession] ⚠️ Exit attempt ${attempts}/${this.MAX_EXIT_RETRIES} failed for ${positionId}; DB will NOT be marked closed.`);
          this.emit('exit_failed', {
            positionId,
            reason,
            attempts,
            maxAttempts: this.MAX_EXIT_RETRIES,
            error: engineErrMsg,
            symbol,
          });
          if (attempts < this.MAX_EXIT_RETRIES) {
            setTimeout(() => this.retryExit(positionId, quantity, reason), 2000);
          } else {
            console.error(`[UserTradingSession] 🚨 EMERGENCY: exit for ${positionId} exhausted ${this.MAX_EXIT_RETRIES} retries — escalating.`);
            this.emit('exit_emergency_alert', {
              positionId,
              reason,
              attempts,
              symbol,
              userId: this.userId,
            });
          }
        },
        getMarketRegime: async (symbol: string) => {
          // Phase 37 FIX: Wire to actual MarketRegimeAI instead of hardcoded 'normal'
          // Phase 41 FIX: Use getMarketContext (cached) instead of non-existent getLatestRegime
          try {
            const { getMarketRegimeAI } = await import('./MarketRegimeAI');
            const regimeAI = getMarketRegimeAI();
            const context = await regimeAI.getMarketContext(symbol);
            if (context?.regime) {
              return context.regime;
            }
          } catch { /* fallback to default */ }
          return 'range_bound'; // Safer default than 'normal' — conservative exits
        },
      });

      // Wire signal processor -> trade executor + forward events to EngineAdapter
      // Phase 19: Wrap async handler in try/catch to prevent unhandled rejections
      this.signalProcessor.on('signal_approved', async (signal: any) => {
        // Forward to EngineAdapter listeners (PriceFeedService -> Socket.IO -> frontend)
        this.emit('signal_approved', signal);
        try {
          if (!this.autoTradingEnabled) return;
          if (this.tradeExecutor) {
            // Phase 30: DecisionEvaluator pre-execution quality gate
            const evaluator = getDecisionEvaluator(this.userId);
            const evaluation = evaluator.evaluate(
              signal.consensus,
              signal.signals || [],
              signal.symbol,
              signal.marketContext
            );

            if (!evaluation.approved) {
              console.log(`[UserTradingSession] DecisionEvaluator REJECTED ${signal.symbol}: ${evaluation.reasons.join('; ')}`);

              // Phase 35: Agent re-trigger on rejection
              // Instead of just logging and returning, attempt to re-run relevant agents
              // with refined questions targeting the weak evaluation factor
              try {
                const retriggerService = getAgentRetriggerService();
                const retriggerResult = await retriggerService.attemptRetrigger(
                  signal.symbol,
                  signal.signals || [],
                  signal.consensus,
                  evaluation,
                  signal.marketContext || undefined,
                  this.userId
                );

                if (retriggerResult.retriggered && retriggerResult.reEvaluation?.approved) {
                  // Re-trigger succeeded — use the updated signals and evaluation
                  console.log(`[UserTradingSession] ✅ Re-trigger RECOVERED ${signal.symbol} | Agents: ${retriggerResult.agentsRerun.join(', ')} | New score: ${(retriggerResult.reEvaluation.score * 100).toFixed(1)}%`);
                  // Update signal with re-triggered data
                  signal.signals = retriggerResult.updatedSignals;
                  signal.evaluationScore = retriggerResult.reEvaluation.score;
                  signal.evaluationWarnings = retriggerResult.reEvaluation.warnings;
                  signal.retriggerRecovered = true;
                  // Apply position size adjustment from re-evaluation
                  if (signal.consensus && retriggerResult.reEvaluation.adjustments.positionSizeMultiplier !== 1.0) {
                    signal.consensus.positionSize = (signal.consensus.positionSize || 0.05) * retriggerResult.reEvaluation.adjustments.positionSizeMultiplier;
                  }
                  // Fall through to continue with trade execution below
                } else {
                  // Re-trigger failed or wasn't attempted — reject as before
                  this.totalTradesRejected++;
                  this.emit('signal_rejected', {
                    symbol: signal.symbol,
                    reason: `DecisionEvaluator: ${evaluation.reasons[0]}`,
                    evaluationScore: evaluation.score,
                    warnings: evaluation.warnings,
                    retriggerAttempted: retriggerResult.retriggered,
                    retriggerReason: retriggerResult.reason,
                  });
                  return;
                }
              } catch (retriggerErr) {
                console.warn(`[UserTradingSession] Re-trigger error for ${signal.symbol}:`, (retriggerErr as Error)?.message);
                // Fall back to normal rejection
                this.totalTradesRejected++;
                this.emit('signal_rejected', {
                  symbol: signal.symbol,
                  reason: `DecisionEvaluator: ${evaluation.reasons[0]}`,
                  evaluationScore: evaluation.score,
                  warnings: evaluation.warnings,
                });
                return;
              }
            }

            // Log warnings even for approved signals
            if (evaluation.warnings.length > 0) {
              console.log(`[UserTradingSession] DecisionEvaluator warnings for ${signal.symbol}: ${evaluation.warnings.join('; ')}`);
            }

            // Apply position size adjustment from evaluator
            if (signal.consensus && evaluation.adjustments.positionSizeMultiplier !== 1.0) {
              signal.consensus.positionSize = (signal.consensus.positionSize || 0.05) * evaluation.adjustments.positionSizeMultiplier;
            }

            // Attach evaluation metadata to signal for downstream tracking
            signal.evaluationScore = evaluation.score;
            signal.evaluationWarnings = evaluation.warnings;

            // Phase 35: Monte Carlo simulation replaces formula-based ScenarioEngine
            // Runs N random-walk simulations for probabilistic outcome projection
            try {
              const direction = signal.consensus?.direction === 'bullish' ? 'long' : 'short';
              const currentPrice = signal.consensus?.entryPrice || signal.price || 0;
              const regime = signal.marketContext?.regime || 'range_bound';
              const atrPercent = signal.marketContext?.volatility || undefined;

              // Run Monte Carlo simulation (500 paths)
              const mcSimulator = getMonteCarloSimulator();
              const mcResult = mcSimulator.simulate(
                currentPrice,
                direction as 'long' | 'short',
                regime,
                signal.consensus?.strength || 0.5,
                atrPercent
              );

              // Convert to ScenarioProjection format for backward compatibility
              const projection = mcSimulator.toScenarioProjection(
                mcResult,
                currentPrice,
                direction as 'long' | 'short',
                regime
              );

              // Attach both Monte Carlo result and projection to signal
              signal.scenarioProjection = projection;
              signal.monteCarloResult = {
                probabilityOfProfit: mcResult.probabilityOfProfit,
                expectedReturn: mcResult.expectedReturn,
                valueAtRisk95: mcResult.valueAtRisk95,
                conditionalVaR95: mcResult.conditionalVaR95,
                p10: mcResult.p10,
                p50: mcResult.p50,
                p90: mcResult.p90,
                sharpeRatio: mcResult.sharpeRatio,
                optimalExitStep: mcResult.optimalExitStep,
                maxDrawdown: mcResult.maxDrawdown,
              };

              // Use Monte Carlo-based stop-loss and take-profit
              if (signal.consensus) {
                if (!signal.consensus.stopLoss || projection.suggestedStopLoss) {
                  signal.consensus.suggestedStopLoss = projection.suggestedStopLoss;
                }
                if (!signal.consensus.takeProfit || projection.suggestedTakeProfit) {
                  signal.consensus.suggestedTakeProfit = projection.suggestedTakeProfit;
                }
                signal.consensus.riskRewardRatio = projection.riskRewardRatio;
                signal.consensus.expectedValue = projection.expectedValue;
              }

              console.log(`[UserTradingSession] MonteCarlo: ${signal.symbol} ${direction} | P(profit)=${(mcResult.probabilityOfProfit * 100).toFixed(0)}% | EV=${mcResult.expectedReturn}% | VaR95=${mcResult.valueAtRisk95}% | P10/P50/P90: ${mcResult.p10}%/${mcResult.p50}%/${mcResult.p90}% | Sharpe=${mcResult.sharpeRatio}`);

              // Also run formula-based ScenarioEngine as fallback/comparison
              try {
                const scenarioEngine = getScenarioEngine();
                const formulaProjection = scenarioEngine.project(
                  currentPrice,
                  direction as 'long' | 'short',
                  signal.consensus?.strength || 0.5,
                  regime,
                  atrPercent ? { atrPercent } : undefined,
                  evaluation.score
                );
                signal.formulaProjection = formulaProjection;
              } catch { /* formula fallback non-critical */ }
            } catch (err) {
              console.warn(`[UserTradingSession] MonteCarlo error, falling back to ScenarioEngine:`, (err as Error)?.message);
              // Fallback to formula-based ScenarioEngine
              try {
                const scenarioEngine = getScenarioEngine();
                const direction = signal.consensus?.direction === 'bullish' ? 'long' : 'short';
                const currentPrice = signal.consensus?.entryPrice || signal.price || 0;
                const projection = scenarioEngine.project(
                  currentPrice,
                  direction as 'long' | 'short',
                  signal.consensus?.strength || 0.5,
                  signal.marketContext?.regime || 'range_bound',
                  signal.marketContext?.volatility ? { atrPercent: signal.marketContext.volatility } : undefined,
                  evaluation.score
                );
                signal.scenarioProjection = projection;
              } catch { /* both failed, continue without projection */ }
            }

            await this.tradeExecutor.queueSignal(signal);
          }
        } catch (err) {
          console.error(`[UserTradingSession] Signal queue failed for user ${this.userId}:`, (err as Error)?.message);
        }
      });
      this.signalProcessor.on('signal_rejected', (signal: any) => {
        this.totalTradesRejected++;
        // Forward to EngineAdapter listeners
        this.emit('signal_rejected', signal);
      });

      // Phase 37 FIX: Listen to tradingEngine position_opened (the ACTUAL position event)
      // Previously we tried to register from trade_executed which doesn't include position data.
      // The PaperTradingEngine emits position_opened with the full PaperPosition + dbPositionId.
      this.tradingEngine.on('position_opened', (posData: any) => {
        if (!this.exitManager) return;
        try {
          // Phase 40 FIX: Keep in-memory ID for position tracking (closePositionById needs it)
          // but pass dbPositionId separately so DB sync can update the correct row
          console.log(`[UserTradingSession] 📌 Position opened: ${posData.symbol} ${posData.side} @ $${posData.entryPrice} (memId: ${posData.id}, dbId: ${posData.dbPositionId})`);
          this.exitManager.addPosition({
            id: posData.id, // Keep in-memory ID — closePositionById needs this
            symbol: posData.symbol,
            side: posData.side || 'long',
            entryPrice: posData.entryPrice,
            currentPrice: posData.currentPrice || posData.entryPrice,
            quantity: posData.quantity,
            remainingQuantity: posData.quantity,
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            entryTime: posData.entryTime ? new Date(posData.entryTime).getTime() : Date.now(),
            originalConsensus: 0.65, // Will be updated by agent signals
            marketRegime: 'unknown', // Will be updated by getMarketRegime callback
            stopLoss: posData.stopLoss,
            takeProfit: posData.takeProfit,
            dbPositionId: posData.dbPositionId, // Phase 40: Store DB ID for DB sync
          });
          // Phase 46: IEM is now the source of truth for exits on this session.
          this.exitManagerActive = true;
        } catch (err) {
          console.warn(`[UserTradingSession] Failed to register position with exit manager:`, (err as Error)?.message);
        }
      });

      // Also listen to position_closed to clean up exit manager
      this.tradingEngine.on('position_closed', (closedData: any) => {
        if (!this.exitManager) return;
        try {
          // Remove from exit manager if it was closed externally (not by exit manager)
          if (closedData.id || closedData.positionId) {
            this.exitManager.removePosition(String(closedData.id || closedData.positionId));
          }
        } catch { /* non-critical */ }
      });

      // Wire trade executor events
      this.tradeExecutor.on('trade_executed', (data: any) => {
        this.totalTradesExecuted++;
        this.lastTradeExecutedMs = Date.now();
        this.emit('trade_executed', data);

        // Record agent accuracy for weight adjustment
        this.recordTradeForWeightAdjustment(data);

        // Phase 30: Record trade entry in DecisionEvaluator for outcome tracking
        try {
          const evaluator = getDecisionEvaluator(this.userId);
          // Phase 30 — entry price plumbing fix.
          // EnhancedTradeExecutor.emit('trade_executed', ...) does NOT include
          // a top-level `price` field. The actual fill price lives on
          // data.order.filledPrice. Pre-Phase-30-fix the entry was recorded
          // with $0.00 (visible in logs as "entry recorded: ETH-USD long @
          // $0.00"), making any downstream slippage/return analysis useless.
          const entryPriceResolved =
            (typeof data.order?.filledPrice === 'number' && data.order.filledPrice > 0
              ? data.order.filledPrice
              : (typeof data.price === 'number' && data.price > 0
                  ? data.price
                  : (typeof data.entryPrice === 'number' && data.entryPrice > 0
                      ? data.entryPrice
                      : 0)));
          evaluator.recordTradeEntry(
            data.symbol,
            data.side || (data.signal?.consensus?.direction === 'bullish' ? 'long' : 'short'),
            entryPriceResolved,
            data.signal?.consensus,
            data.signal?.signals || [],
            data.entryRegime || 'unknown',
            data.signal?.evaluationScore || 0.5,
            data.signal?.signalId
          );
        } catch (err) {
          console.warn(`[UserTradingSession] Failed to record trade entry in DecisionEvaluator:`, (err as Error)?.message);
        }
      });

      this.tradeExecutor.on('trade_rejected', (data: any) => {
        this.totalTradesRejected++;
        this.emit('trade_rejected', data);
      });

      this.tradeExecutor.on('exit_executed', (data: any) => {
        this.emit('exit_executed', data);

        // Phase 30 (revised): The exit_executed event from EnhancedTradeExecutor
        // carries pnlPercent/pnlAbsolute, but the IEM-driven exit path emits
        // exit_executed at line ~329 of this file WITHOUT pnl — and that's the
        // path the platform actually uses for stuck-position closes. Result:
        // recordTradeOutcome was getting called with pnl=0, which means
        // wasProfit=false for every trade. Agents whose direction matched the
        // (correctly profitable) trade got marked WRONG, agents whose direction
        // dissented got marked CORRECT. Pre-Phase-30 the post-trade feedback
        // loop was actively MIS-training the platform.
        //
        // The fix below (the position_closed listener) is the canonical
        // feedback trigger — PaperTradingEngine emits position_closed with the
        // real realized pnl. We forward to DecisionEvaluator from there. The
        // exit_executed-side recordTradeOutcome is removed so we don't
        // double-count.
      });

      // Phase 30 — canonical feedback-loop trigger.
      // PaperTradingEngine.closePosition emits position_closed with REAL
      // realized pnl, regardless of which exit path produced the close (IEM,
      // ScenarioEngine, manual). Listening here is the single point where
      // trade outcomes flow into AgentWeightManager.
      try {
        this.tradingEngine.on('position_closed', (closedData: any) => {
          const position = closedData?.position;
          const pnl = closedData?.pnl ?? 0;
          const exitPrice = position?.exitPrice ?? position?.currentPrice ?? 0;
          if (!position?.symbol) return;
          try {
            const evaluator = getDecisionEvaluator(this.userId);
            evaluator
              .recordTradeOutcome(position.symbol, pnl, exitPrice, position.exitReason || 'engine_close')
              .catch((err: Error) => {
                console.warn(`[UserTradingSession] feedback recordTradeOutcome failed:`, err?.message);
              });
          } catch (err) {
            console.warn(`[UserTradingSession] Phase 30 feedback wiring error:`, (err as Error)?.message);
          }
        });
        console.log(`[UserTradingSession] 🔁 Post-trade feedback loop wired (position_closed → DecisionEvaluator → AgentWeightManager)`);
      } catch (wireErr) {
        console.warn(`[UserTradingSession] Failed to wire position_closed feedback listener:`, (wireErr as Error)?.message);
      }

      // Start exit manager
      this.exitManager.start();

      // Phase 21: Sync existing open positions into IntelligentExitManager
      // Without this, the exit manager starts empty on every restart and never
      // monitors/closes positions that were opened before the restart.
      try {
        const { getDb: getDbExit } = await import('../db');
        const dbForExit = await getDbExit();
        if (dbForExit) {
          const { eq: eqE, and: andE } = await import('drizzle-orm');
          const { paperPositions: ppE } = await import('../../drizzle/schema');
          const existingForExit = await dbForExit
            .select()
            .from(ppE)
            .where(andE(
              eqE(ppE.userId, this.userId),
              eqE(ppE.status, 'open')
            ));

          for (const pos of existingForExit) {
            try {
              const entryPrice = parseFloat(pos.entryPrice || '0');
              const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice || '0');
              const quantity = parseFloat(pos.quantity || '0');
              if (entryPrice <= 0 || quantity <= 0) continue;
              this.exitManager.addPosition({
                id: String(pos.id),
                symbol: pos.symbol,
                side: (pos.side === 'short' ? 'short' : 'long') as 'long' | 'short',
                entryPrice,
                currentPrice,
                quantity,
                remainingQuantity: quantity,
                unrealizedPnl: parseFloat(pos.unrealizedPnL || '0'),
                unrealizedPnlPercent: parseFloat(pos.unrealizedPnLPercent || '0'),
                entryTime: pos.entryTime ? new Date(pos.entryTime).getTime() : Date.now(),
                originalConsensus: parseFloat(pos.originalConsensus || '0.65'),
                marketRegime: 'unknown',
                // Phase 32: TP/SL from DB if available
                stopLoss: (pos as any).stopLoss ? parseFloat((pos as any).stopLoss) : undefined,
                takeProfit: (pos as any).takeProfit ? parseFloat((pos as any).takeProfit) : undefined,
                // Phase 40: Store DB ID for sync (numeric string ID will also parseInt correctly)
                dbPositionId: pos.id,
              });
            } catch (addErr) {
              console.warn(`[UserTradingSession] Failed to add position ${pos.id} to exit manager:`, (addErr as Error)?.message);
            }
          }
          if (existingForExit.length > 0) {
            console.log(`[UserTradingSession] Synced ${existingForExit.length} existing positions into exit manager for user ${this.userId}`);
            // Phase 46: IEM now owns exits for the synced positions.
            this.exitManagerActive = true;
          }
        }
      } catch (exitSyncErr) {
        console.warn(`[UserTradingSession] Failed to sync positions into exit manager:`, (exitSyncErr as Error)?.message);
      }

      // Start settings sync loop
      this.startSettingsSync();

      // Phase 40 CRITICAL FIX: Wire price feed to exit manager
      // Without this, the exit manager NEVER receives price updates, so SL/TP never trigger
      // and positions sit as zombies with currentPrice = entryPrice forever.
      try {
        const { priceFeedService } = await import('./priceFeedService');
        this.priceUpdateHandler = (priceData: { symbol: string; price: number }) => {
          if (this.exitManager && this.isRunning) {
            this.exitManager.onPriceTick(priceData.symbol, priceData.price).catch(() => {});
          }
        };
        priceFeedService.on('price_update', this.priceUpdateHandler);
        console.log(`[UserTradingSession] 🔗 Price feed wired to exit manager for user ${this.userId}`);
      } catch (priceErr) {
        console.error(`[UserTradingSession] Failed to wire price feed to exit manager:`, (priceErr as Error)?.message);
      }

      // Phase 40 FIX: Periodic paper position price update in DB
      // Without this, paper positions show stale prices in the UI because
      // PaperTradingEngine.updatePositionPrices() was never called periodically.
      this.paperPriceUpdateInterval = setInterval(async () => {
        try {
          const { getDb } = await import('../db');
          const { paperPositions } = await import('../../drizzle/schema');
          const { eq, and } = await import('drizzle-orm');
          const db = await getDb();
          if (!db) return;

          const openPositions = await db
            .select()
            .from(paperPositions)
            .where(and(
              eq(paperPositions.userId, this.userId),
              eq(paperPositions.status, 'open')
            ));

          for (const pos of openPositions) {
            const priceData = priceFeedService.getLatestPrice(pos.symbol);
            if (!priceData?.price) continue;

            const currentPrice = priceData.price;
            const entryPrice = parseFloat(pos.entryPrice || '0');
            const quantity = parseFloat(pos.quantity || '0');
            if (entryPrice <= 0 || quantity <= 0) continue;

            const pnlMultiplier = pos.side === 'long' ? 1 : -1;
            const unrealizedPnL = pnlMultiplier * (currentPrice - entryPrice) * quantity;
            const unrealizedPnLPercent = pnlMultiplier * ((currentPrice - entryPrice) / entryPrice) * 100;

            // HARD STOP-LOSS & TAKE-PROFIT SAFETY NET
            // Tuned for crypto volatility and >80% win rate target:
            // - Wider stop-loss (0.8%) to avoid noise-triggered exits
            // - Lower take-profit (0.4%) for faster profit-taking
            // - Trailing stop: once profit exceeds 0.15%, trail at 50% of peak
            // - Shorter max hold (15 min) to avoid regime changes
            // Phase 45 FIX: Widened safety exit parameters to let PriorityExitManager handle exits.
            // Previous values caused premature exits: 15min time_exit killed 6/20 recent trades at a loss.
            // The PriorityExitManager has smarter regime-aware exits — these are LAST RESORT safety nets only.
            // Phase 46 FIX: Safety-net TP raised to 2.5% to avoid race with IntelligentExitManager
            // partial-exit grid (0.5/1.0/1.5/2.0%). Hard-stop stays at -1.5% as absolute floor.
            const HARD_STOP_LOSS_PERCENT = -1.5;  // Phase 45: widened from -0.8% — let ATR stop handle normal exits
            const TAKE_PROFIT_PERCENT = 2.5;      // Phase 46: raised from 1.0% — above IEM full-close trigger, prevents collision
            const MAX_HOLD_MINUTES = 45;           // Phase 45: raised from 15min — PriorityExitManager handles time-based exits
            const TRAILING_ACTIVATION = 0.30;      // Phase 45: raised from 0.15% — avoid locking in tiny profits
            const TRAILING_RATIO = 0.40;           // Phase 45: tightened from 0.50 — keep 60% of peak profit

            const holdTimeMinutes = pos.entryTime ? (Date.now() - new Date(pos.entryTime).getTime()) / 60000 : 0;
            let shouldClose = false;
            let closeReason = '';

            // Track peak PnL for trailing stop
            const peakKey = `peak_${pos.id}`;
            const prevPeak = (this as any)[peakKey] || 0;
            const currentPeak = Math.max(prevPeak, unrealizedPnLPercent);
            (this as any)[peakKey] = currentPeak;

            // Phase 46: When IntelligentExitManager is wired, it owns exits. Safety-net only runs
            // as fallback if IEM is unavailable or disabled. Skip exit evaluation entirely and
            // fall through to the DB price-sync update below.
            if (this.exitManagerActive === true) {
              // Only run DB-sync path, skip exit evaluation
              // (continues to the `await db.update(...)` for currentPrice / unrealizedPnL below)
            } else if (unrealizedPnLPercent <= HARD_STOP_LOSS_PERCENT) {
              shouldClose = true;
              closeReason = `hard_stop_loss:${unrealizedPnLPercent.toFixed(3)}%`;
            } else if (unrealizedPnLPercent >= TAKE_PROFIT_PERCENT) {
              shouldClose = true;
              closeReason = `take_profit:${unrealizedPnLPercent.toFixed(3)}%`;
            } else if (currentPeak >= TRAILING_ACTIVATION && unrealizedPnLPercent < currentPeak * TRAILING_RATIO) {
              // Trailing stop: if we reached +0.15% but now dropped to less than 50% of peak
              shouldClose = true;
              closeReason = `trailing_stop:peak=${currentPeak.toFixed(3)}%,now=${unrealizedPnLPercent.toFixed(3)}%`;
            } else if (holdTimeMinutes >= MAX_HOLD_MINUTES && unrealizedPnLPercent < 0.05) {
              // Time exit: close if held too long without meaningful profit
              shouldClose = true;
              closeReason = `time_exit:${holdTimeMinutes.toFixed(0)}min,pnl=${unrealizedPnLPercent.toFixed(3)}%`;
            }

            // PRIME DIRECTIVE: ProfitLockGuard — only exit in profit unless catastrophic.
            // The `hard_stop_loss` branch below -2.5% gross still bypasses via the guard's
            // catastrophic-floor check. All other safety-net closes need net-positive PnL.
            if (shouldClose) {
              const guard = profitLockShouldAllowClose(
                {
                  side: pos.side as 'long' | 'short',
                  entryPrice,
                  exchange: (pos as any).exchange, // Phase 10 — pick up DB exchange for fee-aware drag
                },
                currentPrice,
                closeReason,
              );
              if (!guard.allow) {
                console.log(
                  `[UserTradingSession] 🛡️ SAFETY EXIT BLOCKED by ProfitLockGuard #${pos.id} ${pos.symbol} ${pos.side}: ` +
                  `${guard.reason} | gross=${guard.grossPnlPercent.toFixed(3)}% net=${guard.netPnlPercent.toFixed(3)}% ` +
                  `(was: ${closeReason})`
                );
                shouldClose = false;
                closeReason = '';
              }
            }

            if (shouldClose) {
              // ✅ FIX: Use correct property name 'realizedPnl' (lowercase 'l') matching Drizzle schema
              await db.update(paperPositions).set({
                status: 'closed',
                exitPrice: currentPrice.toString(),
                exitTime: new Date(),
                realizedPnl: unrealizedPnL.toFixed(8),  // FIX: was 'realizedPnL' (wrong case)
                currentPrice: currentPrice.toString(),
                unrealizedPnL: '0',
                unrealizedPnLPercent: '0',
                exitReason: closeReason,
                updatedAt: new Date(),
              }).where(eq(paperPositions.id, pos.id));
              console.log(`[UserTradingSession] 🚨 SAFETY EXIT #${pos.id} ${pos.symbol} ${pos.side}: ${closeReason} | PnL=$${unrealizedPnL.toFixed(4)}`);

              // ✅ FIX: Update wallet balance with realized PnL
              try {
                if (this.tradingEngine) {
                  const wallet = this.tradingEngine.getWallet();
                  if (wallet) {
                    wallet.balance += unrealizedPnL;
                    wallet.realizedPnL += unrealizedPnL;
                    wallet.totalPnL += unrealizedPnL;
                    if (unrealizedPnL > 0) wallet.winningTrades++;
                    else wallet.losingTrades++;
                    const totalTrades = wallet.winningTrades + wallet.losingTrades;
                    wallet.winRate = totalTrades > 0 ? (wallet.winningTrades / totalTrades) * 100 : 0;
                  }
                }
              } catch { /* non-critical */ }

              // ✅ FIX: Remove from PaperTradingEngine in-memory map WITHOUT re-closing via closePositionById
              // (closePositionById would overwrite the DB record and create a race condition)
              try {
                if (this.tradingEngine) {
                  const positions = this.tradingEngine.getPositions();
                  const memPos = positions.find((p: any) => p.symbol === pos.symbol && p.userId === this.userId);
                  if (memPos) {
                    // Remove from in-memory map directly to avoid double-close
                    const posKey = `${pos.symbol}_${pos.exchange || 'coinbase'}`;
                    (this.tradingEngine as any).positions?.delete(posKey);
                  }
                }
              } catch { /* non-critical */ }

              // Emit position_closed event for UI updates
              try {
                if (this.tradingEngine) {
                  this.tradingEngine.emit('position_closed', {
                    symbol: pos.symbol,
                    side: pos.side,
                    exitPrice: currentPrice,
                    realizedPnL: unrealizedPnL,
                    exitReason: closeReason,
                  });
                }
              } catch { /* non-critical */ }

              continue; // Skip the price update since position is now closed
            }

            await db.update(paperPositions).set({
              currentPrice: currentPrice.toString(),
              unrealizedPnL: unrealizedPnL.toString(),
              unrealizedPnLPercent: unrealizedPnLPercent.toString(),
              updatedAt: new Date(),
            }).where(eq(paperPositions.id, pos.id));
          }
        } catch (err) {
          // Non-critical — don't crash the session for price display updates
        }
      }, this.PAPER_PRICE_UPDATE_INTERVAL_MS);
      console.log(`[UserTradingSession] 📊 Paper position price updater started (every ${this.PAPER_PRICE_UPDATE_INTERVAL_MS / 1000}s) for user ${this.userId}`);

      this.isRunning = true;
      console.log(`[UserTradingSession] ✅ Session initialized for user ${this.userId} (auto-trade: ${this.autoTradingEnabled}, symbols: ${Array.from(this.subscribedSymbols).join(', ')})`);
    } catch (err) {
      console.error(`[UserTradingSession] Failed to initialize session for user ${this.userId}:`, (err as Error)?.message);
      throw err;
    }
  }

  /**
   * Handle incoming global signals from GlobalMarketEngine.
   * This is the main entry point — called by UserSessionManager when signals arrive.
   */
  async onGlobalSignals(symbol: string, signals: GlobalSignal[], marketContext?: any): Promise<void> {
    // Skip if symbol not in user's subscribed symbols
    if (!this.subscribedSymbols.has(symbol)) return;

    // Skip if auto-trading is disabled (signals are still available for dashboard display)
    if (!this.autoTradingEnabled) return;

    // Skip if session not fully initialized
    if (!this.signalProcessor || !this.isRunning) return;

    this.lastSignalProcessedMs = Date.now();

    try {
      // Apply per-user agent weights
      const weightedSignals = this.applyUserWeights(signals);

      // Feed to signal processor for consensus and trade decision
      // Phase 30: Pass market context for regime-aware consensus
      await this.signalProcessor.processSignals(weightedSignals, symbol, marketContext);
    } catch (err) {
      console.error(`[UserTradingSession] Signal processing error for user ${this.userId}:`, (err as Error)?.message);
    }
  }

  /**
   * Handle price tick for exit manager.
   * Called by UserSessionManager when new prices arrive.
   */
  async onPriceTick(symbol: string, price: number): Promise<void> {
    if (!this.exitManager || !this.isRunning) return;

    try {
      await this.exitManager.onPriceTick(symbol, price);
    } catch {
      // Non-critical — exit manager handles its own errors
    }
  }

  /**
   * Apply per-user agent weights to raw global signals.
   * Transforms GlobalSignal[] to weighted AgentSignal[] format.
   */
  private applyUserWeights(signals: GlobalSignal[]): any[] {
    if (!this.weightManager) return signals;

    const consensusWeights = this.weightManager.getConsensusWeights();

    return signals.map(signal => {
      const userWeight = consensusWeights[signal.agentName] || 1.0;

      return {
        agentName: signal.agentName,
        signal: signal.signal,
        // Phase 40 FIX: Do NOT multiply confidence by weight — confidence is the agent's
        // own assessment of signal quality. The weight field controls the agent's influence
        // in consensus calculation. Multiplying destroyed confidence (95% * 0.3 = 28.5%)
        // causing ALL signals to fail the 35% confidence filter.
        confidence: signal.confidence,
        strength: signal.strength,
        reasoning: signal.reasoning,
        qualityScore: signal.qualityScore,
        evidence: signal.evidence,
        timestamp: signal.timestamp,
        weight: userWeight,
        isSyntheticData: false,
      };
    });
  }

  /**
   * Record trade outcome for agent weight adjustment.
   */
  private recordTradeForWeightAdjustment(tradeData: any): void {
    if (!this.weightManager) return;

    try {
      // Non-blocking — weight adjustment is background work
      import('./AgentWeightManager').then(({ getAgentWeightManager }) => {
        const wm = getAgentWeightManager(this.userId);
        // Trade outcome recording happens when position closes, not on entry
        // This is just to track which agents contributed to the entry
      }).catch(() => { /* non-critical */ });
    } catch {
      // Non-critical
    }
  }

  // ========================================
  // Settings sync
  // ========================================

  private startSettingsSync(): void {
    this.settingsSyncInterval = setInterval(async () => {
      await this.syncSettings();
    }, this.SETTINGS_SYNC_INTERVAL_MS);

    if (this.settingsSyncInterval.unref) {
      this.settingsSyncInterval.unref();
    }
  }

  /**
   * Sync session settings from database.
   * Called periodically and after user changes settings via UI.
   */
  async syncSettings(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { tradingModeConfig, tradingSymbols } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      // Get trading mode config
      const modeResult = await db.select().from(tradingModeConfig)
        .where(eq(tradingModeConfig.userId, this.userId))
        .limit(1);

      if (modeResult.length > 0) {
        const config = modeResult[0];
        this.autoTradingEnabled = config.autoTradeEnabled ?? false;
        this.tradingMode = (config.mode as 'paper' | 'real') || 'paper';
      }

      // Get user's subscribed symbols
      const symbolResult = await db.select().from(tradingSymbols)
        .where(and(eq(tradingSymbols.userId, this.userId), eq(tradingSymbols.isActive, true)));

      if (symbolResult.length > 0) {
        this.subscribedSymbols = new Set(symbolResult.map(s => s.symbol));
      }
    } catch (err) {
      // Non-critical — use existing settings
    }
  }

  // ========================================
  // Public API
  // ========================================

  getUserId(): number {
    return this.userId;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  isAutoTradingEnabled(): boolean {
    return this.autoTradingEnabled;
  }

  getTradingMode(): 'paper' | 'real' {
    return this.tradingMode;
  }

  /**
   * Get session status for health dashboards and API.
   */
  getStatus(): UserTradingSessionStatus {
    const wallet = this.tradingEngine?.getWallet();
    const positions = this.tradingEngine?.getPositions() || [];

    return {
      userId: this.userId,
      isRunning: this.isRunning,
      autoTradingEnabled: this.autoTradingEnabled,
      tradingMode: this.tradingMode,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      positionCount: positions.length,
      lastSignalProcessed: this.lastSignalProcessedMs,
      lastTradeExecuted: this.lastTradeExecutedMs,
      totalTradesExecuted: this.totalTradesExecuted,
      totalTradesRejected: this.totalTradesRejected,
      walletBalance: wallet?.balance || 0,
      exitManagerActive: this.exitManager?.isMonitoringActive() || false,
    };
  }

  /**
   * Get user's positions (for API).
   */
  getPositions(): any[] {
    return this.tradingEngine?.getPositions() || [];
  }

  /**
   * Get user's wallet (for API).
   */
  getWallet(): any {
    return this.tradingEngine?.getWallet() || null;
  }

  /**
   * Get user's trade history (for API).
   */
  getTradeHistory(): any[] {
    return this.tradingEngine?.getTradeHistory() || [];
  }

  /**
   * Phase 9 — Manual-close API path, guard-gated.
   *
   * Pre-Phase-9 the user-facing `closePosition` / `closeAllPositions` tRPC
   * endpoints called `EngineAdapter.closePosition`, which invoked
   * `wallet.closePosition(...)` — but `wallet` is a PaperWallet/RealWallet
   * plain data interface with no methods. The typeof-function check was
   * always false and the fallback emitted `manual_close_requested` which
   * nothing listens to. The API returned `{success:true}` while the
   * position stayed open — silent functional failure that could drive
   * capital-allocation bugs (user double-commits thinking a prior
   * position is gone).
   *
   * Phase 9 wires manual closes through the real engine AND through
   * `ProfitLockGuard.shouldAllowClose` so the prime-directive net-profit
   * floor applies to user-initiated exits too. If you need to bypass
   * the floor for a true emergency, pass a reason containing one of the
   * catastrophic patterns (`manual_override_...`) — that matches the
   * guard's bypass list by design.
   *
   * Errors are thrown with structured codes so the API layer can
   * surface a clean 4xx/5xx:
   *   - `[SESSION_NOT_READY]` — trading engine not initialized
   *   - `[POSITION_NOT_FOUND]` — no open position with that id
   *   - `[PRICE_UNAVAILABLE]` — no valid live price for symbol
   *   - `[PROFIT_LOCK_BLOCKED]` — guard held the close (expected)
   *   - `[CLOSE_FAILED]` — engine-level close error (retryable)
   */
  async requestManualClose(
    positionId: string,
    reason: string = 'manual_close',
  ): Promise<{
    success: true;
    price: number;
    symbol: string;
    guardReason: string;
    netPnlPercent: number;
    grossPnlPercent: number;
  }> {
    if (!this.tradingEngine) {
      throw new Error('[SESSION_NOT_READY] Trading engine not initialized');
    }

    const positions = this.tradingEngine.getPositions();
    const position = positions.find((p: any) => p.id === positionId);
    if (!position) {
      throw new Error(
        `[POSITION_NOT_FOUND] No open position with id=${positionId}`,
      );
    }

    const symbol = position.symbol;
    const priceData = priceFeedService.getLatestPrice(symbol);
    const currentPrice = priceData?.price ?? 0;
    if (currentPrice <= 0) {
      throw new Error(
        `[PRICE_UNAVAILABLE] Cannot close ${symbol} — no valid live price`,
      );
    }

    const guard = profitLockShouldAllowClose(
      {
        side: position.side as 'long' | 'short',
        entryPrice: position.entryPrice,
        exchange: (position as any).exchange, // Phase 10 — fee drag is exchange-aware
      },
      currentPrice,
      reason,
    );

    if (!guard.allow) {
      console.log(
        `[UserTradingSession] 🛡️ MANUAL CLOSE BLOCKED by ProfitLockGuard pos=${positionId} ${symbol} ${position.side}: ` +
          `${guard.reason} | gross=${guard.grossPnlPercent.toFixed(3)}% net=${guard.netPnlPercent.toFixed(3)}%`,
      );
      const err = new Error(
        `[PROFIT_LOCK_BLOCKED] Manual close blocked: ${guard.reason}`,
      );
      (err as any).code = 'PROFIT_LOCK_BLOCKED';
      (err as any).guardReason = guard.reason;
      (err as any).grossPnlPercent = guard.grossPnlPercent;
      (err as any).netPnlPercent = guard.netPnlPercent;
      throw err;
    }

    // Guard allowed — execute via the engine. Phase 46 phantom-close prevention:
    // if the engine throws, we do NOT mutate the DB or emit exit_executed; the
    // API caller sees a structured error and can retry. We do NOT enter
    // automatic retry here — manual closes are driven by the caller, so we
    // surface the error and let them decide.
    let engineErrMsg: string | undefined;
    try {
      await this.tradingEngine.closePositionById(
        positionId,
        currentPrice,
        `manual:${reason}`,
      );
    } catch (engineErr) {
      engineErrMsg = (engineErr as Error)?.message;
    }

    if (engineErrMsg) {
      console.error(
        `[UserTradingSession] Manual close engine failure pos=${positionId}:`,
        engineErrMsg,
      );
      throw new Error(
        `[CLOSE_FAILED] Engine close failed for ${positionId}: ${engineErrMsg}`,
      );
    }

    // Clear any prior retry state (defensive — the IEM path may have retries queued).
    this.exitRetryCount.delete(positionId);
    this.emit('exit_executed', {
      positionId,
      reason: `manual:${reason}`,
      price: currentPrice,
      symbol,
    });

    console.log(
      `[UserTradingSession] ✅ MANUAL CLOSE pos=${positionId} ${symbol} ${position.side}: ` +
        `${guard.reason} | gross=${guard.grossPnlPercent.toFixed(3)}% net=${guard.netPnlPercent.toFixed(3)}%`,
    );

    return {
      success: true,
      price: currentPrice,
      symbol,
      guardReason: guard.reason,
      netPnlPercent: guard.netPnlPercent,
      grossPnlPercent: guard.grossPnlPercent,
    };
  }

  /**
   * Get agent weight configuration for this user.
   */
  getAgentWeights(): Record<string, number> {
    return this.weightManager?.getConsensusWeights() || {};
  }

  /**
   * Update a specific setting.
   */
  updateAutoTrading(enabled: boolean): void {
    this.autoTradingEnabled = enabled;
    console.log(`[UserTradingSession] User ${this.userId} auto-trading: ${enabled}`);
  }

  /**
   * Add a symbol to observation.
   */
  addSymbol(symbol: string): void {
    this.subscribedSymbols.add(symbol);
    console.log(`[UserTradingSession] User ${this.userId} added symbol: ${symbol}`);
  }

  /**
   * Remove a symbol from observation.
   */
  removeSymbol(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
    console.log(`[UserTradingSession] User ${this.userId} removed symbol: ${symbol}`);
  }

  /**
   * Phase 46: Retry a failed exit. Re-invokes the PaperTradingEngine close path
   * without mutating the DB directly — if the engine still fails, executeExit
   * is NOT re-entered here; instead we attempt closePositionById once more and
   * let the executeExit callback's own retry/escalation path own the rest by
   * emitting the same exit_failed/exit_emergency_alert signals.
   */
  private async retryExit(positionId: string, quantity: number, reason: string): Promise<void> {
    if (!this.isRunning || !this.tradingEngine) return;
    try {
      const positions = this.tradingEngine.getPositions();
      const position = positions.find((p: any) => p.id === positionId);
      const symbol = position?.symbol || 'BTC-USD';
      const priceData = priceFeedService.getLatestPrice(symbol);
      const price = priceData?.price || 0;
      if (price <= 0) {
        // Can't retry without price — schedule another attempt
        const attempts = this.exitRetryCount.get(positionId) || 0;
        if (attempts < this.MAX_EXIT_RETRIES) {
          setTimeout(() => this.retryExit(positionId, quantity, reason), 2000);
        }
        return;
      }

      try {
        await this.tradingEngine.closePositionById(positionId, price, `exit:${reason}:retry`);
        // Success — clear retry state
        this.exitRetryCount.delete(positionId);
        this.emit('exit_executed', { positionId, reason: `${reason}:retry`, price, symbol });
        console.log(`[UserTradingSession] ✅ Retry close succeeded for ${positionId}`);
      } catch (retryErr) {
        const attempts = (this.exitRetryCount.get(positionId) || 0) + 1;
        this.exitRetryCount.set(positionId, attempts);
        const msg = (retryErr as Error)?.message;
        console.error(`[UserTradingSession] ⚠️ Retry ${attempts}/${this.MAX_EXIT_RETRIES} failed for ${positionId}:`, msg);
        this.emit('exit_failed', {
          positionId,
          reason,
          attempts,
          maxAttempts: this.MAX_EXIT_RETRIES,
          error: msg,
          symbol,
        });
        if (attempts < this.MAX_EXIT_RETRIES) {
          setTimeout(() => this.retryExit(positionId, quantity, reason), 2000);
        } else {
          console.error(`[UserTradingSession] 🚨 EMERGENCY: exit for ${positionId} exhausted ${this.MAX_EXIT_RETRIES} retries — escalating.`);
          this.emit('exit_emergency_alert', {
            positionId,
            reason,
            attempts,
            symbol,
            userId: this.userId,
          });
        }
      }
    } catch (err) {
      console.error(`[UserTradingSession] retryExit threw:`, (err as Error)?.message);
    }
  }

  /**
   * Phase 54.2 — Direct paperPositions DB close, used as fallback when the
   * trading engine has lost track of a position (engine state desync) or
   * `this.tradingEngine` is null. Updates status='closed', stamps exitTime,
   * exitPrice, exitReason, and realizedPnl. Does NOT route through the
   * engine — only safe for paper trades where the row IS the source of
   * truth (no exchange-side position to leak).
   */
  private async directDbClosePosition(
    positionId: string,
    knownDbRowId: number | null,
    exitPrice: number,
    realizedPnL: number,
    exitReason: string,
    symbol: string,
  ): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) {
        console.error(`[UserTradingSession] directDbClosePosition: DB unavailable, can't close ${positionId}`);
        this.emit('exit_failed', { positionId, reason: exitReason, error: 'db_unavailable', symbol, attempts: 0, maxAttempts: this.MAX_EXIT_RETRIES });
        return;
      }
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const numericId = knownDbRowId ?? Number(positionId);
      if (!isFinite(numericId)) {
        console.error(`[UserTradingSession] directDbClosePosition: non-numeric positionId ${positionId}, skipping`);
        return;
      }
      const result = await db.update(paperPositions)
        .set({
          status: 'closed',
          exitPrice: exitPrice.toString(),
          exitTime: new Date(),
          exitReason: exitReason.slice(0, 64),
          realizedPnl: realizedPnL.toFixed(8),
          updatedAt: new Date(),
        })
        .where(and(
          eq(paperPositions.id, numericId),
          eq(paperPositions.status, 'open'),
        ));
      const affected = (result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0;
      if (affected > 0) {
        console.log(`[UserTradingSession] ✅ Direct DB close: ${symbol} id=${numericId} @ $${exitPrice} pnl=$${realizedPnL.toFixed(2)} reason=${exitReason}`);
        this.emit('exit_executed', { positionId, reason: exitReason, price: exitPrice, symbol, viaDirect: true });
      } else {
        // Already closed by some other path — that's a no-op success, not a failure.
        console.log(`[UserTradingSession] Direct DB close: id=${numericId} already not open (race or prior close) — no-op`);
      }
    } catch (err) {
      console.error(`[UserTradingSession] directDbClosePosition threw:`, (err as Error)?.message);
      this.emit('exit_failed', { positionId, reason: exitReason, error: (err as Error)?.message, symbol, attempts: 0, maxAttempts: this.MAX_EXIT_RETRIES });
    }
  }

  /**
   * Stop the session. Called during cleanup or user account deletion.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(`[UserTradingSession] Stopping session for user ${this.userId}`);

    // Stop settings sync
    if (this.settingsSyncInterval) {
      clearInterval(this.settingsSyncInterval);
      this.settingsSyncInterval = null;
    }

    // Stop paper position price updater
    if (this.paperPriceUpdateInterval) {
      clearInterval(this.paperPriceUpdateInterval);
      this.paperPriceUpdateInterval = null;
    }

    // Phase 40: Unsubscribe from price feed
    if (this.priceUpdateHandler) {
      try {
        const { priceFeedService } = await import('./priceFeedService');
        priceFeedService.off('price_update', this.priceUpdateHandler);
      } catch {}
      this.priceUpdateHandler = null;
    }

    // Stop exit manager
    if (this.exitManager) {
      this.exitManager.stop();
    }
    // Phase 46: IEM is torn down — safety-net may run as fallback again.
    this.exitManagerActive = false;
    this.exitRetryCount.clear();

    // Save agent weights
    if (this.weightManager) {
      try {
        await this.weightManager.saveToDatabase();
      } catch {
        // Non-critical
      }
    }

    this.isRunning = false;
    this.removeAllListeners();

    console.log(`[UserTradingSession] Session stopped for user ${this.userId}`);
  }
}
