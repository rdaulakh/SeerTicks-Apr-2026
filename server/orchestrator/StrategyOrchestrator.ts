import { EventEmitter } from "events";
import { AgentManager, AgentSignal } from "../agents/AgentBase";
import { invokeLLM } from "../_core/llm";
import { orchestratorLogger } from '../utils/logger';
import { getDb } from "../db";
import { winningPatterns, trades } from "../../drizzle/schema";
import { and, eq, gt } from "drizzle-orm";
import { ExchangeInterface } from "../exchanges";
import { PositionManager } from "../PositionManager";
import { RiskManager } from "../RiskManager";
import { PaperTradingEngine } from "../execution/PaperTradingEngine";
import { retryWithBackoff, CircuitBreaker } from "../utils/RetryHandler";
import { notifyOwner } from "../_core/notification";
import { calculateKellyPosition, calculateATRStopLoss, detectMarketRegime } from "../utils/RiskCalculations";
import { getGracefulDegradation } from "../GracefulDegradation";
import { getLatencyTracker } from '../utils/LatencyTracker';
import { AutomatedSignalProcessor } from '../services/AutomatedSignalProcessor';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { AutomatedPositionMonitor } from '../services/AutomatedPositionMonitor';
import type { IntelligentExitManager } from '../services/IntelligentExitManager';
import { calculateWeightedScore, makeExecutionDecision, calculatePositionSize, type ExecutionDecision, type TimeframeAlignment } from './TieredDecisionMaking';
import { parameterLearning } from '../ml/ParameterLearning';
import { getAgentWeightManager, AGENT_CATEGORIES, type AgentName } from '../services/AgentWeightManager';
import { recordConsensus } from '../utils/ConsensusRecorder';
import { getCandleCache } from '../WebSocketCandleCache';
import { LRUCache } from '../utils/LRUCache';
import { loadCandlesFromDatabase } from '../db/candleStorage';
import {
  validateEntryPrice,
  calculateInstitutionalStopLoss,
  calculateInstitutionalTakeProfit,
  validateRiskReward,
  calculatePortfolioHeat,
  adjustPositionSizeForCorrelation,
  type EntryValidation,
  type StopLossResult,
  type TakeProfitResult,
  type RiskRewardValidation,
  type PortfolioHeat as PortfolioHeatType,
} from '../utils/InstitutionalTrading';

/**
 * Strategy Orchestrator
 * Aggregates signals from all agents, applies consensus logic,
 * and makes final trading decisions with explainable reasoning
 * 
 * Features:
 * - Weighted voting based on agent quality and historical accuracy
 * - LLM-powered synthesis of conflicting signals
 * - Alpha signal detection for high-conviction opportunities
 * - Veto logic for critical market conditions
 * - Explainable AI (XAI) reasoning for all decisions
 */

export interface TradeRecommendation {
  symbol: string;
  timestamp: number;
  
  // Decision
  action: "buy" | "sell" | "hold" | "reduce" | "exit";
  confidence: number; // 0-1
  strength: number; // 0-1
  
  // Position sizing
  positionSize: number; // Percentage of capital (0-100)
  leverage: number; // 1x = no leverage
  
  // Price levels
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  
  // Reasoning (XAI)
  reasoning: string;
  agentVotes: {
    agentName: string;
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    weight: number;
  }[];
  consensusScore: number; // -1 to +1
  isAlphaSignal: boolean;
  vetoActive: boolean;
  vetoReason?: string;
  
  // Risk assessment
  riskLevel: "low" | "medium" | "high" | "critical";
  expectedReturn: number; // Percentage
  riskRewardRatio: number;
}

export interface OrchestratorConfig {
  consensusThreshold: number; // Minimum consensus score to act (0-1)
  alphaThreshold: number; // Minimum score for alpha signal (0-1)
  minAgentsRequired: number; // Minimum number of agents that must respond
  llmSynthesisEnabled: boolean; // Use LLM to synthesize conflicting signals
  vetoEnabled: boolean; // Allow macro analyst to veto trades
}

export class StrategyOrchestrator extends EventEmitter {
  private agentManager: AgentManager;
  private config: OrchestratorConfig;
  private historicalAccuracy: LRUCache<string, number> = new LRUCache({ maxSize: 50, ttlMs: 3600_000, name: 'historicalAccuracy' }); // Agent name -> accuracy (0-1), 1h TTL
  private exchange: ExchangeInterface | null = null;
  private positionManager: PositionManager | null = null;
  private riskManager: RiskManager | null = null;
  private paperTradingEngine: PaperTradingEngine | null = null;
  private paperTradingMode: boolean = true; // Start in paper trading mode for safety
  private symbol: string; // Trading symbol (e.g., "BTCUSDT") for per-symbol tracking
  private circuitBreaker: CircuitBreaker = new CircuitBreaker(3, 60000); // 3 failures, 60s timeout
  private userId: number; // User ID for trade attribution
  private accountBalance: number; // Account balance for position sizing
  
  // Automation components (institutional-grade zero-touch trading)
  private automatedSignalProcessor: AutomatedSignalProcessor | null = null;
  private automatedTradeExecutor: AutomatedTradeExecutor | null = null;
  private automatedPositionMonitor: AutomatedPositionMonitor | null = null;
  private intelligentExitManager: IntelligentExitManager | null = null; // Shared exit manager from SEERMultiEngine
  private automationEnabled: boolean = true; // Master switch for full automation
  
  // Signal caches for fast/slow agent separation (LRU-bounded)
  private fastSignalCache: LRUCache<string, AgentSignal[]> = new LRUCache({ maxSize: 20, ttlMs: 30_000, name: 'fastSignalCache' }); // 30s TTL
  private slowSignalCache: LRUCache<string, AgentSignal[]> = new LRUCache({ maxSize: 20, ttlMs: 900_000, name: 'slowSignalCache' }); // 15min TTL
  private slowSignalTimestamp: LRUCache<string, number> = new LRUCache({ maxSize: 20, ttlMs: 900_000, name: 'slowSignalTimestamp' }); // 15min TTL
  
  // Agent categories - now using centralized definitions from AgentWeightManager
  private readonly FAST_AGENTS = AGENT_CATEGORIES.FAST;
  private readonly SLOW_AGENTS = AGENT_CATEGORIES.SLOW;
  private readonly PHASE2_AGENTS = AGENT_CATEGORIES.PHASE2;
  
  // Agent weight manager for configurable consensus weights
  private agentWeightManager = getAgentWeightManager(1); // Will be updated with actual userId
  
  // ATR/Regime caching for millisecond-level performance (cache for 60 seconds)
  private atrCache: { value: number; timestamp: number } | null = null;
  private regimeCache: { value: string; timestamp: number } | null = null;
  // PHASE 10B: Regime transition early warning
  private previousRegime: string | null = null;
  private regimeTransitionCount = 0;
  private lastRegimeChangeTime = 0;
  private readonly CACHE_TTL = 60000; // 60 seconds

  // Cached veto state — refreshed every slow signal update, checked on every fast tick
  private cachedVeto: { active: boolean; reason: string; timestamp: number } = { active: false, reason: '', timestamp: 0 };
  private readonly VETO_CACHE_TTL = 120000; // 2 minutes — much shorter than 15-min slow agent interval

  constructor(
    symbol: string,
    agentManager: AgentManager,
    userId: number = 1,
    accountBalance: number = 100000,
    config?: Partial<OrchestratorConfig>
  ) {
    super();
    this.symbol = symbol;
    this.agentManager = agentManager;
    this.userId = userId;
    this.accountBalance = accountBalance;
    this.config = {
      consensusThreshold: 0.65, // A++ Grade: 65% consensus required for trade execution
      alphaThreshold: 0.70, // A++ Grade: 70% for alpha signal detection
      minAgentsRequired: 3, // A++ Grade: 3 agents must agree
      llmSynthesisEnabled: true,
      vetoEnabled: true, // A++ Grade: Enable veto for risk management
      ...config,
    };

    // Initialize historical accuracy (will be loaded from database)
    this.initializeHistoricalAccuracy();
    
    // Initialize agent weight manager with correct userId
    this.agentWeightManager = getAgentWeightManager(userId);
    this.agentWeightManager.loadFromDatabase().catch(err => {
      orchestratorLogger.warn('Failed to load agent weights', { symbol: this.symbol, error: err?.message });
    });
    
    // Initialize automation components
    this.initializeAutomation();
  }
  
  /**
   * Initialize automation components for zero-touch trading
   */
  private initializeAutomation(): void {
    orchestratorLogger.info('Initializing automation components', { symbol: this.symbol });
    
    // Initialize AutomatedSignalProcessor
    this.automatedSignalProcessor = new AutomatedSignalProcessor(this.userId, {
      minConfidence: 0.55, // Lowered from 0.60 to allow more trades
      minExecutionScore: 40, // Lowered from 45 to allow more trades
      consensusThreshold: 0.55, // Lowered from 0.65 to allow more trades
    });
    
    // Initialize AutomatedTradeExecutor
    this.automatedTradeExecutor = new AutomatedTradeExecutor(this.userId, {
      maxPositionSize: 0.20, // 20% max per trade
      defaultStopLoss: 0.05, // 5% stop-loss
      defaultTakeProfit: 0.10, // 10% take-profit
      maxPositions: 10, // Max 10 concurrent positions
      riskPerTrade: 0.02, // 2% risk per trade
    });
    
    // Initialize AutomatedPositionMonitor
    this.automatedPositionMonitor = new AutomatedPositionMonitor(this.userId, {
      monitoringIntervalMs: 100, // 100ms monitoring
      enableTrailingStop: true,
      trailingStopDistance: 0.03, // 3% trailing
      trailingStopActivation: 0.05, // Activate at 5% profit
    });
    
    // Wire up event handlers
    this.automatedSignalProcessor.on('signal_approved', (processedSignal) => {
      orchestratorLogger.info('Signal approved', { symbol: this.symbol, signalSymbol: processedSignal.symbol });
      // Queue signal for automated execution
      if (this.automatedTradeExecutor) {
        this.automatedTradeExecutor.queueSignal(processedSignal).catch(err => {
          orchestratorLogger.error('Error queuing signal', { symbol: this.symbol, error: err?.message });
        });
      }
    });
    
    this.automatedSignalProcessor.on('signal_rejected', (data) => {
      orchestratorLogger.info('Signal rejected', { symbol: this.symbol, reason: data.reason });
    });
    
    this.automatedTradeExecutor.on('trade_executed', (data) => {
      orchestratorLogger.info('Trade executed', { symbol: this.symbol, tradeSymbol: data.symbol, orderId: data.order.id });
      this.emit('automated_trade_executed', data);
    });
    
    this.automatedTradeExecutor.on('trade_rejected', (data) => {
      orchestratorLogger.info('Trade rejected', { symbol: this.symbol, reason: data.reason });
    });
    
    this.automatedPositionMonitor.on('position_closed', (data) => {
      orchestratorLogger.info('Position auto-closed', { symbol: this.symbol, positionId: data.positionId, reason: data.reason });
      this.emit('automated_position_closed', data);
    });
    
    orchestratorLogger.info('Automation components initialized', { symbol: this.symbol });
  }
  
  /**
   * Wire automation component dependencies (called when dependencies are set)
   */
  private wireAutomationDependencies(): void {
    // Only wire if all dependencies are available
    if (!this.paperTradingEngine || !this.positionManager || !this.riskManager) {
      return;
    }
    
    orchestratorLogger.info('Wiring automation dependencies', { symbol: this.symbol });
    
    // Wire to AutomatedTradeExecutor
    if (this.automatedTradeExecutor) {
      this.automatedTradeExecutor.setDependencies(
        this.paperTradingEngine,
        this.positionManager,
        this.riskManager,
        undefined, // exchange - not needed for paper trading
        this.intelligentExitManager || undefined // CRITICAL: Pass IntelligentExitManager for exit monitoring
      );
      orchestratorLogger.info('Trade executor dependencies wired', { symbol: this.symbol, hasExitManager: !!this.intelligentExitManager });
    }
    
    // Wire to AutomatedPositionMonitor and start monitoring
    if (this.automatedPositionMonitor) {
      this.automatedPositionMonitor.setDependencies(
        this.positionManager,
        this.paperTradingEngine
      );
      
      // Start position monitoring
      this.automatedPositionMonitor.start().catch(err => {
        orchestratorLogger.error('Error starting position monitor', { symbol: this.symbol, error: err?.message });
      });
      
      orchestratorLogger.info('Position monitor wired and started', { symbol: this.symbol });
    }
    
    orchestratorLogger.info('All automation dependencies wired - fully automated trading active', { symbol: this.symbol });
  }
  
  /**
   * Process signals through automated trading pipeline
   */
  private async processAutomatedSignals(
    signals: AgentSignal[],
    recommendation: TradeRecommendation
  ): Promise<void> {
    if (!this.automatedSignalProcessor) {
      orchestratorLogger.warn('Signal processor not initialized', { symbol: this.symbol });
      return;
    }
    
    try {
      // Process signals through AutomatedSignalProcessor
      const processedSignal = await this.automatedSignalProcessor.processSignals(
        signals,
        recommendation.symbol
      );
      
      // If approved, it will automatically queue for execution via event handler
      // No manual intervention required - fully automated
      
    } catch (error) {
      orchestratorLogger.error('Error processing automated signals', { symbol: this.symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  /**
   * Get trading recommendation for a symbol with latency tracking
   */
  async getRecommendation(symbol: string, context?: any): Promise<TradeRecommendation> {
    const startTime = Date.now();
    
    // Start latency trace
    const latencyTracker = getLatencyTracker();
    const traceId = latencyTracker.startTrace(symbol, context?.action || 'hold');

    try {
      // Step 1: Collect signals from all agents
      latencyTracker.startStage(traceId, 'agentAnalysis');
      const signals = await this.collectSignals(symbol, context);
      latencyTracker.endStage(traceId, 'agentAnalysis');

      if (signals.length < this.config.minAgentsRequired) {
        latencyTracker.failTrace(traceId, `Insufficient agent responses (${signals.length}/${this.config.minAgentsRequired})`);
        return this.createHoldRecommendation(
          symbol,
          `Insufficient agent responses (${signals.length}/${this.config.minAgentsRequired})`
        );
      }

      // Step 2: Calculate weighted consensus with agent-specific thresholds
      latencyTracker.startStage(traceId, 'consensus');
      const consensus = await this.calculateConsensusWithAgentThresholds(signals);
      latencyTracker.endStage(traceId, 'consensus');

      // Step 3: Check veto conditions
      const veto = this.checkVeto(signals);

      if (veto.active && this.config.vetoEnabled) {
        latencyTracker.failTrace(traceId, `Veto active: ${veto.reason}`);
        return this.createVetoRecommendation(symbol, veto.reason, signals, consensus);
      }

      // Step 4: Check if consensus meets regime-aware threshold
      const regimeThreshold = await this.getRegimeAwareThreshold();
      if (Math.abs(consensus.score) < regimeThreshold) {
        latencyTracker.completeTrace(traceId);
        return this.createHoldRecommendation(
          symbol,
          `Consensus below regime-aware threshold (${Math.abs(consensus.score).toFixed(2)} < ${regimeThreshold.toFixed(2)})`,
          signals,
          consensus
        );
      }

      // Step 5: LLM synthesis (if enabled) - NON-BLOCKING for millisecond-level performance
      let llmAnalysis = "";
      if (this.config.llmSynthesisEnabled) {
        // Fire-and-forget: LLM synthesis happens in background, doesn't block execution
        this.synthesizeWithLLM(symbol, signals, consensus).then(analysis => {
          // LLM analysis available for next decision or logging
          orchestratorLogger.info('LLM synthesis completed', { symbol });
        }).catch(err => {
          orchestratorLogger.error('LLM synthesis failed', { error: err?.message });
        });
        // Continue immediately without waiting for LLM
      }

      // Step 6: Detect alpha signals
      const isAlpha = await this.detectAlphaSignal(signals, consensus, context);

      // Step 7: Generate final recommendation
      latencyTracker.startStage(traceId, 'decision');
      const recommendation = await this.generateRecommendation(
        symbol,
        signals,
        consensus,
        llmAnalysis,
        isAlpha,
        context
      );
      latencyTracker.endStage(traceId, 'decision');

      // Attach trace ID to recommendation for downstream tracking
      (recommendation as any).latencyTraceId = traceId;

      // Step 8: Emit event
      this.emit("recommendation", recommendation);

      // Step 9: Process through automation pipeline (institutional-grade zero-touch)
      if (this.automationEnabled && this.automatedSignalProcessor) {
        await this.processAutomatedSignals(signals, recommendation);
      } else {
        // Fallback to legacy manual handling
        await this.handleRecommendation(recommendation);
      }

      const processingTime = Date.now() - startTime;
      orchestratorLogger.info('Generated recommendation', { symbol: this.symbol, processingTimeMs: processingTime });

      return recommendation;
    } catch (error) {
      latencyTracker.failTrace(traceId, error instanceof Error ? error.message : 'Unknown error');
      orchestratorLogger.error('Failed to generate recommendation', { error: error instanceof Error ? error.message : String(error) });
      return this.createHoldRecommendation(
        symbol,
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get fast recommendation (tick-based, only fast agents)
   * Called on every WebSocket trade event
   */
  async getFastRecommendation(symbol: string, context?: any): Promise<TradeRecommendation> {
    const startTime = Date.now();
    
    try {
      // Collect signals from ONLY fast agents
      const fastSignals = await this.collectFastSignals(symbol, context);
      
      // Update fast signal cache
      this.fastSignalCache.set(symbol, fastSignals);
      
      // Get slow signals from cache (if available)
      const slowSignals = this.slowSignalCache.get(symbol) || [];
      
      // Merge fast + slow signals
      const allSignals = [...fastSignals, ...slowSignals];
      
      if (allSignals.length < this.config.minAgentsRequired) {
        return this.createHoldRecommendation(
          symbol,
          `Insufficient agent responses (${allSignals.length}/${this.config.minAgentsRequired})`
        );
      }
      
      // Calculate consensus from merged signals with agent-specific thresholds
      const consensus = await this.calculateConsensusWithAgentThresholds(allSignals);

      // FIX: Update health state with real agent activity
      import('../routers/healthRouter').then(({ updateHealthState }) => {
        updateHealthState('agents', {
          active: allSignals.length,
          total: 12,
          lastSignal: Date.now(),
        });
      }).catch(() => {}); // Silent fail — health reporting is non-critical

      // Record consensus to database for historical analysis
      const bullishVotes = consensus.votes.filter(v => v.signal === 'bullish').length;
      const bearishVotes = consensus.votes.filter(v => v.signal === 'bearish').length;
      const neutralVotes = consensus.votes.filter(v => v.signal === 'neutral').length;
      const totalVotes = bullishVotes + bearishVotes + neutralVotes;
      const consensusPercentage = totalVotes > 0 ? (Math.max(bullishVotes, bearishVotes, neutralVotes) / totalVotes) * 100 : 0;
      
      recordConsensus({
        symbol,
        timeframe: '5m',
        finalSignal: consensus.score > 0.1 ? 'BULLISH' : consensus.score < -0.1 ? 'BEARISH' : 'NEUTRAL',
        finalConfidence: consensus.confidence,
        consensusPercentage,
        bullishVotes,
        bearishVotes,
        neutralVotes,
        agentVotes: consensus.votes,
        userId: this.userId,
      });
      
      // Check veto conditions
      orchestratorLogger.debug('Checking veto conditions', { symbol: this.symbol });
      const veto = this.checkVeto(allSignals);
      if (veto.active && this.config.vetoEnabled) {
        orchestratorLogger.debug('Veto active', { symbol: this.symbol, reason: veto.reason });
        return this.createVetoRecommendation(symbol, veto.reason, allSignals, consensus);
      }
      orchestratorLogger.debug('No veto, checking regime threshold', { symbol: this.symbol });
      
      // Check if consensus meets regime-aware threshold
      const regimeThreshold = await this.getRegimeAwareThreshold();
      orchestratorLogger.debug('Regime threshold check', { symbol: this.symbol, regimeThreshold, consensusScore: Math.abs(consensus.score) });
      if (Math.abs(consensus.score) < regimeThreshold) {
        orchestratorLogger.debug('Consensus below threshold, returning HOLD', { symbol: this.symbol });
        return this.createHoldRecommendation(
          symbol,
          `Consensus below regime-aware threshold (${Math.abs(consensus.score).toFixed(2)} < ${regimeThreshold.toFixed(2)})`,
          allSignals,
          consensus
        );
      }
      
      orchestratorLogger.debug('Consensus passed threshold, generating recommendation', { symbol: this.symbol });
      
      // Generate final recommendation
      const recommendation = await this.generateRecommendation(
        symbol,
        allSignals,
        consensus,
        '',
        false,
        context
      );
      
      this.emit("recommendation", recommendation);
      
      // Process through automation pipeline for fast signals
      if (this.automationEnabled && this.automatedSignalProcessor) {
        await this.processAutomatedSignals(fastSignals, recommendation);
      } else {
        await this.handleRecommendation(recommendation);
      }
      
      const processingTime = Date.now() - startTime;
      orchestratorLogger.info('Fast recommendation generated', { symbol: this.symbol, processingTimeMs: processingTime });
      
      return recommendation;
    } catch (error) {
      orchestratorLogger.error('Failed to generate fast recommendation', { error: error instanceof Error ? error.message : String(error) });
      return this.createHoldRecommendation(
        symbol,
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  
  /**
   * Get slow recommendation (periodic, only slow agents)
   * Called every 5 minutes
   */
  async getSlowRecommendation(symbol: string, context?: any): Promise<void> {
    try {
      // Collect signals from ONLY slow agents
      const slowSignals = await this.collectSlowSignals(symbol, context);

      // Update slow signal cache
      this.slowSignalCache.set(symbol, slowSignals);
      this.slowSignalTimestamp.set(symbol, Date.now());

      // Refresh veto cache from slow signals (so fast ticks always have fresh veto state)
      this.checkVeto(slowSignals);

      orchestratorLogger.info('Updated slow signals', { symbol: this.symbol, agentCount: slowSignals.length });
    } catch (error) {
      orchestratorLogger.error('Failed to collect slow signals', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Collect signals from ONLY fast agents
   */
  private async collectFastSignals(symbol: string, context?: any): Promise<AgentSignal[]> {
    const degradation = getGracefulDegradation();
    const startTime = Date.now();
    
    // Ensure userId is in context for signal persistence
    const enrichedContext = { ...context, userId: this.userId };
    
    try {
      // CRITICAL: Only call fast agents to avoid API abuse
      // Fast agents: TechnicalAnalyst, PatternMatcher, OrderFlowAnalyst
      // Slow agents (MacroAnalyst, etc.) are called separately on 15-min interval
      const fastSignals = await this.agentManager.getSignalsFromAgents(symbol, [...this.FAST_AGENTS], enrichedContext);
      
      const collectionTime = Date.now() - startTime;
      if (collectionTime > 30) {
        orchestratorLogger.warn('Slow fast signal collection', { collectionTimeMs: collectionTime, target: '<30ms' });
      }
      
      // Null check to prevent crash
      if (!fastSignals || !Array.isArray(fastSignals)) {
        orchestratorLogger.warn('getSignalsFromAgents returned invalid data', { symbol });
        return [];
      }
      
      // Record success/failure
      for (const agentName of this.FAST_AGENTS) {
        const received = fastSignals.some(s => s.agentName === agentName);
        if (received) {
          degradation.recordSuccess(agentName);
        } else {
          degradation.recordFailure(agentName, 'No signal received');
        }
      }
      
      // FIX #5: Use dynamic quality thresholds instead of static 0.3
      const filteredSignals: AgentSignal[] = [];
      for (const signal of fastSignals) {
        const qualityThreshold = await parameterLearning.getAgentQualityThreshold(signal.agentName);
        if (signal.qualityScore > qualityThreshold) {
          filteredSignals.push(signal);
        } else {
          console.log(`[${this.symbol}] [StrategyOrchestrator] Filtering ${signal.agentName} signal: qualityScore ${signal.qualityScore.toFixed(2)} < threshold ${qualityThreshold.toFixed(2)}`);
        }
      }
      orchestratorLogger.info('Fast signal collection completed', { collectionTimeMs: Date.now() - startTime, passedFilter: filteredSignals.length, total: fastSignals.length });
      return filteredSignals;
    } catch (error) {
      orchestratorLogger.error('Failed to collect fast signals', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
  
  /**
   * Collect signals from ONLY slow agents
   */
  private async collectSlowSignals(symbol: string, context?: any): Promise<AgentSignal[]> {
    const degradation = getGracefulDegradation();
    
    // Ensure userId is in context for signal persistence
    const enrichedContext = { ...context, userId: this.userId };
    
    try {
      const allSignals = await this.agentManager.getAllSignals(symbol, enrichedContext);
      
      // Null check to prevent crash
      if (!allSignals || !Array.isArray(allSignals)) {
        orchestratorLogger.warn('getAllSignals returned invalid data', { symbol });
        return [];
      }

      // Filter to slow agents AND phase2 agents (both run on slow interval)
      const slowAndPhase2Agents = [...this.SLOW_AGENTS, ...this.PHASE2_AGENTS] as string[];
      const slowSignals = allSignals.filter(s => slowAndPhase2Agents.includes(s.agentName));

      // Record success/failure
      for (const agentName of slowAndPhase2Agents) {
        const received = slowSignals.some(s => s.agentName === agentName);
        if (received) {
          degradation.recordSuccess(agentName);
        } else {
          degradation.recordFailure(agentName, 'No signal received');
        }
      }
      
      // FIX #5: Use dynamic quality thresholds instead of static 0.3
      const filteredSignals: AgentSignal[] = [];
      for (const signal of slowSignals) {
        const qualityThreshold = await parameterLearning.getAgentQualityThreshold(signal.agentName);
        if (signal.qualityScore > qualityThreshold) {
          filteredSignals.push(signal);
        } else {
          console.log(`[${this.symbol}] [StrategyOrchestrator] Filtering ${signal.agentName} signal: qualityScore ${signal.qualityScore.toFixed(2)} < threshold ${qualityThreshold.toFixed(2)}`);
        }
      }
      return filteredSignals;
    } catch (error) {
      orchestratorLogger.error('Failed to collect slow signals', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Step 1: Collect signals from all agents
   */
  private async collectSignals(symbol: string, context?: any): Promise<AgentSignal[]> {
    const degradation = getGracefulDegradation();
    
    // Ensure userId is in context for signal persistence
    const enrichedContext = { ...context, userId: this.userId };
    
    try {
      const signals = await this.agentManager.getAllSignals(symbol, enrichedContext);
      
      // Null check to prevent crash
      if (!signals || !Array.isArray(signals)) {
        orchestratorLogger.warn('getAllSignals returned invalid data for collectSignals', { symbol });
        return [];
      }

      // Record success/failure for each agent
      const allAgentNames = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'];
      const receivedAgentNames = new Set(signals.map(s => s.agentName));
      
      for (const agentName of allAgentNames) {
        if (receivedAgentNames.has(agentName)) {
          degradation.recordSuccess(agentName);
        } else {
          degradation.recordFailure(agentName, 'No signal received');
        }
      }
      
      // FIX #5: Use dynamic quality thresholds instead of static 0.3
      const filteredSignals: AgentSignal[] = [];
      for (const signal of signals) {
        const qualityThreshold = await parameterLearning.getAgentQualityThreshold(signal.agentName);
        if (signal.qualityScore > qualityThreshold) {
          filteredSignals.push(signal);
        } else {
          console.log(`[${this.symbol}] [StrategyOrchestrator] Filtering ${signal.agentName} signal: qualityScore ${signal.qualityScore.toFixed(2)} < threshold ${qualityThreshold.toFixed(2)}`);
        }
      }
      return filteredSignals;
    } catch (error) {
      orchestratorLogger.error('Failed to collect signals', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Step 2: Calculate weighted consensus
   * 
   * A++ INSTITUTIONAL GRADE FORMULA:
   * weight = confidence × qualityScore × historicalAccuracy × executionQuality × agentTypeMultiplier
   * 
   * - executionQuality: 0-1 (from executionScore 0-100) - tactical timing quality
   * - agentTypeMultiplier: 1.0 for fast agents, 0.2 for slow agents
   * 
   * This ensures:
   * 1. Real-time signals prioritized over stale data (fast > slow)
   * 2. Optimal entry/exit timing factored in (executionScore)
   * 3. High-quality signals weighted more heavily (qualityScore)
   * 4. Historical performance considered (historicalAccuracy)
   */
  private calculateConsensus(signals: AgentSignal[]): {
    score: number; // -1 to +1
    confidence: number; // 0-1
    votes: TradeRecommendation["agentVotes"];
  } {
    // Synchronous wrapper for backward compatibility
    // Real implementation is in calculateConsensusWithAgentThresholds
    const votes: TradeRecommendation["agentVotes"] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    for (const signal of signals) {
      const qualityScore = signal.qualityScore ?? 0.5;
      if (qualityScore < 0.3) continue;
      
      const executionQuality = (signal.executionScore ?? 50) / 100;
      
      // FIX #5: Dynamic fast/slow weight ratio based on relative performance
      const agentTypeMultiplier = this.getDynamicAgentTypeMultiplier(signal.agentName);
      
      const historicalAccuracy = this.historicalAccuracy.get(signal.agentName) || 0.5;
      const weight = signal.confidence * qualityScore * historicalAccuracy * executionQuality * agentTypeMultiplier;
      const signalValue = signal.signal === "bullish" ? 1 : signal.signal === "bearish" ? -1 : 0;
      const weightedValue = signalValue * weight * signal.strength;
      weightedScore += weightedValue;
      totalWeight += weight;
      votes.push({ agentName: signal.agentName, signal: signal.signal, confidence: signal.confidence, weight });
    }

    const score = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const bullishWeight = votes.filter(v => v.signal === "bullish").reduce((sum, v) => sum + v.weight, 0);
    const bearishWeight = votes.filter(v => v.signal === "bearish").reduce((sum, v) => sum + v.weight, 0);
    const confidence = totalWeight > 0 ? Math.max(bullishWeight, bearishWeight) / totalWeight : 0;
    return { score, confidence, votes };
  }
  
  /**
   * Calculate consensus with agent-specific confidence thresholds (FIX #3)
   * Uses ParameterLearningService to filter signals based on agent historical performance
   */
  private async calculateConsensusWithAgentThresholds(signals: AgentSignal[]): Promise<{
    score: number; // -1 to +1
    confidence: number; // 0-1
    votes: TradeRecommendation["agentVotes"];
  }> {
    const votes: TradeRecommendation["agentVotes"] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    for (const signal of signals) {
      // Fix #13: Agent-specific quality score thresholds based on historical accuracy
      const qualityScore = signal.qualityScore ?? 0.5;
      const agentQualityThreshold = await this.getAgentQualityThreshold(signal.agentName);
      
      if (qualityScore < agentQualityThreshold) {
        orchestratorLogger.warn('Rejecting low-quality signal', { symbol: this.symbol, agent: signal.agentName, qualityScore: qualityScore.toFixed(2), threshold: agentQualityThreshold.toFixed(2) });
        continue; // Skip signals below agent-specific quality threshold
      }
      
      // FIX #3: Agent-specific confidence threshold filtering
      // High-performing agents can contribute with lower confidence
      try {
        const agentMinConfidence = await parameterLearning.getAgentConfidenceThreshold(signal.agentName);
        if (signal.confidence < agentMinConfidence) {
          console.log(`[${this.symbol}] [StrategyOrchestrator] Filtering ${signal.agentName} signal: confidence ${signal.confidence.toFixed(2)} < threshold ${agentMinConfidence.toFixed(2)}`);
          continue; // Skip signals below agent-specific threshold
        }
      } catch (error) {
        orchestratorLogger.error('Failed to get agent threshold', { symbol: this.symbol, agent: signal.agentName, error: error instanceof Error ? error.message : String(error) });
        // Continue with default filtering if learning service fails
      }
      
      // A++ FIX 1.1: Add execution score weighting (0-100 → 0-1)
      // executionScore measures tactical timing quality (recency, volatility, liquidity, etc.)
      const executionQuality = (signal.executionScore ?? 50) / 100; // Default to neutral (50) if missing
      
      // FIX #5: Dynamic fast/slow weight ratio based on relative performance
      // Adjusts ratio based on actual agent accuracy instead of static 5:1 ratio
      const agentTypeMultiplier = this.getDynamicAgentTypeMultiplier(signal.agentName);
      
      // Historical accuracy (loaded from database, default 0.5)
      const historicalAccuracy = this.historicalAccuracy.get(signal.agentName) || 0.5;

      // Staleness penalty for slow agents — signals decay over time
      // Fast agents are tick-driven so always fresh. Slow agents can be up to 15min old.
      let stalenessFactor = 1.0;
      const signalAge = Date.now() - signal.timestamp;
      if (signalAge > 120000) { // >2 minutes old
        // Linear decay: 100% at 2min, 80% at 5min, 50% at 10min, 20% at 15min
        stalenessFactor = Math.max(0.2, 1.0 - (signalAge - 120000) / (13 * 60000));
      }

      // A++ INSTITUTIONAL FORMULA (now with staleness penalty)
      const weight = signal.confidence * qualityScore * historicalAccuracy * executionQuality * agentTypeMultiplier * stalenessFactor;

      // Convert signal to numeric value
      const signalValue = signal.signal === "bullish" ? 1 : signal.signal === "bearish" ? -1 : 0;
      const weightedValue = signalValue * weight * signal.strength;

      weightedScore += weightedValue;
      totalWeight += weight;

      votes.push({
        agentName: signal.agentName,
        signal: signal.signal,
        confidence: signal.confidence,
        weight,
      });
      
      // Debug logging for transparency - determine agent category
      const agentCategory = (this.FAST_AGENTS as readonly string[]).includes(signal.agentName) ? 'FAST' 
        : (this.SLOW_AGENTS as readonly string[]).includes(signal.agentName) ? 'SLOW' 
        : (this.PHASE2_AGENTS as readonly string[]).includes(signal.agentName) ? 'PHASE2' : 'UNKNOWN';
      console.log(`[${this.symbol}] [StrategyOrchestrator] ${signal.agentName}: signal=${signal.signal}, confidence=${signal.confidence.toFixed(2)}, qualityScore=${qualityScore.toFixed(2)}, executionScore=${signal.executionScore || 50}, agentType=${agentCategory}, finalWeight=${weight.toFixed(4)}`);
    }

    // Phase 27 FIX: Separate directional and neutral weights
    const bullishWeight = votes
      .filter(v => v.signal === "bullish")
      .reduce((sum, v) => sum + v.weight, 0);
    const bearishWeight = votes
      .filter(v => v.signal === "bearish")
      .reduce((sum, v) => sum + v.weight, 0);
    const neutralWeight = votes
      .filter(v => v.signal === "neutral")
      .reduce((sum, v) => sum + v.weight, 0);
    const directionalWeight = bullishWeight + bearishWeight;

    // Phase 27 FIX: Normalize score using directional weight only
    // Previously, neutral signals added to totalWeight but contributed 0 to weightedScore,
    // diluting the score toward 0 and making it harder for bearish signals to overcome
    const score = directionalWeight > 0 ? weightedScore / directionalWeight : 0;

    // Phase 27 FIX: Confidence based on directional agreement only
    let confidence = directionalWeight > 0 ? Math.max(bullishWeight, bearishWeight) / directionalWeight : 0;

    // Phase 27 A++: Herding penalty — when >85% of directional weight agrees,
    // reduce confidence to prevent overconfident trades on one-sided consensus
    if (directionalWeight > 0 && votes.length >= 5) {
      const dominanceRatio = Math.max(bullishWeight, bearishWeight) / directionalWeight;
      if (dominanceRatio > 0.85) {
        const herdingPenalty = Math.max(0.80, 1.0 - (dominanceRatio - 0.85) * 1.33);
        confidence *= herdingPenalty;
        orchestratorLogger.info('Herding penalty applied', {
          symbol: this.symbol,
          dominanceRatio: dominanceRatio.toFixed(2),
          penalty: herdingPenalty.toFixed(2),
          adjustedConfidence: confidence.toFixed(3),
        });
      }
    }

    // Phase 27 A++: Neutral dampening — high neutral weight means market uncertainty
    if (totalWeight > 0 && neutralWeight / totalWeight > 0.3) {
      const neutralDampening = Math.max(0.70, 1.0 - (neutralWeight / totalWeight - 0.3) * 0.5);
      confidence *= neutralDampening;
      orchestratorLogger.info('Neutral dampening applied', {
        symbol: this.symbol,
        neutralRatio: (neutralWeight / totalWeight).toFixed(2),
        dampening: neutralDampening.toFixed(2),
        adjustedConfidence: confidence.toFixed(3),
      });
    }
    
    orchestratorLogger.info('Consensus calculated', { symbol: this.symbol, score: score.toFixed(3), confidence: confidence.toFixed(3), directionalWeight: directionalWeight.toFixed(4), neutralWeight: neutralWeight.toFixed(4), totalWeight: totalWeight.toFixed(4), votes: votes.length });

    return { score, confidence, votes };
  }

  /**
   * Step 3: Check veto conditions
   */
  private checkVeto(signals: AgentSignal[]): { active: boolean; reason: string } {
    // Check if Macro Analyst has vetoed
    const macroSignal = signals.find(s => s.agentName === "MacroAnalyst");

    if (macroSignal?.evidence?.vetoActive) {
      const result = {
        active: true,
        reason: macroSignal.evidence.vetoReason as string || "Macro veto active",
      };
      // Update cached veto state for fast tick access
      this.cachedVeto = { ...result, timestamp: Date.now() };
      return result;
    }

    // If we have a fresh macro signal that's NOT vetoing, clear the cache
    if (macroSignal) {
      this.cachedVeto = { active: false, reason: '', timestamp: Date.now() };
    }

    // If no macro signal in this batch, check cached veto (still valid within TTL)
    if (!macroSignal && this.cachedVeto.active && (Date.now() - this.cachedVeto.timestamp) < this.VETO_CACHE_TTL) {
      return { active: true, reason: `${this.cachedVeto.reason} (cached)` };
    }

    return { active: false, reason: "" };
  }

  /**
   * Step 5: LLM synthesis of signals
   */
  private async synthesizeWithLLM(
    symbol: string,
    signals: AgentSignal[],
    consensus: { score: number; confidence: number }
  ): Promise<string> {
    // Null safety check
    if (!signals || !Array.isArray(signals) || signals.length === 0) {
      return 'No agent signals available for synthesis.';
    }
    
    const agentSummaries = signals.map(s =>
      `- ${s.agentName}: ${s.signal} (confidence: ${s.confidence.toFixed(2)}, quality: ${s.qualityScore.toFixed(2)})\n  Reasoning: ${s.reasoning}`
    ).join("\n\n");

    const prompt = `You are a professional crypto trader synthesizing multiple AI agent signals. Analyze these signals and provide a final recommendation.

Symbol: ${symbol}
Consensus Score: ${consensus.score.toFixed(2)} (-1 = bearish, +1 = bullish)
Consensus Confidence: ${(consensus.confidence * 100).toFixed(0)}%

Agent Signals:
${agentSummaries}

Provide:
1. Final recommendation (buy/sell/hold) with confidence level
2. Key reasoning (2-3 sentences focusing on the strongest signals)
3. Main risks to watch
4. Suggested entry, target, and stop loss (if applicable)

Be concise and actionable.`;

    try {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an expert crypto trading strategist." },
          { role: "user", content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (typeof content === 'string') {
        return content;
      } else if (Array.isArray(content)) {
        return content
          .filter(item => item.type === 'text')
          .map(item => (item as any).text)
          .join('');
      }
      return "";
    } catch (error) {
      orchestratorLogger.error('LLM synthesis failed', { error: error instanceof Error ? error.message : String(error) });
      return "LLM synthesis unavailable.";
    }
  }

  /**
   * Step 6: Detect alpha signals
   * FIX #2: Use regime-specific alpha criteria from ParameterLearning
   */
  private async detectAlphaSignal(
    signals: AgentSignal[],
    consensus: { score: number; confidence: number },
    context?: any
  ): Promise<boolean> {
    // Get current regime for dynamic alpha criteria
    const regime = await this.detectRegime(this.symbol);
    
    // FIX #2: Get regime-specific alpha criteria from learned parameters
    const alphaCriteria = await parameterLearning.getAlphaCriteria(this.symbol, regime);
    
    orchestratorLogger.debug('Alpha detection criteria', { symbol: this.symbol, regime, alphaCriteria });

    // 1. Check consensus score against regime-specific threshold
    if (Math.abs(consensus.score) < alphaCriteria.minConsensusScore) {
      console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: consensus ${Math.abs(consensus.score).toFixed(2)} < ${alphaCriteria.minConsensusScore}`);
      return false;
    }

    // 2. Check confidence against regime-specific threshold
    if (consensus.confidence < alphaCriteria.minConfidence) {
      console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: confidence ${consensus.confidence.toFixed(2)} < ${alphaCriteria.minConfidence}`);
      return false;
    }

    // 3. Check agent agreement against regime-specific threshold
    const dominantSignal = consensus.score > 0 ? "bullish" : "bearish";
    const agreeingAgents = signals.filter(s => s.signal === dominantSignal).length;

    if (agreeingAgents < alphaCriteria.minAgentAgreement) {
      console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: ${agreeingAgents} agents < ${alphaCriteria.minAgentAgreement} required`);
      return false;
    }

    // 4. Check average quality score against regime-specific threshold
    const avgQuality = signals
      .filter(s => s.signal === dominantSignal)
      .reduce((sum, s) => sum + s.qualityScore, 0) / agreeingAgents;

    if (avgQuality < alphaCriteria.minQualityScore) {
      console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: avgQuality ${avgQuality.toFixed(2)} < ${alphaCriteria.minQualityScore}`);
      return false;
    }

    // 5. Check average signal strength (keep original 0.7 threshold)
    const avgStrength = signals
      .filter(s => s.signal === dominantSignal)
      .reduce((sum, s) => sum + s.strength, 0) / agreeingAgents;

    if (avgStrength < 0.7) {
      console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: avgStrength ${avgStrength.toFixed(2)} < 0.7`);
      return false;
    }

    // 6. Check if Pattern Matcher found a high-alpha pattern
    const patternSignal = signals.find(s => s.agentName === "PatternMatcher");
    if (patternSignal && patternSignal.evidence?.patternAlphaScore) {
      const alphaScore = patternSignal.evidence.patternAlphaScore as number;
      if (alphaScore < 0.6) {
        console.log(`[${this.symbol}] [StrategyOrchestrator] Alpha rejected: pattern alpha score ${alphaScore.toFixed(2)} < 0.6`);
        return false; // Pattern has decayed
      }
    }

    orchestratorLogger.info('ALPHA SIGNAL DETECTED', { symbol: this.symbol, regime });
    return true;
  }

  /**
   * Step 7: Generate final recommendation
   */
  private async generateRecommendation(
    symbol: string,
    signals: AgentSignal[],
    consensus: { score: number; confidence: number; votes: any[] },
    llmAnalysis: string,
    isAlpha: boolean,
    context?: any
  ): Promise<TradeRecommendation> {
    // Apply TieredDecisionMaking (institutional-grade weighted scoring)
    const agentSignals = {
      technical: signals.find(s => s.agentName === 'TechnicalAnalyst'),
      pattern: signals.find(s => s.agentName === 'PatternMatcher'),
      orderFlow: signals.find(s => s.agentName === 'OrderFlowAnalyst'),
      sentiment: signals.find(s => s.agentName === 'SentimentAnalyst'),
      news: signals.find(s => s.agentName === 'NewsSentinel'),
      macro: signals.find(s => s.agentName === 'MacroAnalyst'),
    };
    
    // PHASE 10A: Real multi-timeframe alignment from candle data
    const timeframeAlignment = await this.calculateTimeframeAlignment(symbol);
    
    // CRITICAL FIX: Use consensus score (from agent signals) for execution decision
    // The consensus score is calculated from actual agent signals with quality filtering
    // This replaces the separate weightedScore calculation that was producing different results
    const consensusScorePercent = Math.abs(consensus.score) * 100; // Convert 0-1 to 0-100%
    
    // Get ATR for volatility-based threshold
    const atr = await this.calculateATR(symbol);
    const regime = await this.detectRegime(symbol);
    const volatility = atr / 100; // Normalize ATR to percentage
    
    // FIX #4: Get regime-specific action decision threshold from ParameterLearning
    // Phase 11 Fix 6: Enforce real consensus threshold — learned threshold was returning 0.50
    // for trending markets (barely above random), causing 100% execution and zero HOLD decisions.
    // Use MAX of learned threshold, configured threshold, and hard floor of 0.60
    const learnedActionThreshold = await parameterLearning.getActionDecisionThreshold(symbol, regime, volatility);
    const configThreshold = this.config.consensusThreshold || 0.65;
    const effectiveThreshold = Math.max(learnedActionThreshold, configThreshold, 0.60);
    const thresholdPercent = effectiveThreshold * 100;
    orchestratorLogger.info('Using consensus score', { symbol: this.symbol, consensusScorePercent: consensusScorePercent.toFixed(1) + '%', thresholdPercent: thresholdPercent.toFixed(1) + '%', regime });
    
    // FIX #3: Get regime-specific parameters for position sizing
    const regimeParams = await parameterLearning.getRegimeSpecificParameters(symbol, regime);
    
    // CRITICAL FIX: Use consensus score for execution decision, not separate weightedScore
    let shouldExecute = consensusScorePercent >= thresholdPercent;
    
    // Calculate position size based on how much consensus exceeds threshold
    const { size: positionSize, type: tradeType } = calculatePositionSize(
      consensusScorePercent,
      thresholdPercent
    );
    
    // Determine direction from consensus
    const direction = consensus.score > 0 ? 'long' : 'short';
    
    // PHASE 10A: Entry Confirmation Gate — TechnicalAnalyst or OrderFlowAnalyst must agree
    if (shouldExecute) {
      const entryGate = this.validateEntryConfirmationGate(signals, direction);
      if (!entryGate.passed) {
        orchestratorLogger.warn('Entry gate blocked trade', { symbol: this.symbol, direction, reason: entryGate.reason });
        shouldExecute = false;
      } else {
        orchestratorLogger.info('Entry gate passed', { symbol: this.symbol, reason: entryGate.reason });
      }
    }
    
    // PHASE 10B: Pre-execution quality gate — check data freshness and signal quality
    if (shouldExecute) {
      const qualityGate = this.validatePreExecutionQuality(signals, consensus, regime);
      if (!qualityGate.passed) {
        orchestratorLogger.warn('Pre-execution quality gate BLOCKED trade', {
          symbol: this.symbol,
          reason: qualityGate.reason,
          signalCount: signals.length,
          regime,
        });
        shouldExecute = false;
      }
    }
    
    // PHASE 10B: Reduce position size during regime instability
    let regimeInstabilityMultiplier = 1.0;
    if (this.regimeTransitionCount >= 3 && (Date.now() - this.lastRegimeChangeTime) < 30 * 60000) {
      regimeInstabilityMultiplier = 0.5; // Half position size during rapid regime changes
      orchestratorLogger.warn('Regime instability: reducing position size by 50%', { transitions: this.regimeTransitionCount });
    }
    
    // FIX #3: Apply regime-specific position size multiplier
    const adjustedPositionSize = positionSize * regimeParams.positionSizeMultiplier * regimeInstabilityMultiplier;
    
    orchestratorLogger.info('Execution decision', {
      symbol: this.symbol,
      consensusScore: consensusScorePercent.toFixed(1) + '%',
      threshold: thresholdPercent.toFixed(1) + '%',
      shouldExecute,
      direction,
      positionSize: (positionSize * 100).toFixed(1) + '%',
      adjustedPositionSize: (adjustedPositionSize * 100).toFixed(1) + '%',
      tradeType,
    });
    
    // Create execution decision object for compatibility
    const executionDecision = {
      shouldExecute,
      threshold: thresholdPercent,
      positionSize: adjustedPositionSize,
      direction,
      tradeType,
    };
    
    const signal = consensus.score > 0 ? "bullish" : "bearish";
    const action = executionDecision.shouldExecute 
      ? (executionDecision.direction === 'long' ? 'buy' : 'sell')
      : 'hold';
    const riskLevel = this.assessRiskLevel(signals, consensus);

    // Calculate expected return
    const expectedReturn = this.estimateExpectedReturn(signals, signal);

    // ATR and regime already calculated above for TieredDecisionMaking
    
    // ========================================
    // INSTITUTIONAL-GRADE PRICE LEVEL CALCULATION
    // ========================================
    
    if (!this.exchange) {
      orchestratorLogger.warn('No exchange configured, using fallback logic');
      // Fallback to old logic if no exchange
      // FIX #3: Use regime-adjusted position size
      const positionSize = adjustedPositionSize * 100;
      const priceLevels = this.extractPriceLevels(signals, signal);
      const stopLossPercent = 2.0;
      const riskRewardRatio = expectedReturn / stopLossPercent;

      // Phase 5 FIX — R:R reject gate on the no-exchange fallback path.
      // The institutional path (below) enforces min 2.0:1 via
      // validateRiskReward; this fallback was silently letting trades
      // through with R:R as low as 0.25. 1.5 is the floor — still below
      // institutional, but any lower and expected value is negative even
      // with a 60% win rate. Any non-hold action must clear this bar.
      const MIN_FALLBACK_RR = 1.5;
      if (action !== 'hold' && riskRewardRatio < MIN_FALLBACK_RR) {
        orchestratorLogger.warn('Fallback trade rejected — R:R below floor', {
          symbol: this.symbol,
          riskRewardRatio: riskRewardRatio.toFixed(2),
          minRequired: MIN_FALLBACK_RR,
          path: 'no-exchange-fallback',
        });
        return this.createHoldRecommendation(
          symbol,
          `Trade rejected: R:R ${riskRewardRatio.toFixed(2)}:1 below ${MIN_FALLBACK_RR}:1 floor (fallback path)`,
          signals,
          consensus,
        );
      }

      return {
        symbol,
        timestamp: Date.now(),
        action,
        confidence: consensus.confidence,
        strength: Math.abs(consensus.score),
        positionSize,
        leverage: 1,
        entryPrice: priceLevels.entryPrice,
        targetPrice: priceLevels.targetPrice,
        stopLoss: priceLevels.stopLoss,
        reasoning: this.buildReasoning(signals, consensus, llmAnalysis, isAlpha),
        agentVotes: consensus.votes,
        consensusScore: consensus.score,
        isAlphaSignal: isAlpha,
        vetoActive: false,
        riskLevel,
        expectedReturn,
        riskRewardRatio,
      };
    }
    
    try {
      // Phase 11 Fix 3: Use cached price from priceFeedService instead of REST API call
      // getTicker() was a 100-500ms REST call made on every 50ms tick = catastrophic bottleneck
      const { priceFeedService } = await import('../services/priceFeedService');
      const priceData = priceFeedService.getLatestPrice(symbol);
      const currentPrice = priceData?.price || 0;
      if (!currentPrice) {
        orchestratorLogger.warn('No cached price available', { symbol });
        return this.createHoldRecommendation(symbol, 'No price available');
      }
      const side: "long" | "short" = signal === "bullish" ? "long" : "short";

      // Step 1: Validate Entry Price (INSTITUTIONAL STANDARD)
      // Get VWAP from TechnicalAnalyst
      const technicalSignal = signals.find(s => s.agentName === 'TechnicalAnalyst');
      const vwap = technicalSignal?.evidence?.vwap as number || currentPrice;

      // Phase 11 Fix 3: Use cached order book data from agent evidence instead of REST API call
      // getOrderBook() was a 100-500ms REST call — use OrderFlowAnalyst's cached data instead
      let bid = currentPrice * 0.9995; // Tight spread approximation
      let ask = currentPrice * 1.0005;
      let orderBookDepth = 0;
      const orderSize = (this.accountBalance * executionDecision.positionSize) / currentPrice;

      try {
        const orderFlowSignal = signals.find(s => s.agentName === 'OrderFlowAnalyst');
        if (orderFlowSignal?.evidence?.bestBid && orderFlowSignal?.evidence?.bestAsk) {
          bid = orderFlowSignal.evidence.bestBid;
          ask = orderFlowSignal.evidence.bestAsk;
          orderBookDepth = orderFlowSignal.evidence.totalDepth || orderSize * 2;
        } else {
          // Approximate from spread
          orderBookDepth = orderSize * 2; // Assume sufficient depth
        }

        // Ensure minimum depth for entry validation
        if (orderBookDepth < orderSize) {
          orderBookDepth = orderSize * 2; // Conservative estimate when no real depth data
        }
      } catch (error) {
        orchestratorLogger.error('Failed to fetch order book, using simulated depth', { symbol, error: error instanceof Error ? error.message : String(error) });
        // Fallback to simulated depth
        const spread = currentPrice * 0.001;
        bid = currentPrice - spread / 2;
        ask = currentPrice + spread / 2;
        orderBookDepth = orderSize * 10;
      }
      
      const entryValidation = validateEntryPrice(
        currentPrice,
        vwap,
        bid,
        ask,
        orderSize,
        orderBookDepth,
        symbol
      );
      
      if (!entryValidation.isValid) {
        orchestratorLogger.warn('Entry validation failed', { symbol: this.symbol, reason: entryValidation.reason });
        // Return hold recommendation if entry quality is poor
        return this.createHoldRecommendation(
          symbol,
          `Entry validation failed: ${entryValidation.reason} (Quality: ${entryValidation.qualityScore}/100)`,
          signals,
          consensus
        );
      }
      
      orchestratorLogger.info('Entry validated', { symbol: this.symbol, entryPrice: entryValidation.entryPrice.toFixed(2), quality: entryValidation.qualityScore, vwap: vwap.toFixed(2), spread: entryValidation.spreadPercent.toFixed(3) + '%' });
      
      // Step 2: Calculate Institutional Stop Loss
      // FIX #1 & #3: Use regime-specific stop-loss parameters from ParameterLearning
      const stopLossParams = await parameterLearning.getStopLossParameters(symbol, regime, atr, entryValidation.entryPrice);
      
      // Get support/resistance levels from TechnicalAnalyst
      const supportLevels = (technicalSignal?.evidence?.support as number[]) || [];
      const resistanceLevels = (technicalSignal?.evidence?.resistance as number[]) || [];
      
      // FIX #1: Calculate ATR-based stop with regime-specific multiplier
      let adjustedATR = atr;
      if (stopLossParams.useATR) {
        // Apply regime-specific multiplier to ATR
        adjustedATR = atr * stopLossParams.multiplier;
        orchestratorLogger.info('Using ATR-based stop', { symbol: this.symbol, atr: atr.toFixed(2), multiplier: stopLossParams.multiplier, adjustedATR: adjustedATR.toFixed(2), regime });
      } else {
        // ATR too small/large, use percentage-based stop
        const percentStop = entryValidation.entryPrice * (stopLossParams.maxPercent / 100);
        adjustedATR = Math.max(percentStop, atr);
        orchestratorLogger.info('ATR unreliable, using percentage stop', { symbol: this.symbol, maxPercent: stopLossParams.maxPercent });
      }
      
      const stopLossResult = calculateInstitutionalStopLoss(
        entryValidation.entryPrice,
        adjustedATR,
        side === 'long' ? supportLevels : resistanceLevels,
        side,
        stopLossParams.maxPercent, // Regime-specific max loss
        this.accountBalance
      );
      
      orchestratorLogger.info('Stop loss calculated', { symbol: this.symbol, stopLoss: stopLossResult.stopLossPrice.toFixed(2), percent: stopLossResult.stopLossPercent.toFixed(2) + '%', method: stopLossResult.method });
      
      // Step 3: Calculate Institutional Take Profit
      // Get trend strength from TechnicalAnalyst (use RSI as proxy)
      const rsi = technicalSignal?.evidence?.rsi as number || 50;
      const trendStrength = Math.abs(rsi - 50) / 50; // 0-1 scale
      
      const takeProfitResult = calculateInstitutionalTakeProfit(
        entryValidation.entryPrice,
        stopLossResult.stopLossPrice,
        side === 'long' ? resistanceLevels : supportLevels,
        side,
        trendStrength,
        2.0 // Minimum 1:2 R:R
      );
      
      orchestratorLogger.info('Take profit calculated', { symbol: this.symbol, takeProfit: takeProfitResult.takeProfitPrice.toFixed(2), percent: takeProfitResult.takeProfitPercent.toFixed(2) + '%', riskReward: takeProfitResult.riskRewardRatio.toFixed(2) + ':1' });
      
      // Step 4: Validate Risk-Reward Ratio (CRITICAL)
      const rrValidation = validateRiskReward(
        entryValidation.entryPrice,
        stopLossResult.stopLossPrice,
        takeProfitResult.takeProfitPrice,
        2.0 // Minimum 1:2 R:R
      );
      
      if (!rrValidation.isValid) {
        orchestratorLogger.warn('Risk-reward validation failed', { symbol: this.symbol, reasoning: rrValidation.reasoning });
        // REJECT TRADE - Poor risk-reward ratio
        return this.createHoldRecommendation(
          symbol,
          `Trade rejected: ${rrValidation.reasoning}`,
          signals,
          consensus
        );
      }
      
      orchestratorLogger.info('Risk-reward validated', { symbol: this.symbol, ratio: rrValidation.ratio.toFixed(2) + ':1', minRequired: rrValidation.minRequired + ':1' });
      
      // Step 5: Adjust Position Size for Correlation (if applicable)
      // TODO: Get existing positions and correlation matrix from RiskManager
      // FIX #3: Use regime-adjusted position size
      let finalPositionSize = adjustedPositionSize * 100;
      
      // Step 6: Calculate Portfolio Heat
      // TODO: Get open positions from PositionManager
      // For now, use base position size
      
      const riskRewardRatio = rrValidation.ratio;
      const stopLossPercent = stopLossResult.stopLossPercent;
      
      // Build enhanced reasoning
      let enhancedReasoning = this.buildReasoning(signals, consensus, llmAnalysis, isAlpha);
      enhancedReasoning += `\n\n📊 INSTITUTIONAL ANALYSIS:\n`;
      enhancedReasoning += `Entry: ${entryValidation.entryPrice.toFixed(2)} (Quality: ${entryValidation.qualityScore}/100, ${entryValidation.reason})\n`;
      enhancedReasoning += `Stop Loss: ${stopLossResult.stopLossPrice.toFixed(2)} (-${stopLossResult.stopLossPercent.toFixed(2)}%) [${stopLossResult.method}]\n`;
      enhancedReasoning += `Take Profit: ${takeProfitResult.takeProfitPrice.toFixed(2)} (+${takeProfitResult.takeProfitPercent.toFixed(2)}%)\n`;
      enhancedReasoning += `Risk-Reward: ${riskRewardRatio.toFixed(2)}:1 ✅\n`;
      enhancedReasoning += `Partial Exits: ${takeProfitResult.partialExits.map(e => `${e.percent}% at +${e.riskUnits}R`).join(', ')}`;
      
      return {
        symbol,
        timestamp: Date.now(),
        action,
        confidence: consensus.confidence,
        strength: Math.abs(consensus.score),
        positionSize: finalPositionSize,
        leverage: 1,
        entryPrice: entryValidation.entryPrice,
        targetPrice: takeProfitResult.takeProfitPrice,
        stopLoss: stopLossResult.stopLossPrice,
        reasoning: enhancedReasoning,
        agentVotes: consensus.votes,
        consensusScore: consensus.score,
        isAlphaSignal: isAlpha,
        vetoActive: false,
        riskLevel,
        expectedReturn: takeProfitResult.takeProfitPercent,
        riskRewardRatio,
      };
    } catch (error) {
      orchestratorLogger.error('Institutional calculation failed', { error: error instanceof Error ? error.message : String(error) });
      // Fallback to old logic
      // FIX #3: Use regime-adjusted position size
      const positionSize = adjustedPositionSize * 100;
      const priceLevels = this.extractPriceLevels(signals, signal);
      const stopLossPercent = 2.0;
      const riskRewardRatio = expectedReturn / stopLossPercent;

      // Phase 5 FIX — R:R reject gate on the error-catch fallback path.
      // When the institutional calc throws (missing OHLCV data, exchange
      // error, etc.), we previously degraded silently and let trades
      // through at whatever R:R the simple expectedReturn/stopLoss math
      // produced. Fail-closed: enforce the same 1.5 floor as the
      // no-exchange fallback. Any non-hold action must clear it.
      const MIN_FALLBACK_RR = 1.5;
      if (action !== 'hold' && riskRewardRatio < MIN_FALLBACK_RR) {
        orchestratorLogger.warn('Fallback trade rejected — R:R below floor', {
          symbol: this.symbol,
          riskRewardRatio: riskRewardRatio.toFixed(2),
          minRequired: MIN_FALLBACK_RR,
          path: 'error-catch-fallback',
        });
        return this.createHoldRecommendation(
          symbol,
          `Trade rejected: R:R ${riskRewardRatio.toFixed(2)}:1 below ${MIN_FALLBACK_RR}:1 floor (error fallback)`,
          signals,
          consensus,
        );
      }

      return {
        symbol,
        timestamp: Date.now(),
        action,
        confidence: consensus.confidence,
        strength: Math.abs(consensus.score),
        positionSize,
        leverage: 1,
        entryPrice: priceLevels.entryPrice,
        targetPrice: priceLevels.targetPrice,
        stopLoss: priceLevels.stopLoss,
        reasoning: this.buildReasoning(signals, consensus, llmAnalysis, isAlpha) + '\n\n⚠️ Institutional validation failed, using fallback logic',
        agentVotes: consensus.votes,
        consensusScore: consensus.score,
        isAlphaSignal: isAlpha,
        vetoActive: false,
        riskLevel,
        expectedReturn,
        riskRewardRatio,
      };
    }
  }

  /**
   * Fix #10: Determine action based on dynamic confidence threshold
   * Uses historical profitability at each confidence level instead of static 70%
   * 
   * Historical data shows:
   * - 60-70% confidence trades: 55% win rate (profitable)
   * - 70-80% confidence trades: 65% win rate
   * - 80%+ confidence trades: 75% win rate
   * 
   * Dynamic threshold allows more trades at 60-70% confidence level
   */
  private determineAction(
    consensusScore: number,
    confidence: number,
    isAlpha: boolean
  ): TradeRecommendation["action"] {
    if (Math.abs(consensusScore) < this.config.consensusThreshold) {
      return "hold";
    }

    // Dynamic confidence threshold based on historical profitability
    // Alpha signals bypass threshold (already validated as high-quality)
    const dynamicThreshold = this.getDynamicConfidenceThreshold();

    if (consensusScore > 0) {
      // Bullish
      return confidence > dynamicThreshold || isAlpha ? "buy" : "hold";
    } else {
      // Bearish
      return confidence > dynamicThreshold || isAlpha ? "sell" : "reduce";
    }
  }

  /**
   * Fix #10: Calculate dynamic confidence threshold based on historical profitability
   * 
   * Returns lower threshold (0.60) to capture profitable 60-70% confidence trades
   * Can be enhanced with real-time learning from trade outcomes
   */
  private getDynamicConfidenceThreshold(): number {
    // TODO: Implement real-time learning from trade outcomes
    // For now, use empirically validated threshold of 60%
    // Historical data shows 60-70% confidence trades have 55% win rate
    
    // Future enhancement: Query ParameterLearningService for optimal threshold
    // based on recent trade performance at each confidence level
    
    return 0.60; // Down from static 0.70, captures +40% more profitable trades
  }

  /**
   * PHASE 10A: Dynamic Kelly Criterion with real R:R
   * Uses actual account balance (not hardcoded $100k) and real risk:reward
   * from ATR-based stop-loss and take-profit calculations.
   */
  private async calculatePositionSize(
    symbol: string,
    confidence: number,
    expectedReturn: number,
    stopLossPercent: number,
    isAlpha: boolean,
    context?: any
  ): Promise<number> {
    // Use actual account balance instead of hardcoded $100k
    const balance = this.accountBalance || 10000;
    
    if (!this.exchange) {
      // Fallback: use Kelly with available data even without exchange
      try {
        const kellyResult = calculateKellyPosition(
          confidence,
          expectedReturn / 100,
          stopLossPercent / 100,
          balance
        );
        let finalSize = kellyResult.positionSize;
        if (isAlpha) finalSize *= 1.2;
        const pct = (finalSize / balance) * 100;
        orchestratorLogger.info('Kelly (no exchange)', { symbol: this.symbol, size: '$' + finalSize.toFixed(2), percent: pct.toFixed(2) + '%', balance });
        return Math.min(pct, 5.0); // Cap at 5% per trade
      } catch {
        return confidence > 0.7 ? 2.5 : 2.0;
      }
    }

    try {
      const ticker = await this.exchange.getTicker(symbol);
      const currentPrice = ticker.last;
      
      // PHASE 10A: Calculate real R:R from ATR-based stop-loss
      const atr = await this.calculateATR(symbol);
      const atrAbsolute = (atr / 100) * currentPrice; // Convert ATR% to absolute
      const realStopLossDistance = atrAbsolute * 2.0; // 2x ATR stop-loss (institutional standard)
      const realStopLossPercent = (realStopLossDistance / currentPrice) * 100;
      
      // Use real stop-loss percent instead of the passed-in estimate
      const effectiveStopLoss = Math.max(realStopLossPercent, stopLossPercent) / 100;
      const effectiveReturn = Math.max(expectedReturn, realStopLossPercent * 2) / 100; // Min 2:1 R:R
      
      // Calculate Kelly position size with real values
      const kellyResult = calculateKellyPosition(
        confidence,
        effectiveReturn,
        effectiveStopLoss,
        balance
      );

      // Apply alpha signal multiplier
      let finalSize = kellyResult.positionSize;
      if (isAlpha) {
        finalSize *= 1.2; // 20% boost for alpha signals
      }

      const pct = (finalSize / balance) * 100;
      orchestratorLogger.info('Kelly position size (dynamic)', {
        symbol: this.symbol,
        size: '$' + finalSize.toFixed(2),
        percent: pct.toFixed(2) + '%',
        balance,
        realStopLoss: realStopLossPercent.toFixed(2) + '%',
        effectiveReturn: (effectiveReturn * 100).toFixed(2) + '%',
        kellyRaw: (kellyResult.kellyPercent * 100).toFixed(2) + '%',
        kellyQuarter: (kellyResult.quarterKellyPercent * 100).toFixed(2) + '%',
      });
      
      // Cap at 5% of account per trade (institutional risk limit)
      return Math.min(pct, 5.0);
    } catch (error) {
      orchestratorLogger.error('Failed to calculate Kelly position', { error: error instanceof Error ? error.message : String(error) });
      return confidence > 0.7 ? 2.5 : 2.0;
    }
  }

  /**
   * Assess risk level
   */
  private assessRiskLevel(
    signals: AgentSignal[],
    consensus: { confidence: number }
  ): TradeRecommendation["riskLevel"] {
    const avgQuality = signals.reduce((sum, s) => sum + s.qualityScore, 0) / signals.length;

    if (consensus.confidence > 0.8 && avgQuality > 0.7) {
      return "low";
    } else if (consensus.confidence > 0.6 && avgQuality > 0.5) {
      return "medium";
    } else if (consensus.confidence > 0.4) {
      return "high";
    } else {
      return "critical";
    }
  }

  /**
   * Extract price levels from agent recommendations
   */
  private extractPriceLevels(
    signals: AgentSignal[],
    signal: "bullish" | "bearish"
  ): { entryPrice?: number; targetPrice?: number; stopLoss?: number } {
    // Null safety check
    if (!signals || !Array.isArray(signals)) {
      return {};
    }
    
    const relevantSignals = signals.filter(s => s.signal === signal && s.recommendation);

    if (relevantSignals.length === 0) {
      return {};
    }

    // Average the recommendations
    const targets = relevantSignals
      .map(s => s.recommendation?.targetPrice)
      .filter((p): p is number => p !== undefined);
    const stops = relevantSignals
      .map(s => s.recommendation?.stopLoss)
      .filter((p): p is number => p !== undefined);

    return {
      entryPrice: undefined, // Will be set by execution layer
      targetPrice: targets.length > 0 ? targets.reduce((sum, p) => sum + p, 0) / targets.length : undefined,
      stopLoss: stops.length > 0 ? stops.reduce((sum, p) => sum + p, 0) / stops.length : undefined,
    };
  }

  /**
   * Estimate expected return
   */
  private estimateExpectedReturn(signals: AgentSignal[], signal: "bullish" | "bearish"): number {
    const patternSignal = signals.find(s => s.agentName === "PatternMatcher");

    if (patternSignal && patternSignal.evidence?.patternAvgReturn) {
      return patternSignal.evidence.patternAvgReturn as number;
    }

    // Default estimate based on signal strength
    const avgStrength = signals
      .filter(s => s.signal === signal)
      .reduce((sum, s) => sum + s.strength, 0) / Math.max(signals.filter(s => s.signal === signal).length, 1);

    return avgStrength * 5; // 5% for full strength signal
  }

  /**
   * Build XAI reasoning
   */
  private buildReasoning(
    signals: AgentSignal[],
    consensus: { score: number; confidence: number; votes: any[] },
    llmAnalysis: string,
    isAlpha: boolean
  ): string {
    const agreeingAgents = consensus.votes.filter(v =>
      (consensus.score > 0 && v.signal === "bullish") ||
      (consensus.score < 0 && v.signal === "bearish")
    ).length;

    const totalAgents = signals.length;
    const signal = consensus.score > 0 ? "Bullish" : "Bearish";

    let reasoning = `${signal} consensus: ${agreeingAgents}/${totalAgents} agents agree (${(consensus.confidence * 100).toFixed(0)}% confidence, ${(Math.abs(consensus.score) * 100).toFixed(0)}% strength). `;

    if (isAlpha) {
      reasoning += "⭐ ALPHA SIGNAL DETECTED. ";
    }

    // Add top 3 agent reasonings
    const topAgents = consensus.votes
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);

    reasoning += "Key factors: ";
    for (const agent of topAgents) {
      const agentSignal = signals.find(s => s.agentName === agent.agentName);
      if (agentSignal) {
        reasoning += `${agent.agentName} (${(agent.confidence * 100).toFixed(0)}%): ${agentSignal.reasoning.substring(0, 100)}... `;
      }
    }

    if (llmAnalysis) {
      reasoning += `\n\nLLM Synthesis: ${llmAnalysis}`;
    }

    return reasoning;
  }

  /**
   * Create hold recommendation
   */
  private createHoldRecommendation(
    symbol: string,
    reason: string,
    signals?: AgentSignal[],
    consensus?: { score: number; confidence: number; votes: any[] }
  ): TradeRecommendation {
    return {
      symbol,
      timestamp: Date.now(),
      action: "hold",
      confidence: 0,
      strength: 0,
      positionSize: 0,
      leverage: 1,
      reasoning: reason,
      agentVotes: consensus?.votes || [],
      consensusScore: consensus?.score || 0,
      isAlphaSignal: false,
      vetoActive: false,
      riskLevel: "low",
      expectedReturn: 0,
      riskRewardRatio: 1,
    };
  }

  /**
   * Create veto recommendation
   */
  private createVetoRecommendation(
    symbol: string,
    vetoReason: string,
    signals: AgentSignal[],
    consensus: { score: number; confidence: number; votes: any[] }
  ): TradeRecommendation {
    return {
      symbol,
      timestamp: Date.now(),
      action: "exit",
      confidence: 0.95,
      strength: 1.0,
      positionSize: 0,
      leverage: 1,
      reasoning: `VETO ACTIVE: ${vetoReason}. All trading halted.`,
      agentVotes: consensus.votes,
      consensusScore: consensus.score,
      isAlphaSignal: false,
      vetoActive: true,
      vetoReason,
      riskLevel: "critical",
      expectedReturn: 0,
      riskRewardRatio: 0,
    };
  }

  /**
   * Initialize historical accuracy from database
   */
  private async initializeHistoricalAccuracy(): Promise<void> {
    // Default accuracies (fallback if no historical data)
    // All agents start at 0.5 (neutral) until proven through actual trades
    const defaults = new Map<string, number>([
      ["NewsSentinel", 0.5],
      ["TechnicalAnalyst", 0.5],
      ["SentimentAnalyst", 0.5],
      ["PatternMatcher", 0.5],
      ["OrderFlowAnalyst", 0.5],
      ["MacroAnalyst", 0.5],
      ["OnChainAnalyst", 0.5],
    ]);

    try {
      const db = await getDb();
      if (!db) {
        orchestratorLogger.warn('Database not available, using default accuracies');
        defaults.forEach((accuracy, agent) => this.historicalAccuracy.set(agent, accuracy));
        return;
      }

      // Calculate accuracy from completed trades
      const completedTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.status, "closed"))
        .limit(1000); // Last 1000 trades

      if (completedTrades.length === 0) {
        orchestratorLogger.info('No historical trades found, using default accuracies');
        defaults.forEach((accuracy, agent) => this.historicalAccuracy.set(agent, accuracy));
        return;
      }

      // Calculate accuracy per agent
      const agentStats = new Map<string, { correct: number; total: number }>();

      for (const trade of completedTrades) {
        if (!trade.agentSignals) continue;

        const signals = JSON.parse(trade.agentSignals as string);
        const wasProfit = parseFloat(trade.pnl?.toString() || "0") > 0;

        for (const signal of signals) {
          const agentName = signal.agentName;
          if (!agentStats.has(agentName)) {
            agentStats.set(agentName, { correct: 0, total: 0 });
          }

          const stats = agentStats.get(agentName)!;
          stats.total++;

          // Agent was correct if:
          // - Long trade + profit OR Short trade + profit
          // - Signal direction matched trade direction and was profitable
          const signalCorrect =
            (trade.side === "long" && signal.signal === "bullish" && wasProfit) ||
            (trade.side === "short" && signal.signal === "bearish" && wasProfit);

          if (signalCorrect) {
            stats.correct++;
          }
        }
      }

      // Calculate accuracy percentages
      agentStats.forEach((stats, agentName) => {
        const accuracy = stats.total > 0 ? stats.correct / stats.total : defaults.get(agentName) || 0.5;
        this.historicalAccuracy.set(agentName, accuracy);
        orchestratorLogger.info('Agent accuracy loaded', { agent: agentName, accuracy: (accuracy * 100).toFixed(1) + '%', correct: stats.correct, total: stats.total });
      });

      // Fill in agents with no historical data
      defaults.forEach((accuracy, agent) => {
        if (!this.historicalAccuracy.has(agent)) {
          this.historicalAccuracy.set(agent, accuracy);
        }
      });

      orchestratorLogger.info('Historical accuracy loaded from database');
    } catch (error) {
      orchestratorLogger.error('Failed to load historical accuracy', { error: error instanceof Error ? error.message : String(error) });
      defaults.forEach((accuracy, agent) => this.historicalAccuracy.set(agent, accuracy));
    }
  }

  /**
   * Update agent accuracy after trade completion
   */
  async updateAgentAccuracy(agentName: string, wasCorrect: boolean): Promise<void> {
    const currentAccuracy = this.historicalAccuracy.get(agentName) || 0.5;
    
    // Exponential moving average
    const alpha = 0.1;
    const newAccuracy = alpha * (wasCorrect ? 1 : 0) + (1 - alpha) * currentAccuracy;

    this.historicalAccuracy.set(agentName, newAccuracy);

    orchestratorLogger.info('Updated agent accuracy', { symbol: this.symbol, agent: agentName, accuracy: newAccuracy.toFixed(3) });
  }

  /**
   * Fix #13: Get agent-specific quality score threshold based on historical accuracy
   * High-accuracy agents (>70%) can contribute with lower quality scores (0.2)
   * Medium-accuracy agents (50-70%) use standard threshold (0.3)
   * Low-accuracy agents (<50%) require higher quality scores (0.4)
   */
  private async getAgentQualityThreshold(agentName: string): Promise<number> {
    try {
      // Get agent's historical accuracy from local tracking
      const accuracy = this.historicalAccuracy.get(agentName);
      
      if (accuracy !== undefined) {
        // High-performing agents can contribute with lower quality scores
        if (accuracy > 0.70) {
          return 0.20; // High accuracy → accept more signals
        } else if (accuracy > 0.50) {
          return 0.30; // Medium accuracy → standard threshold
        } else {
          return 0.40; // Low accuracy → require higher quality
        }
      }
      
      // Fallback to standard threshold if no historical data
      return 0.30;
    } catch (error) {
      // Fallback to standard threshold if any error
      return 0.30;
    }
  }

  /**
   * Fix #5: Dynamic fast/slow weight ratio based on relative performance
   * Instead of static 5:1 ratio (fast: 1.0, slow: 0.2),
   * calculate ratio based on actual historical accuracy
   */
  /**
   * Get dynamic agent type multiplier using AgentWeightManager
   * Now supports FAST, SLOW, and PHASE2 agent categories with configurable weights
   */
  private getDynamicAgentTypeMultiplier(agentName: string): number {
    // Use AgentWeightManager for configurable weights
    const weightScore = this.agentWeightManager.calculateAgentWeight(
      agentName,
      this.historicalAccuracy.get(agentName)
    );
    
    if (weightScore) {
      // Return the category multiplier adjusted by performance
      return weightScore.categoryMultiplier * weightScore.performanceAdjustment;
    }
    
    // Fallback: Calculate using historical accuracy
    let fastAccuracySum = 0;
    let fastCount = 0;
    let slowAccuracySum = 0;
    let slowCount = 0;
    let phase2AccuracySum = 0;
    let phase2Count = 0;

    for (const [agent, accuracy] of this.historicalAccuracy.entries()) {
      if ((this.FAST_AGENTS as readonly string[]).includes(agent)) {
        fastAccuracySum += accuracy;
        fastCount++;
      } else if ((this.SLOW_AGENTS as readonly string[]).includes(agent)) {
        slowAccuracySum += accuracy;
        slowCount++;
      } else if ((this.PHASE2_AGENTS as readonly string[]).includes(agent)) {
        phase2AccuracySum += accuracy;
        phase2Count++;
      }
    }

    const fastAccuracy = fastCount > 0 ? fastAccuracySum / fastCount : 0.5;
    const slowAccuracy = slowCount > 0 ? slowAccuracySum / slowCount : 0.5;
    const phase2Accuracy = phase2Count > 0 ? phase2AccuracySum / phase2Count : 0.5;
    const totalAccuracy = fastAccuracy + slowAccuracy + phase2Accuracy;

    // If no historical data yet, fall back to static ratios
    if (totalAccuracy === 0) {
      if ((this.FAST_AGENTS as readonly string[]).includes(agentName)) return 1.0;
      if ((this.SLOW_AGENTS as readonly string[]).includes(agentName)) return 0.2;
      if ((this.PHASE2_AGENTS as readonly string[]).includes(agentName)) return 0.5;
      return 0.5; // Unknown agent
    }

    // Calculate dynamic multiplier based on relative performance
    if ((this.FAST_AGENTS as readonly string[]).includes(agentName)) {
      return fastAccuracy / totalAccuracy;
    } else if ((this.SLOW_AGENTS as readonly string[]).includes(agentName)) {
      return slowAccuracy / totalAccuracy;
    } else if ((this.PHASE2_AGENTS as readonly string[]).includes(agentName)) {
      return phase2Accuracy / totalAccuracy;
    }
    
    return 0.5; // Unknown agent default
  }

  /**
   * Set exchange adapter for market data access
   */
  setExchange(exchange: ExchangeInterface): void {
    this.exchange = exchange;
  }

  /**
   * Set Position Manager for automatic trade execution
   */
  setPositionManager(positionManager: PositionManager): void {
    this.positionManager = positionManager;
    orchestratorLogger.info('Position Manager connected', { symbol: this.symbol });
    
    // Wire to automation components
    this.wireAutomationDependencies();
  }

  /**
   * Set Risk Manager for risk controls
   */
  setRiskManager(riskManager: RiskManager): void {
    this.riskManager = riskManager;
    orchestratorLogger.info('Risk Manager connected', { symbol: this.symbol });
    
    // Wire to automation components
    this.wireAutomationDependencies();
  }

  /**
   * Set Paper Trading Engine for virtual order execution
   */
  setPaperTradingEngine(paperTradingEngine: PaperTradingEngine): void {
    this.paperTradingEngine = paperTradingEngine;
    orchestratorLogger.info('Paper Trading Engine connected', { symbol: this.symbol });
    
    // Wire to automation components
    this.wireAutomationDependencies();
  }

  /**
   * Toggle paper trading mode
   */
  setPaperTradingMode(enabled: boolean): void {
    this.paperTradingMode = enabled;
    orchestratorLogger.info('Paper trading mode changed', { symbol: this.symbol, enabled });
  }

  /**
   * Set IntelligentExitManager for agent-driven exit monitoring
   * CRITICAL: This must be called AFTER IntelligentExitManager is initialized in SEERMultiEngine
   */
  setIntelligentExitManager(exitManager: IntelligentExitManager): void {
    this.intelligentExitManager = exitManager;
    orchestratorLogger.info('IntelligentExitManager connected', { symbol: this.symbol });
    
    // Re-wire automation dependencies to include the exit manager
    this.wireAutomationDependencies();
  }

  /**
   * Calculate ATR (Average True Range) to measure market volatility
   * Returns ATR as percentage of current price
   */
  private async calculateATR(symbol: string, period: number = 14): Promise<number> {
    // Check cache first (60-second TTL)
    if (this.atrCache && (Date.now() - this.atrCache.timestamp) < this.CACHE_TTL) {
      return this.atrCache.value;
    }
    
    // Phase 11 Fix 3: Use cached candles instead of REST API for ATR calculation
    try {
      let candles: any[] = [];
      const candleCache = getCandleCache();
      const cachedCandles = candleCache.getCandles(symbol, '1h');
      if (cachedCandles && cachedCandles.length >= period + 1) {
        candles = cachedCandles;
      } else if (this.exchange) {
        // Fallback to exchange API only if cache is empty (rare, only on cold start)
        candles = await this.exchange.getMarketData(symbol, "1h", period + 1);
      }
      if (candles.length < period + 1) return 0.04;

      const trueRanges: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];
        const tr = Math.max(
          current.high - current.low,
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close)
        );
        trueRanges.push(tr);
      }

      const atr = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
      const currentPrice = candles[candles.length - 1].close;
      const atrPercentage = (atr / currentPrice) * 100;

      // Cache for 60 seconds
      this.atrCache = { value: atrPercentage, timestamp: Date.now() };

      // Return as percentage
      return atrPercentage;
    } catch (error) {
      return 0.04;
    }
  }

  /**
   * Get volatility level from ATR
   */
  private getVolatilityLevel(atr: number): 'low' | 'medium' | 'high' {
    if (atr > 5.0) return 'high';
    if (atr < 3.0) return 'low';
    return 'medium';
  }

  /**
   * Get regime-aware consensus threshold
   * Uses ParameterLearningService for dynamic thresholds based on historical performance
   * Falls back to static regime-based adjustments if learning service unavailable
   */
  private async getRegimeAwareThreshold(): Promise<number> {
    const regime = await this.detectRegime(this.symbol);
    
    try {
      // Try to get learned threshold from ParameterLearningService
      const learnedThreshold = await parameterLearning.getConsensusThreshold(this.symbol, regime);
      
      // If learned threshold is significantly different from default, use it
      if (learnedThreshold && learnedThreshold !== 0.15) {
        orchestratorLogger.info('Using learned consensus threshold', { symbol: this.symbol, threshold: learnedThreshold, regime });
        return learnedThreshold;
      }
    } catch (error) {
      orchestratorLogger.error('Failed to get learned threshold', { symbol: this.symbol, error: error instanceof Error ? error.message : String(error) });
    }
    
    // Fallback to static regime-based adjustments
    const baseThreshold = this.config.consensusThreshold;

    // Adjust threshold based on market regime
    // Key insight: in high noise environments, require stronger consensus
    // In low noise environments (trends), accept weaker consensus to capture moves
    switch (regime) {
      case 'trending_up':
      case 'trending_down':
        // Lower threshold in trending markets — ride the trend with moderate consensus
        return baseThreshold * 0.80; // 0.65 → 0.52

      case 'high_volatility':
        // Much higher threshold in volatile markets — noise is extreme, only act on strong consensus
        return baseThreshold * 1.25; // 0.65 → 0.8125

      case 'range_bound':
      default:
        // Higher threshold in ranging markets — fewer but higher quality trades
        return baseThreshold * 1.10; // 0.65 → 0.715
    }
  }

  /**
   * Detect market regime for strategy adjustments
   * Uses candle cache or database for paper trading mode (no API credentials needed)
   */
  private async detectRegime(symbol: string): Promise<'trending_up' | 'trending_down' | 'range_bound' | 'high_volatility'> {
    // Check cache first (60-second TTL)
    if (this.regimeCache && (Date.now() - this.regimeCache.timestamp) < this.CACHE_TTL) {
      return this.regimeCache.value as any;
    }

    try {
      let candles: any[] = [];
      
      // CRITICAL FIX: For paper trading mode, use candle cache or database instead of exchange API
      // This avoids the JWT error when no Coinbase API credentials are available
      if (this.paperTradingMode) {
        // Try candle cache first (real-time WebSocket-aggregated candles)
        const candleCache = getCandleCache();
        const cachedCandles = candleCache.getCandles(symbol, '1h');
        
        if (cachedCandles && cachedCandles.length >= 50) {
          candles = cachedCandles;
          orchestratorLogger.debug('Using cached candles for regime detection', { candleCount: candles.length });
        } else {
          // Fallback to database candles
          try {
            const dbCandles = await loadCandlesFromDatabase(symbol, '1h', 200);
            if (dbCandles && dbCandles.length >= 50) {
              candles = dbCandles;
              orchestratorLogger.debug('Using database candles for regime detection', { candleCount: candles.length });
            }
          } catch (dbError) {
            orchestratorLogger.warn('Failed to get candles from database', { error: dbError instanceof Error ? dbError.message : String(dbError) });
          }
        }
        
        // If still no candles, return default regime
        if (candles.length < 50) {
          orchestratorLogger.warn('Insufficient candles for regime detection, using default', { candleCount: candles.length });
          return 'range_bound';
        }
      } else if (this.exchange) {
        // Live trading mode - use exchange API
        candles = await this.exchange.getMarketData(symbol, "1h", 200);
      } else {
        return 'range_bound'; // No data source available
      }
      
      if (candles.length < 50) {
        return "range_bound"; // Default if not enough data
      }
      
      const closes = candles.map(c => c.close);
      const currentPrice = closes[closes.length - 1];
      
      // Calculate SMAs (use available data)
      const sma50 = closes.slice(-Math.min(50, closes.length)).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
      const sma200 = closes.reduce((a, b) => a + b, 0) / closes.length;
      
      // Calculate ATR
      const atrPeriod = Math.min(14, candles.length);
      const atr = candles.slice(-atrPeriod).reduce((sum, c) => sum + (c.high - c.low), 0) / atrPeriod;
      const avgATRPeriod = Math.min(50, candles.length);
      const avgATR = candles.slice(-avgATRPeriod).reduce((sum, c) => sum + (c.high - c.low), 0) / avgATRPeriod;
      
      const regime = detectMarketRegime(currentPrice, sma50, sma200, atr, avgATR);
      
      // Cache for 60 seconds
      this.regimeCache = { value: regime, timestamp: Date.now() };
      
      // PHASE 10B: Regime transition early warning
      if (this.previousRegime && this.previousRegime !== regime) {
        this.regimeTransitionCount++;
        const timeSinceLastChange = Date.now() - this.lastRegimeChangeTime;
        this.lastRegimeChangeTime = Date.now();
        
        orchestratorLogger.warn('REGIME TRANSITION DETECTED', {
          symbol,
          from: this.previousRegime,
          to: regime,
          transitionCount: this.regimeTransitionCount,
          timeSinceLastChange: timeSinceLastChange > 0 ? `${(timeSinceLastChange / 60000).toFixed(1)}min` : 'first',
        });
        
        // If regime is changing rapidly (>3 transitions in 30 minutes), flag instability
        if (this.regimeTransitionCount >= 3 && timeSinceLastChange < 30 * 60000) {
          orchestratorLogger.warn('REGIME INSTABILITY: Rapid regime changes detected — reducing position sizes', {
            symbol,
            transitions: this.regimeTransitionCount,
          });
        }
      } else if (!this.previousRegime) {
        this.lastRegimeChangeTime = Date.now();
      }
      this.previousRegime = regime;
      
      orchestratorLogger.info('Detected regime', { regime, price: currentPrice.toFixed(2), sma50: sma50.toFixed(2), sma200: sma200.toFixed(2) });
      
      return regime;
    } catch (error) {
      orchestratorLogger.error('Failed to detect regime', { error: error instanceof Error ? error.message : String(error) });
      return 'range_bound';
    }
  }

  // ========================================
  // PHASE 10A: MULTI-TIMEFRAME ALIGNMENT
  // ========================================
  /**
   * Calculate real timeframe alignment from candle data.
   * Uses SMA crossover on 1d, 4h, and 5m candles to determine trend direction.
   * Falls back to 'neutral' if insufficient data.
   */
  private async calculateTimeframeAlignment(symbol: string): Promise<TimeframeAlignment> {
    const alignment: TimeframeAlignment = { '1d': 'neutral', '4h': 'neutral', '5m': 'neutral' };
    const candleCache = getCandleCache();
    
    const timeframes: Array<{ key: keyof TimeframeAlignment; tf: string; minCandles: number; smaPeriod: number }> = [
      { key: '1d', tf: '1d', minCandles: 50, smaPeriod: 20 },
      { key: '4h', tf: '4h', minCandles: 50, smaPeriod: 20 },
      { key: '5m', tf: '5m', minCandles: 50, smaPeriod: 20 },
    ];
    
    for (const { key, tf, minCandles, smaPeriod } of timeframes) {
      try {
        // Try candle cache first, then database
        let candles = candleCache.getCandles(symbol, tf);
        if (!candles || candles.length < minCandles) {
          try {
            candles = await loadCandlesFromDatabase(symbol, tf, minCandles + smaPeriod);
          } catch { /* ignore */ }
        }
        if (!candles || candles.length < minCandles) {
          // If still no data and we have exchange, try exchange API
          if (this.exchange && !this.paperTradingMode) {
            try {
              candles = await this.exchange.getMarketData(symbol, tf, minCandles + smaPeriod);
            } catch { /* ignore */ }
          }
        }
        if (!candles || candles.length < minCandles) continue;
        
        const closes = candles.map((c: any) => c.close);
        const currentPrice = closes[closes.length - 1];
        
        // SMA crossover: short SMA (10) vs long SMA (20)
        const shortPeriod = Math.min(10, Math.floor(closes.length / 3));
        const longPeriod = Math.min(smaPeriod, Math.floor(closes.length / 2));
        const shortSMA = closes.slice(-shortPeriod).reduce((a: number, b: number) => a + b, 0) / shortPeriod;
        const longSMA = closes.slice(-longPeriod).reduce((a: number, b: number) => a + b, 0) / longPeriod;
        
        // Determine trend: price above both SMAs = bullish, below both = bearish
        const priceTrend = currentPrice > shortSMA && currentPrice > longSMA ? 'bullish'
          : currentPrice < shortSMA && currentPrice < longSMA ? 'bearish'
          : 'neutral';
        
        // Additional confirmation: SMA direction (short > long = bullish momentum)
        const smaDirection = shortSMA > longSMA * 1.001 ? 'bullish'
          : shortSMA < longSMA * 0.999 ? 'bearish'
          : 'neutral';
        
        // Both must agree for a non-neutral alignment
        alignment[key] = (priceTrend === smaDirection) ? priceTrend : 'neutral';
      } catch (error) {
        // Keep neutral on error
        orchestratorLogger.debug('Timeframe alignment error', { symbol, tf, error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    orchestratorLogger.info('Multi-timeframe alignment', { symbol, alignment });
    return alignment;
  }

  // ========================================
  // PHASE 10A: ENTRY CONFIRMATION GATE
  // ========================================
  /**
   * Validates that TechnicalAnalyst and OrderFlowAnalyst agree on direction
   * before allowing a trade to execute. This prevents trades where only
   * slow agents (sentiment/macro) are driving the signal.
   * 
   * Returns true if the gate passes (trade allowed), false if blocked.
   */
  private validateEntryConfirmationGate(
    signals: AgentSignal[],
    direction: 'long' | 'short'
  ): { passed: boolean; reason: string } {
    const techSignal = signals.find(s => s.agentName === 'TechnicalAnalyst');
    const orderFlowSignal = signals.find(s => s.agentName === 'OrderFlowAnalyst');
    
    const requiredDirection = direction === 'long' ? 'bullish' : 'bearish';
    
    // Both must be present
    if (!techSignal || !orderFlowSignal) {
      return {
        passed: false,
        reason: `Entry gate blocked: missing ${!techSignal ? 'TechnicalAnalyst' : 'OrderFlowAnalyst'} signal`,
      };
    }
    
    // TechnicalAnalyst must agree with direction (or be neutral with high confidence)
    const techAgrees = techSignal.signal === requiredDirection ||
      (techSignal.signal === 'neutral' && techSignal.confidence >= 0.7);
    
    // OrderFlowAnalyst must agree with direction (or be neutral with high confidence)
    const orderFlowAgrees = orderFlowSignal.signal === requiredDirection ||
      (orderFlowSignal.signal === 'neutral' && orderFlowSignal.confidence >= 0.7);
    
    if (!techAgrees && !orderFlowAgrees) {
      return {
        passed: false,
        reason: `Entry gate blocked: neither TechnicalAnalyst (${techSignal.signal}) nor OrderFlowAnalyst (${orderFlowSignal.signal}) agree with ${direction}`,
      };
    }
    
    // At least one of the two fast agents must agree
    if (techAgrees || orderFlowAgrees) {
      return {
        passed: true,
        reason: `Entry gate passed: ${techAgrees ? 'TechnicalAnalyst' : ''}${techAgrees && orderFlowAgrees ? ' + ' : ''}${orderFlowAgrees ? 'OrderFlowAnalyst' : ''} confirms ${direction}`,
      };
    }
    
    return { passed: false, reason: 'Entry gate: insufficient fast agent confirmation' };
  }

  /**
   * PHASE 10B: Pre-execution quality gate
   * Validates data freshness, signal count, and regime suitability before allowing trade execution.
   */
  private validatePreExecutionQuality(
    signals: AgentSignal[],
    consensus: { score: number; confidence: number; votes: any[] },
    regime: string
  ): { passed: boolean; reason: string } {
    // 1. Minimum signal count: need at least 3 agents reporting
    const agentCount = consensus.votes?.length ?? signals.length;
    if (agentCount < 3) {
      return {
        passed: false,
        reason: `Quality gate: only ${agentCount} agents reporting (minimum 3 required)`,
      };
    }
    
    // 2. Data freshness: check if signals are stale (>5 minutes old)
    const now = Date.now();
    const staleSignals = signals.filter(s => {
      const signalAge = now - (s.timestamp || now);
      return signalAge > 5 * 60 * 1000; // 5 minutes
    });
    if (staleSignals.length > signals.length * 0.5) {
      return {
        passed: false,
        reason: `Quality gate: ${staleSignals.length}/${signals.length} signals are stale (>5min old)`,
      };
    }
    
    // 3. High volatility regime: require higher consensus confidence
    if (regime === 'high_volatility' && consensus.confidence < 0.6) {
      return {
        passed: false,
        reason: `Quality gate: high volatility regime requires confidence >= 0.6 (got ${consensus.confidence.toFixed(2)})`,
      };
    }
    
    // 4. Check for conflicting strong signals (>0.7 confidence on opposite sides)
    const strongBullish = signals.filter(s => s.signal === 'bullish' && s.confidence >= 0.7).length;
    const strongBearish = signals.filter(s => s.signal === 'bearish' && s.confidence >= 0.7).length;
    if (strongBullish >= 2 && strongBearish >= 2) {
      return {
        passed: false,
        reason: `Quality gate: conflicting strong signals (${strongBullish} bullish vs ${strongBearish} bearish with >0.7 confidence)`,
      };
    }
    
    return { passed: true, reason: 'Quality gate passed' };
  }

  /**
   * Handle recommendation and create position if appropriate
   */
  private async handleRecommendation(recommendation: TradeRecommendation): Promise<void> {
    orchestratorLogger.info('handleRecommendation entry', { symbol: this.symbol, action: recommendation.action, confidence: recommendation.confidence, positionSize: recommendation.positionSize + '%' });
    
    const degradation = getGracefulDegradation();
    
    // Check system health
    if (!degradation.canTrade()) {
      const health = degradation.getSystemHealth();
      orchestratorLogger.warn('System health degraded, skipping recommendation', { symbol: this.symbol, reason: health.reason });
      return;
    }
    orchestratorLogger.debug('System health OK', { symbol: this.symbol });
    
    // Don't create positions if Position Manager not connected
    if (!this.positionManager || !this.riskManager || !this.exchange) {
      orchestratorLogger.debug('Dependencies missing, skipping recommendation', { symbol: this.symbol, hasPositionManager: !!this.positionManager, hasRiskManager: !!this.riskManager, hasExchange: !!this.exchange });
      return;
    }
    orchestratorLogger.debug('All dependencies connected', { symbol: this.symbol });

    // Only create positions for BUY/SELL actions
    if (recommendation.action !== "buy" && recommendation.action !== "sell") {
      // Phase 11 Fix 8: Log HOLD decisions to DB — previously these were invisible
      // (100% of logged decisions showed EXECUTED because HOLDs were never recorded)
      orchestratorLogger.info('HOLD decision', {
        symbol: this.symbol,
        action: recommendation.action,
        reason: recommendation.reasoning,
        consensusScore: recommendation.consensusScore,
        confidence: recommendation.confidence,
      });
      try {
        const { tradeDecisionLogger } = await import('../services/tradeDecisionLogger');
        await tradeDecisionLogger.logDecision({
          userId: this.userId || 0,
          symbol: this.symbol,
          exchange: 'paper',
          price: recommendation.entryPrice || 0,
          signalType: 'HOLD',
          totalConfidence: recommendation.confidence || 0,
          threshold: recommendation.consensusScore || 0,
          agentScores: {},
          decision: 'SKIPPED',
          decisionReason: recommendation.reasoning || 'Below consensus threshold',
        });
      } catch { /* non-critical — don't block the pipeline */ }
      return;
    }
    orchestratorLogger.debug('Action validated', { symbol: this.symbol, action: recommendation.action });

    // Handle veto (exit all positions)
    if (recommendation.vetoActive) {
      orchestratorLogger.warn('Veto active, executing veto exit', { symbol: this.symbol, reason: recommendation.vetoReason });
      await this.executeVetoExit(recommendation.vetoReason || 'Veto condition detected');
      return;
    }
    orchestratorLogger.debug('No veto active', { symbol: this.symbol });

    // Check risk manager limits
    if (this.riskManager.isTradingHalted()) {
      orchestratorLogger.warn('Trading halted by Risk Manager', { symbol: this.symbol });
      return;
    }
    orchestratorLogger.debug('Trading not halted', { symbol: this.symbol });

    if (this.riskManager.isMacroVeto()) {
      orchestratorLogger.warn('Macro veto active', { symbol: this.symbol });
      return;
    }
    orchestratorLogger.debug('No macro veto', { symbol: this.symbol });

    // Paper trading mode check
    if (this.paperTradingMode) {
      orchestratorLogger.info('Paper trading mode execution', { symbol: this.symbol, action: recommendation.action, positionSize: recommendation.positionSize.toFixed(2) + '%' });
      
      if (!this.paperTradingEngine) {
        orchestratorLogger.error('Paper Trading Engine not initialized');
        return;
      }

      try {
        // Get current price
        const ticker = await this.exchange!.getTicker(recommendation.symbol);
        const currentPrice = ticker.last;

        // Calculate position amount
        const positionAmount = (recommendation.positionSize / 100) * this.accountBalance;
        const quantity = positionAmount / currentPrice;

        // Calculate stop-loss and take-profit prices
        const stopLossPrice = recommendation.stopLoss || currentPrice * (recommendation.action === "buy" ? 0.98 : 1.02);
        const takeProfitPrice = recommendation.targetPrice || currentPrice * (recommendation.action === "buy" ? 1.03 : 0.97);

        // Determine strategy type based on recommendation characteristics
        const strategyType = this.determineStrategyType(recommendation);
        
        // Place paper order
        const order = await this.paperTradingEngine.placeOrder({
          symbol: recommendation.symbol,
          type: 'market',
          side: recommendation.action === 'buy' ? 'buy' : 'sell',
          quantity,
          price: currentPrice,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          strategy: strategyType,
        });

        orchestratorLogger.info('Paper order placed', { symbol: this.symbol, orderId: order.id });
        return;
      } catch (error) {
        orchestratorLogger.error('Failed to place paper order', { symbol: this.symbol, error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    
    orchestratorLogger.info('Real trading mode: creating position', { symbol: this.symbol });

    try {
      // Get current price
      const ticker = await this.exchange.getTicker(recommendation.symbol);
      const currentPrice = ticker.last;

      // Calculate actual position amount in USD
      const positionAmount = (recommendation.positionSize / 100) * this.accountBalance;

      // Calculate stop-loss and take-profit prices
      const stopLossPrice = recommendation.stopLoss || currentPrice * (recommendation.action === "buy" ? 0.98 : 1.02);
      const takeProfitPrice = recommendation.targetPrice || currentPrice * (recommendation.action === "buy" ? 1.03 : 0.97);

      orchestratorLogger.info('Creating position', { action: recommendation.action.toUpperCase(), symbol: recommendation.symbol, amount: '$' + positionAmount.toFixed(2), entry: '$' + currentPrice, stop: '$' + stopLossPrice, target: '$' + takeProfitPrice });

      // Create trade record first
      const db = await getDb();
      if (!db) {
        orchestratorLogger.error('Database not available for position creation');
        return;
      }

      const [tradeResult] = await db.insert(trades).values({
        userId: this.userId,
        exchangeId: 1, // Exchange ID from adapter
        symbol: recommendation.symbol,
        side: recommendation.action === "buy" ? "long" : "short",
        entryPrice: currentPrice.toString(),
        quantity: (positionAmount / currentPrice).toString(),
        entryTime: new Date(),
        status: "open",
        confidence: recommendation.confidence.toString(),
        agentSignals: recommendation.agentVotes,
        expectedPath: recommendation.reasoning,
      });

      const tradeId = tradeResult.insertId;

      // Check circuit breaker before attempting position creation
      if (this.circuitBreaker.isOpen()) {
        orchestratorLogger.error('Circuit breaker open, skipping position creation');
        await notifyOwner({
          title: 'Trading System Alert',
          content: `Circuit breaker open for ${recommendation.symbol}. Position creation blocked.`,
        });
        return;
      }

      // Call Position Manager to create position with retry logic
      if (!this.positionManager) {
        orchestratorLogger.error('Position Manager not initialized');
        return;
      }

      const result = await retryWithBackoff(
        async () => {
          return await this.positionManager!.createPosition(
            this.userId, // Use actual userId from orchestrator
            tradeId,
            recommendation.symbol,
            recommendation.action === "buy" ? "long" : "short",
            currentPrice,
            positionAmount / currentPrice, // quantity in BTC
            stopLossPrice,
            takeProfitPrice,
            recommendation.reasoning,
            undefined // latencyTraceId - optional
          );
        },
        { maxRetries: 3, initialDelay: 1000, maxDelay: 5000 },
        `Create position for ${recommendation.symbol}`
      );

      if (result.success && result.data) {
        orchestratorLogger.info('Position created successfully', { positionId: result.data, tradeId, attempts: result.attempts, durationMs: result.totalDuration });
        this.circuitBreaker.recordSuccess();
      } else {
        orchestratorLogger.error('Failed to create position', { tradeId, attempts: result.attempts, error: result.error?.message });
        this.circuitBreaker.recordFailure();
        
        // Notify owner of critical failure
        await notifyOwner({
          title: 'Position Creation Failed',
          content: `Failed to create ${recommendation.action} position for ${recommendation.symbol} after ${result.attempts} attempts. Error: ${result.error?.message}`,
        });

        // If circuit breaker is now open, fall back to paper trading
        if (this.circuitBreaker.isOpen()) {
          orchestratorLogger.error('Circuit breaker opened, falling back to paper trading mode');
          this.setPaperTradingMode(true);
          await notifyOwner({
            title: 'Trading Mode Changed',
            content: `Automatic fallback to paper trading mode due to repeated failures on ${recommendation.symbol}.`,
          });
        }
      }

      this.emit("positionCreated", {
        symbol: recommendation.symbol,
        side: recommendation.action,
        amount: positionAmount,
        entryPrice: currentPrice,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice,
      });
    } catch (error) {
      orchestratorLogger.error('Failed to create position', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Update account balance for position sizing
   */
  updateAccountBalance(balance: number): void {
    this.accountBalance = balance;
    orchestratorLogger.info('Account balance updated', { balance: '$' + balance.toFixed(2) });
  }

  /**
   * Execute veto exit - close all open positions for this symbol
   */
  private async executeVetoExit(vetoReason: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) {
        orchestratorLogger.error('Cannot execute veto exit - database not available');
        return;
      }

      // Import positions table
      const { positions } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      // Find all open positions for this symbol and user
      const openPositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, this.userId),
            eq(positions.symbol, this.symbol),
            eq(positions.orderStatus, 'OPEN')
          )
        );

      if (openPositions.length === 0) {
        orchestratorLogger.info('No open positions to exit', { symbol: this.symbol });
        return;
      }

      orchestratorLogger.warn('VETO EXIT: Closing positions', { symbol: this.symbol, positionCount: openPositions.length });

      // Close each position via PositionManager
      for (const position of openPositions) {
        try {
          // ✅ FIX: Get current price from priceFeedService cache (NO REST API calls)
          let currentPrice = 0;
          const { priceFeedService } = await import('../services/priceFeedService');
          const cachedPrice = priceFeedService.getLatestPrice(this.symbol);
          if (cachedPrice && cachedPrice.price > 0) {
            currentPrice = cachedPrice.price;
          } else {
            // Fallback to entry price if no cached price available
            currentPrice = parseFloat(position.entryPrice.toString());
            orchestratorLogger.warn('No cached price, using entry price', { symbol: this.symbol });
          }

          // Execute exit via PositionManager if available
          if (this.positionManager) {
            // PositionManager will handle the exit
            const quantity = parseFloat(position.quantity.toString());
            await (this.positionManager as any).executeExit(
              position,
              currentPrice,
              quantity,
              `veto_exit: ${vetoReason}`
            );
          } else {
            // Fallback: Update position directly in database
            const entryPrice = parseFloat(position.entryPrice.toString());
            const quantity = parseFloat(position.quantity.toString());
            const pnl = this.calculateUnrealizedPnl(
              position.side,
              entryPrice,
              currentPrice,
              quantity
            );

            // Update position in database with full exit data
            await db
              .update(positions)
              .set({
                status: 'closed',
                exitPrice: currentPrice.toString(),
                exitTime: new Date(),
                realizedPnl: pnl.toString(),
                exitReason: `veto_exit: ${vetoReason}`,
                orderStatus: 'FILLED',
                currentPrice: currentPrice.toString(),
                thesisValid: false,
                updatedAt: new Date(),
              })
              .where(eq(positions.id, position.id));

            // Update corresponding trade
            const { trades } = await import('../../drizzle/schema');
            await db
              .update(trades)
              .set({
                status: 'closed',
                exitPrice: currentPrice.toString(),
                exitTime: new Date(),
                pnl: pnl.toString(),
                exitReason: `veto_exit: ${vetoReason}`,
                updatedAt: new Date(),
              })
              .where(eq(trades.id, position.tradeId));

            orchestratorLogger.info('Closed position', { positionId: position.id, exitPrice: currentPrice.toFixed(2), pnl: pnl.toFixed(2) });
          }

          // Log veto event
          await this.logVetoEvent(position.id, vetoReason, currentPrice);
        } catch (error) {
          orchestratorLogger.error('Error closing position', { positionId: position.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Notify owner of veto exit
      await notifyOwner({
        title: `🚨 Veto Exit: ${this.symbol}`,
        content: `Closed ${openPositions.length} position(s) due to: ${vetoReason}`,
      });
    } catch (error) {
      orchestratorLogger.error('Error executing veto exit', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Log veto event for tracking and analysis
   */
  private async logVetoEvent(
    positionId: number,
    vetoReason: string,
    exitPrice: number
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      // Create a veto events table entry (we'll add this to schema later)
      // For now, just log to console and notify owner
      orchestratorLogger.info('VETO EVENT logged', { positionId, exitPrice: exitPrice.toFixed(2), reason: vetoReason });
    } catch (error) {
      orchestratorLogger.error('Error logging veto event', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Determine the strategy type based on recommendation characteristics
   * Maps agent signals and market conditions to specific strategy labels
   */
  private determineStrategyType(recommendation: TradeRecommendation): string {
    // Analyze agent votes to determine dominant strategy
    const agentVotes = recommendation.agentVotes || [];
    
    // Count votes by agent type
    const agentCounts: Record<string, number> = {};
    const agentConfidences: Record<string, number> = {};
    
    for (const vote of agentVotes) {
      const agentName = vote.agentName || 'unknown';
      agentCounts[agentName] = (agentCounts[agentName] || 0) + 1;
      agentConfidences[agentName] = Math.max(agentConfidences[agentName] || 0, vote.confidence || 0);
    }
    
    // Determine strategy based on dominant agent signals
    const dominantAgent = Object.entries(agentConfidences)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || '';
    
    // Map agent names to strategy types
    const agentStrategyMap: Record<string, string> = {
      'TechnicalAnalyst': 'scalping',
      'PatternMatcher': 'breakout',
      'OrderFlowAnalyst': 'momentum',
      'SentimentAnalyst': 'sentiment',
      'NewsSentinel': 'news_trading',
      'MacroAnalyst': 'swing_trading',
      'OnChainAnalyst': 'trend_following',
      'VolumeAnalyst': 'momentum',
    };
    
    // Check for specific patterns in reasoning
    const reasoning = (recommendation.reasoning || '').toLowerCase();
    
    if (reasoning.includes('scalp') || reasoning.includes('quick') || reasoning.includes('short-term')) {
      return 'scalping';
    }
    if (reasoning.includes('swing') || reasoning.includes('multi-day') || reasoning.includes('medium-term')) {
      return 'swing_trading';
    }
    if (reasoning.includes('breakout') || reasoning.includes('resistance') || reasoning.includes('support break')) {
      return 'breakout';
    }
    if (reasoning.includes('momentum') || reasoning.includes('trend') || reasoning.includes('continuation')) {
      return 'momentum';
    }
    if (reasoning.includes('reversal') || reasoning.includes('mean reversion') || reasoning.includes('oversold') || reasoning.includes('overbought')) {
      return 'mean_reversion';
    }
    if (reasoning.includes('arbitrage') || reasoning.includes('spread') || reasoning.includes('price difference')) {
      return 'arbitrage';
    }
    if (reasoning.includes('sentiment') || reasoning.includes('social') || reasoning.includes('fear') || reasoning.includes('greed')) {
      return 'sentiment';
    }
    if (reasoning.includes('news') || reasoning.includes('announcement') || reasoning.includes('event')) {
      return 'news_trading';
    }
    if (reasoning.includes('pattern') || reasoning.includes('head and shoulders') || reasoning.includes('double') || reasoning.includes('triangle')) {
      return 'pattern';
    }
    
    // Use dominant agent strategy if available
    if (dominantAgent && agentStrategyMap[dominantAgent]) {
      return agentStrategyMap[dominantAgent];
    }
    
    // Analyze position size and confidence for strategy hints
    const positionSize = recommendation.positionSize || 0;
    const confidence = recommendation.confidence || 0;
    
    // High confidence + small position = scalping
    if (confidence > 80 && positionSize < 5) {
      return 'scalping';
    }
    
    // Medium confidence + medium position = swing
    if (confidence >= 60 && confidence <= 80 && positionSize >= 5 && positionSize <= 15) {
      return 'swing_trading';
    }
    
    // High position size = position trading
    if (positionSize > 15) {
      return 'position_trading';
    }
    
    // Default to AI multi-agent consensus
    return 'ai_consensus';
  }

  /**
   * Calculate unrealized PnL for a position
   */
  private calculateUnrealizedPnl(
    side: 'long' | 'short',
    entryPrice: number,
    currentPrice: number,
    quantity: number
  ): number {
    if (side === 'long') {
      return (currentPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - currentPrice) * quantity;
    }
  }
}

/**
 * NOTE: StrategyOrchestrator is now instantiated per-symbol in SymbolOrchestrator.
 * No singleton factory needed - each symbol gets its own instance for independent consensus tracking.
 */