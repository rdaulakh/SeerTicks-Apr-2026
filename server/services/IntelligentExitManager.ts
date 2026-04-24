/**
 * Intelligent Exit Manager
 * 
 * A++ Institutional Grade Position Exit System
 * 
 * This replaces static stop-loss with intelligent, agent-driven exit decisions.
 * The system continuously monitors positions and uses AI agents to decide when to exit.
 * 
 * Key Principles:
 * 1. NO static stop-loss - agents decide when to exit based on market conditions
 * 2. Breakeven protection - never let a winner become a loser
 * 3. Partial profit taking - scale out of positions progressively
 * 4. Continuous thesis validation - exit when original trade thesis is invalidated
 * 5. Dynamic trailing - lock in profits as position moves in our favor
 */

import { EventEmitter } from 'events';
import { LRUCache } from '../utils/LRUCache';
import { PriceBuffer, PriceBufferManager, getPriceBufferManager } from '../utils/PriceBuffer';
import { ConfidenceDecayTracker, getConfidenceDecayTracker, DecayExitDecision } from './ConfidenceDecayTracker';
import { 
  evaluateHardExitRules, 
  updatePositionState, 
  createHardExitPosition,
  calculateCombinedScore,
  getCurrentDirection,
  HardExitPosition,
  HardExitDecision,
  HardExitConfig,
  DEFAULT_HARD_EXIT_CONFIG
} from './HardExitRules';
import { getLatestConsensus } from './AutomatedSignalProcessor';
import {
  evaluatePriorityExitRules,
  PriorityExitPosition,
  PriorityExitDecision,
  DEFAULT_PRIORITY_EXIT_CONFIG,
  updatePnlHistory,
  updateOrderFlowHistory,
  aggregateAgentExitConsensus,
} from './PriorityExitManager';
import { getTradingConfig } from '../config/TradingConfig';
import { logPipelineEvent, PipelineEventType } from './TradingPipelineLogger';
import { shouldAllowClose as profitLockShouldAllowClose } from './ProfitLockGuard';

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  remainingQuantity: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  highestPrice: number;  // Highest price since entry (for longs)
  lowestPrice: number;   // Lowest price since entry (for shorts)
  breakevenActivated: boolean;
  partialExits: PartialExit[];
  agentSignals: AgentExitSignal[];
  marketRegime: string;
  originalConsensus: number;
  lastAgentCheck: number;
  atr?: number;          // ATR value for dynamic trailing (Phase 3)
  
  // Phase 32: Static TP/SL enforcement
  stopLoss?: number;       // Absolute stop-loss price level
  takeProfit?: number;     // Absolute take-profit price level
  scenarioProjection?: {   // ScenarioEngine projection data
    riskRewardRatio: number;
    expectedValue: number;
    bestCase: { pnlPercent: number };
    worstCase: { pnlPercent: number };
    realistic: { pnlPercent: number };
  };
  
  // Confidence decay tracking (Institutional-Grade Exit System)
  // These are auto-populated by addPosition() from originalConsensus
  entryConfidence?: number;    // Consensus at trade entry
  peakConfidence?: number;     // Highest consensus reached
  peakConfidenceTime?: number; // When peak confidence was reached
  currentConfidence?: number;  // Current consensus
  exitThreshold?: number;      // Calculated exit threshold
  
  // Hard Exit Rules tracking (Grok/ChatGPT recommended)
  entryDirection?: 'bullish' | 'bearish';  // Direction at entry
  entryCombinedScore?: number;             // Combined score at entry
  peakCombinedScore?: number;              // Peak combined score
  peakCombinedScoreTime?: number;          // When peak was reached
  currentCombinedScore?: number;           // Current combined score
  currentDirection?: 'bullish' | 'bearish' | null; // Current direction
  
  // Phase 40: Database position ID for DB sync (in-memory ID is pos_xxx format)
  dbPositionId?: number;
  
  // P&L Trailing Stop tracking (NEW)
  peakPnlPercent?: number;                 // Peak P&L % reached during trade
  
  // Priority Exit System - Profit Target Tracking
  targetsHit?: {
    target1?: boolean;  // +0.5% target hit
    target2?: boolean;  // +1.5% target hit
    target3?: boolean;  // +3.0% target hit
  };
}

export interface PartialExit {
  timestamp: number;
  price: number;
  quantity: number;
  pnlPercent: number;
  reason: string;
}

export interface AgentExitSignal {
  agentName: string;
  signal: 'hold' | 'exit' | 'partial_exit' | 'add';
  confidence: number;
  reason: string;
  timestamp: number;
  // Phase 5B: Full agent intelligence pass-through
  exitRecommendation?: { action: string; urgency: string; reason: string; exitPercent?: number; confidence: number } | null;
  evidence?: Record<string, any> | null;
  rawSignal?: string;
}

export interface ExitDecision {
  action: 'hold' | 'exit_full' | 'exit_partial' | 'move_breakeven' | 'trail_stop';
  reason: string;
  confidence: number;
  exitPercent?: number;  // For partial exits (0-100)
  newStopPrice?: number; // For trailing/breakeven
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface IntelligentExitConfig {
  // Breakeven settings
  breakevenActivationPercent: number;  // Activate breakeven at this profit %
  breakevenBuffer: number;             // Buffer above entry for breakeven stop
  
  // Partial profit taking
  partialProfitLevels: {
    pnlPercent: number;
    exitPercent: number;
  }[];
  
  // Trailing stop
  trailingActivationPercent: number;   // Activate trailing at this profit %
  trailingPercent: number;             // Trail by this % from high
  
  // ATR-based trailing (Phase 3 Enhancement)
  useATRTrailing: boolean;             // Use ATR-based trailing distance
  atrTrailingMultiplier: number;       // ATR multiplier for trailing distance (default: 2.0)
  
  // Agent consensus for exit
  exitConsensusThreshold: number;      // % of agents that must agree to exit
  
  // Time-based rules
  maxHoldTimeHours: number;            // Max time to hold a position
  minProfitForTimeExit: number;        // Min profit to exit on time (otherwise hold)
  
  // Regime-based adjustments
  regimeMultipliers: {
    trending: number;
    ranging: number;
    volatile: number;
  };
  
  // Check intervals
  agentCheckIntervalMs: number;        // How often to consult agents
  priceCheckIntervalMs: number;        // How often to check prices
  
  // Hard Exit Rules (Grok/ChatGPT recommended - simplified 4 rules)
  hardExitConfig: HardExitConfig;
  useHardExitRules: boolean;           // Use simplified 4 rules instead of complex logic
}

const DEFAULT_CONFIG: IntelligentExitConfig = {
  // Breakeven: Activate when position is +0.8% profitable
  // Phase 7 — Fee-aware breakeven:
  //   Round-trip fees (~0.20%) + slippage (~0.05%) = 0.25% drag per trade.
  //   Old (0.5% activation, 0.1% buffer) locked in NET -0.15% per breakeven-stop
  //   exit — a small loss per "protected" winner. ProfitLockGuard correctly
  //   blocked those exits, which caused the position to bleed through to -2.5%.
  //   New (0.8% activation, 0.5% buffer) locks in NET +0.25% per breakeven-stop
  //   exit (gross +0.5% − 0.25% drag) — clears the 0.15% minNetProfit floor so
  //   ProfitLockGuard ALLOWS the exit and the winner is actually protected.
  //   Activation − buffer separation (0.3%) preserves the "price must move
  //   further to trip the breakeven stop" property from the prior design.
  breakevenActivationPercent: 0.8,
  breakevenBuffer: 0.5,  // 0.5% from entry — fee-aware, nets +0.25% at trigger
  
  // Partial profit taking: Scale out progressively
  partialProfitLevels: [
    { pnlPercent: 1.0, exitPercent: 25 },   // At +1%, exit 25%
    { pnlPercent: 1.5, exitPercent: 25 },   // At +1.5%, exit another 25%
    { pnlPercent: 2.0, exitPercent: 25 },   // At +2%, exit another 25%
    // Remaining 25% runs with trailing stop
  ],
  
  // Trailing: Activate at +1.5%, trail by 0.5%
  trailingActivationPercent: 1.5,
  trailingPercent: 0.5,
  
  // ATR-based trailing (Phase 3 Enhancement)
  useATRTrailing: true,
  atrTrailingMultiplier: 2.0,
  
  // Agent consensus: 60% must agree to exit
  exitConsensusThreshold: 0.6,
  
  // Time: Max 4 hours, but only exit if at least breakeven
  maxHoldTimeHours: 4,
  minProfitForTimeExit: 0,
  
  // Regime multipliers
  regimeMultipliers: {
    trending: 1.5,    // Let winners run longer in trends
    ranging: 0.7,     // Take profits faster in ranging
    volatile: 0.5,    // Very quick exits in volatile
  },
  
  // Check intervals
  agentCheckIntervalMs: 5000,   // Check agents every 5 seconds
  priceCheckIntervalMs: 100,    // Check prices every 100ms
  
  // Hard Exit Rules (Grok/ChatGPT recommended - simplified 4 rules)
  hardExitConfig: DEFAULT_HARD_EXIT_CONFIG,
  useHardExitRules: true,       // Use simplified 4 rules by default
};

export class IntelligentExitManager extends EventEmitter {
  private config: IntelligentExitConfig;
  private positions: Map<string, Position> = new Map();
  private priceCheckInterval: NodeJS.Timeout | null = null;
  private agentCheckInterval: NodeJS.Timeout | null = null;
  private dbSyncInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  // Memory-optimized price buffer for HFT-grade performance (Phase 4.2)
  private priceBufferManager!: PriceBufferManager;
  
  // Confidence decay tracker for institutional-grade exit logic
  private confidenceDecayTracker: ConfidenceDecayTracker;
  
  // Callbacks for external integration
  private getAgentSignals: ((symbol: string, position: Position) => Promise<AgentExitSignal[]>) | null = null;
  private getCurrentPrice: ((symbol: string) => Promise<number>) | null = null;
  private executeExit: ((positionId: string, quantity: number, reason: string) => Promise<void>) | null = null;
  private getMarketRegime: ((symbol: string) => Promise<string>) | null = null;
  private getCurrentConsensus: ((symbol: string) => Promise<number>) | null = null;

  // Phase 11: Debounce tracking — process at most once per 200ms per symbol (LRU-bounded)
  private lastTickProcessTime: LRUCache<string, number> = new LRUCache({ maxSize: 50, ttlMs: 60_000, name: 'exitDebounce' });
  private readonly TICK_DEBOUNCE_MS = 200;

  // Phase 41: Exit guard — prevent duplicate exits on the same position
  // Without this, concurrent price ticks can trigger multiple exit evaluations
  // that all pass before the first one removes the position from the map.
  // Phase 46: Exposed via isExiting/lockExit/unlockExit so external callers
  // (UserTradingSession safety-net, IntegratedExitManager) can coordinate and
  // avoid double-close races when they share ownership of a position.
  private exitingPositions: Set<string> = new Set();

  /**
   * Phase 46: Returns true if an exit is currently in flight for this positionId.
   * External callers should consult this before firing their own close path.
   */
  public isExiting(positionId: string): boolean {
    return this.exitingPositions.has(positionId);
  }

  /**
   * Phase 46: Take the exit lock for a positionId. Returns true if acquired,
   * false if it was already locked (caller must back off).
   */
  public lockExit(positionId: string): boolean {
    if (this.exitingPositions.has(positionId)) return false;
    this.exitingPositions.add(positionId);
    return true;
  }

  /**
   * Phase 46: Release the exit lock. Safe to call even if not held.
   */
  public unlockExit(positionId: string): void {
    this.exitingPositions.delete(positionId);
  }

  // Phase 12: Cache PositionGuardian reference to avoid dynamic import() on every tick
  private positionGuardianRef: { onExitManagerTick: () => void } | null | undefined = undefined;
  private positionGuardianLoadPromise: Promise<void> | null = null;

  constructor(config?: Partial<IntelligentExitConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize memory-optimized price buffer (Phase 4.2)
    // 10,000 ticks per symbol = ~160KB per symbol (vs 1MB+ for object arrays)
    this.priceBufferManager = getPriceBufferManager(10000);
    
    // Initialize confidence decay tracker for institutional-grade exits
    // ✅ CRITICAL FIX: Use correct decay ratios that allow natural confidence fluctuation
    // Old values (50%/30%/20%) were too aggressive, causing immediate exits
    // New values (70%/50%/35%) allow agents time to stabilize their analysis
    // Phase 18: entryThreshold from TradingConfig consensus (single source of truth)
    this.confidenceDecayTracker = getConfidenceDecayTracker({
      entryThreshold: getTradingConfig().consensus.minConsensusStrength,
      baseDecayRatio: 0.70,      // Was 0.50 - allow 70% decay from peak before exit
      losingDecayRatio: 0.50,    // Was 0.30 - faster exit for losing positions
      deepLossDecayRatio: 0.35,  // Was 0.20 - fastest exit for deep losses
      floorBuffer: 0.00,         // No floor buffer - prevents immediate exits when entry=peak
      minHoldSecondsForDecayExit: 120, // Wait at least 120 seconds before decay exits
    });
    
    console.log('[IntelligentExitManager] Initialized with A++ institutional grade settings');
    console.log(`[IntelligentExitManager] Memory-optimized price buffer: ${this.priceBufferManager.getTotalMemoryUsage()} bytes`);
    console.log(`[IntelligentExitManager] Breakeven at: +${this.config.breakevenActivationPercent}%`);
    console.log(`[IntelligentExitManager] Partial profits: ${this.config.partialProfitLevels.map(l => `${l.pnlPercent}%→${l.exitPercent}%`).join(', ')}`);
    console.log(`[IntelligentExitManager] Exit consensus threshold: ${this.config.exitConsensusThreshold * 100}%`);
  }

  /**
   * Set external callbacks for integration
   */
  setCallbacks(callbacks: {
    getAgentSignals: (symbol: string, position: Position) => Promise<AgentExitSignal[]>;
    getCurrentPrice: (symbol: string) => Promise<number>;
    executeExit: (positionId: string, quantity: number, reason: string) => Promise<void>;
    getMarketRegime: (symbol: string) => Promise<string>;
    getCurrentConsensus?: (symbol: string) => Promise<number>;
  }): void {
    this.getAgentSignals = callbacks.getAgentSignals;
    this.getCurrentPrice = callbacks.getCurrentPrice;
    this.executeExit = callbacks.executeExit;
    this.getMarketRegime = callbacks.getMarketRegime;
    if (callbacks.getCurrentConsensus) {
      this.getCurrentConsensus = callbacks.getCurrentConsensus;
    }
    console.log('[IntelligentExitManager] External callbacks configured (including consensus tracking)');
  }

  /**
   * Start monitoring positions
   */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Start price monitoring (high frequency)
    this.priceCheckInterval = setInterval(() => {
      this.checkAllPositionsPrices().catch(err => {
        console.error('[IntelligentExitManager] Price check error:', err);
      });
    }, this.config.priceCheckIntervalMs);
    
    // Start agent consultation (lower frequency)
    this.agentCheckInterval = setInterval(() => {
      this.consultAgentsForAllPositions().catch(err => {
        console.error('[IntelligentExitManager] Agent check error:', err);
      });
    }, this.config.agentCheckIntervalMs);
    
    // Start database sync (every 5 seconds) - sync in-memory prices to database
    this.dbSyncInterval = setInterval(() => {
      this.syncPositionsToDatabase().catch(err => {
        console.error('[IntelligentExitManager] DB sync error:', err);
      });
    }, 5000);
    
    console.log('[IntelligentExitManager] ========================================');
    console.log('[IntelligentExitManager] 🚀 STARTED MONITORING');
    console.log('[IntelligentExitManager] ========================================');
    console.log(`[IntelligentExitManager] Positions loaded: ${this.positions.size}`);
    if (this.positions.size > 0) {
      for (const [id, pos] of this.positions) {
        console.log(`[IntelligentExitManager] 📊 Position ${id}: ${pos.symbol} ${pos.side} @ ${pos.entryPrice}`);
      }
    } else {
      console.log('[IntelligentExitManager] ⚠️ No positions loaded - waiting for new positions');
    }
    console.log('[IntelligentExitManager] Database sync enabled (every 5s)');
    console.log('[IntelligentExitManager] Price check interval: 100ms');
    console.log('[IntelligentExitManager] Agent check interval: 5000ms');
    console.log('[IntelligentExitManager] ========================================');
    this.emit('started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
      this.priceCheckInterval = null;
    }
    
    if (this.agentCheckInterval) {
      clearInterval(this.agentCheckInterval);
      this.agentCheckInterval = null;
    }
    
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
      this.dbSyncInterval = null;
    }
    
    console.log('[IntelligentExitManager] Stopped monitoring');
    this.emit('stopped');
  }

  /**
   * Add a position to monitor
   */
  addPosition(position: Omit<Position, 'highestPrice' | 'lowestPrice' | 'breakevenActivated' | 'partialExits' | 'agentSignals' | 'lastAgentCheck' | 'entryConfidence' | 'peakConfidence' | 'currentConfidence' | 'exitThreshold' | 'entryDirection' | 'entryCombinedScore' | 'peakCombinedScore' | 'peakCombinedScoreTime' | 'currentCombinedScore' | 'currentDirection'>): void {
    // Use originalConsensus as entry confidence
    const entryConfidence = position.originalConsensus || 0.65;
    const now = Date.now();
    
    // Get current direction from consensus cache
    const currentDirection = getCurrentDirection(position.symbol) || (position.side === 'long' ? 'bullish' : 'bearish');
    
    // Calculate entry combined score (Confidence * 0.6 + ExecutionScore * 0.4)
    // Default execution score of 50 if not available
    const entryCombinedScore = calculateCombinedScore(entryConfidence, 50);
    
    const fullPosition: Position = {
      ...position,
      highestPrice: position.currentPrice,
      lowestPrice: position.currentPrice,
      breakevenActivated: false,
      partialExits: [],
      agentSignals: [],
      lastAgentCheck: 0,
      // Confidence decay tracking (legacy)
      entryConfidence,
      peakConfidence: entryConfidence,
      peakConfidenceTime: now,
      currentConfidence: entryConfidence,
      exitThreshold: entryConfidence,
      // Hard Exit Rules tracking (Grok/ChatGPT recommended)
      entryDirection: currentDirection,
      entryCombinedScore,
      peakCombinedScore: entryCombinedScore,
      peakCombinedScoreTime: now,
      currentCombinedScore: entryCombinedScore,
      currentDirection,
    };
    
    // Register with confidence decay tracker
    this.confidenceDecayTracker.registerPosition(position.id, position.symbol, entryConfidence);
    
    this.positions.set(position.id, fullPosition);
    console.log('[IntelligentExitManager] ========================================');
    console.log(`[IntelligentExitManager] ➕ NEW POSITION ADDED`);
    console.log(`[IntelligentExitManager] ID: ${position.id}`);
    console.log(`[IntelligentExitManager] Symbol: ${position.symbol}`);
    console.log(`[IntelligentExitManager] Side: ${position.side}`);
    console.log(`[IntelligentExitManager] Entry Price: $${position.entryPrice}`);
    console.log(`[IntelligentExitManager] Quantity: ${position.quantity}`);
    console.log(`[IntelligentExitManager] Entry Confidence: ${(entryConfidence * 100).toFixed(1)}%`);
    console.log(`[IntelligentExitManager] Combined Score: ${(entryCombinedScore * 100).toFixed(1)}%`);
    console.log(`[IntelligentExitManager] Direction: ${currentDirection}`);
    if (position.stopLoss) console.log(`[IntelligentExitManager] Stop-Loss: $${position.stopLoss.toFixed(2)}`);
    if (position.takeProfit) console.log(`[IntelligentExitManager] Take-Profit: $${position.takeProfit.toFixed(2)}`);
    console.log(`[IntelligentExitManager] DB Position ID: ${fullPosition.dbPositionId || 'NONE - DB sync will fail!'}`);
    if (position.scenarioProjection) console.log(`[IntelligentExitManager] Scenario R:R: ${position.scenarioProjection.riskRewardRatio.toFixed(2)}`);
    console.log(`[IntelligentExitManager] Total positions monitored: ${this.positions.size}`);
    console.log('[IntelligentExitManager] ========================================');
    this.emit('position_added', fullPosition);
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId);
    // Clean up confidence decay tracker
    this.confidenceDecayTracker.removePosition(positionId);
    console.log(`[IntelligentExitManager] Stopped monitoring position ${positionId}`);
    this.emit('position_removed', { positionId });
  }

  /**
   * Check all positions for price-based exit conditions
   */
  private async checkAllPositionsPrices(): Promise<void> {
    if (!this.getCurrentPrice) return;
    
    for (const [positionId, position] of this.positions) {
      try {
        const currentPrice = await this.getCurrentPrice(position.symbol);
        await this.updatePositionPrice(positionId, currentPrice);
      } catch (err) {
        console.error(`[IntelligentExitManager] Error checking price for ${positionId}:`, err);
      }
    }
  }

  /**
   * Update position with new price and check exit conditions
   */
  private async updatePositionPrice(positionId: string, currentPrice: number): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position) return;
    
    // Update price tracking
    position.currentPrice = currentPrice;
    
    if (position.side === 'long') {
      position.highestPrice = Math.max(position.highestPrice, currentPrice);
    } else {
      position.lowestPrice = Math.min(position.lowestPrice, currentPrice);
    }
    
    // Calculate P&L
    if (position.side === 'long') {
      position.unrealizedPnl = (currentPrice - position.entryPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      position.unrealizedPnl = (position.entryPrice - currentPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }
    
    // Check exit conditions
    const decision = await this.evaluateExitConditions(position);
    
    if (decision.action !== 'hold') {
      await this.executeExitDecision(position, decision);
    }
  }

  /**
   * Evaluate all exit conditions for a position.
   *
   * PRIME DIRECTIVE: Before returning any non-hold decision, the ProfitLockGuard
   * converts it to "hold" when net PnL is below the profit floor — unless the
   * decision is a genuine catastrophic/emergency stop.
   */
  private async evaluateExitConditions(position: Position): Promise<ExitDecision> {
    const decision = await this.evaluateExitConditionsRaw(position);
    if (decision.action === 'hold') return decision;

    const guard = profitLockShouldAllowClose(
      { side: position.side, entryPrice: position.entryPrice },
      position.currentPrice,
      decision.reason,
    );

    if (guard.allow) return decision;

    // Phase 8 — the defensive bypass that used to live here
    //   (`startsWith('Emergency exit') || startsWith('Stop-Loss hit')` with a
    //   re-check of grossPnl <= catastrophicStopPercent) has been removed.
    //
    //   The guard is now the single source of truth for catastrophic exits:
    //     • "Emergency exit: ..."  → matches the new `emergency exit` pattern
    //                                → allowed via catastrophic_reason branch
    //     • "Stop-Loss hit: ..." at gross ≤ catastrophicStopPercent
    //                                → allowed via catastrophic_grossPnl branch
    //                                  (Phase 7 aligned catastrophic to -1.2%)
    //     • "Stop-Loss hit: ..." at gross above that floor (e.g. breakeven
    //        stop at +0.5%) → allowed via net_profit_ok branch
    //
    //   Keeping the bypass would be dead code AND risky: it defaulted to
    //   `-2.5` when the config was missing, a wider-than-intended floor.
    return {
      action: 'hold',
      reason: `[ProfitLockGuard] ${guard.reason} (was: ${decision.reason})`,
      confidence: 0,
      urgency: 'low',
    };
  }

  /**
   * Raw exit-condition evaluation (pre-guard). Wrapped by `evaluateExitConditions`.
   */
  private async evaluateExitConditionsRaw(position: Position): Promise<ExitDecision> {
    const pnlPercent = position.unrealizedPnlPercent;
    
    // Get regime multiplier
    let regimeMultiplier = 1.0;
    if (this.getMarketRegime) {
      const regime = await this.getMarketRegime(position.symbol);
      position.marketRegime = regime;
      
      if (regime.includes('trend')) {
        regimeMultiplier = this.config.regimeMultipliers.trending;
      } else if (regime.includes('range')) {
        regimeMultiplier = this.config.regimeMultipliers.ranging;
      } else if (regime.includes('volatile')) {
        regimeMultiplier = this.config.regimeMultipliers.volatile;
      }
    }
    
    // Phase 32: FIRST CHECK — Static TP/SL price-level enforcement
    // These are the absolute price levels from ScenarioEngine / calculateDynamicLevels
    if (position.stopLoss && position.stopLoss > 0) {
      const slHit = position.side === 'long'
        ? position.currentPrice <= position.stopLoss
        : position.currentPrice >= position.stopLoss;
      
      if (slHit) {
        const slDistance = Math.abs(position.currentPrice - position.stopLoss);
        const slPercent = (slDistance / position.entryPrice) * 100;
        console.log(`[IntelligentExitManager] 🛑 STOP-LOSS HIT for ${position.id}: ${position.symbol}`);
        console.log(`  SL Price: $${position.stopLoss.toFixed(2)}, Current: $${position.currentPrice.toFixed(2)}`);
        console.log(`  P&L: ${pnlPercent.toFixed(2)}%`);
        return {
          action: 'exit_full',
          reason: `Stop-Loss hit: Price $${position.currentPrice.toFixed(2)} breached SL $${position.stopLoss.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
          confidence: 1.0,
          urgency: 'critical',
        };
      }
    }
    
    if (position.takeProfit && position.takeProfit > 0) {
      const tpHit = position.side === 'long'
        ? position.currentPrice >= position.takeProfit
        : position.currentPrice <= position.takeProfit;
      
      if (tpHit) {
        console.log(`[IntelligentExitManager] 🎯 TAKE-PROFIT HIT for ${position.id}: ${position.symbol}`);
        console.log(`  TP Price: $${position.takeProfit.toFixed(2)}, Current: $${position.currentPrice.toFixed(2)}`);
        console.log(`  P&L: ${pnlPercent.toFixed(2)}%`);
        
        // If scenario projection shows excellent R:R and regime is trending, 
        // consider partial exit instead of full exit to let profits run
        const isStrongTrend = position.marketRegime?.includes('trend');
        const hasHighRR = position.scenarioProjection?.riskRewardRatio && position.scenarioProjection.riskRewardRatio >= 3.0;
        
        if (isStrongTrend && hasHighRR && position.remainingQuantity > position.quantity * 0.5) {
          // In strong trends with high R:R, take 50% profit and let the rest ride with trailing stop
          console.log(`[IntelligentExitManager] 📈 Strong trend + high R:R — partial TP (50%), trailing the rest`);
          return {
            action: 'exit_partial',
            reason: `Take-Profit hit: Price $${position.currentPrice.toFixed(2)} reached TP $${position.takeProfit.toFixed(2)} (+${pnlPercent.toFixed(2)}%) — partial exit in strong trend`,
            confidence: 1.0,
            exitPercent: 50,
            urgency: 'high',
          };
        }
        
        return {
          action: 'exit_full',
          reason: `Take-Profit hit: Price $${position.currentPrice.toFixed(2)} reached TP $${position.takeProfit.toFixed(2)} (+${pnlPercent.toFixed(2)}%)`,
          confidence: 1.0,
          urgency: 'high',
        };
      }
    }
    
    // 1. Check for CRITICAL loss (emergency exit)
    // Phase 40 FIX: Reduced from -5% to -2.5% — 68 trades were bleeding to -5% causing -$204 loss
    // The hard stop at -0.8% should catch most, but this is the absolute safety net
    //
    // Phase 8 FIX: read the emergency floor from config instead of hardcoding -2.5%.
    //   Post-Phase 7, `catastrophicStopPercent` === `hardStopLossPercent` === -1.2%.
    //   The old -2.5% hardcode meant this "absolute safety net" actually fired
    //   1.3% *after* the real hard stop — turning a -1.2% loss into a -2.5% loss
    //   whenever `position.stopLoss` was missing/corrupted and the SL check at
    //   the top of this method couldn't catch it. Reading from the same config
    //   field puts the safety net at the hard-stop level, where it belongs.
    const emergencyFloor = getTradingConfig().profitLock?.catastrophicStopPercent ?? -2.5;
    if (pnlPercent <= emergencyFloor) {
      return {
        action: 'exit_full',
        reason: `Emergency exit: Position down ${pnlPercent.toFixed(2)}% (limit: ${emergencyFloor.toFixed(2)}%)`,
        confidence: 1.0,
        urgency: 'critical',
      };
    }
    
    // 2. Check breakeven activation — Phase 5: actually moves position.stopLoss
    //    to entry+buffer so the hard-SL check above fires at breakeven on the
    //    next tick, rather than relying on the fragile secondary pnl check.
    if (!position.breakevenActivated && pnlPercent >= this.config.breakevenActivationPercent) {
      this.activateBreakeven(position);
    }
    
    // 3. Check if price has fallen back to breakeven after being profitable
    if (position.breakevenActivated && pnlPercent <= this.config.breakevenBuffer) {
      return {
        action: 'exit_full',
        reason: `Breakeven exit: Price returned to entry after reaching +${position.highestPrice ? ((position.highestPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2) : '?'}%`,
        confidence: 1.0,
        urgency: 'high',
      };
    }
    
    // 4. Check partial profit levels
    for (const level of this.config.partialProfitLevels) {
      const adjustedLevel = level.pnlPercent * regimeMultiplier;
      
      // Check if we've reached this level and haven't taken this partial yet
      if (pnlPercent >= adjustedLevel) {
        const alreadyTaken = position.partialExits.some(
          exit => Math.abs(exit.pnlPercent - adjustedLevel) < 0.1
        );
        
        if (!alreadyTaken && position.remainingQuantity > position.quantity * 0.25) {
          return {
            action: 'exit_partial',
            reason: `Partial profit at +${pnlPercent.toFixed(2)}% (target: ${adjustedLevel.toFixed(1)}%)`,
            confidence: 0.9,
            exitPercent: level.exitPercent,
            urgency: 'medium',
          };
        }
      }
    }
    
    // 5. Check trailing stop (for remaining position after partials)
    // Phase 3 Enhancement: ATR-based and regime-aware trailing
    if (pnlPercent >= this.config.trailingActivationPercent * regimeMultiplier) {
      const peakPnl = position.side === 'long'
        ? ((position.highestPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - position.lowestPrice) / position.entryPrice) * 100;
      
      const drawdownFromPeak = peakPnl - pnlPercent;
      
      // Calculate trailing threshold - use ATR if available, otherwise percentage
      let trailingThreshold: number;
      let trailingMethod: string;
      
      if (this.config.useATRTrailing && position.atr && position.atr > 0) {
        // ATR-based trailing: trail by ATR * multiplier * regime adjustment
        const atrTrailingDistance = position.atr * this.config.atrTrailingMultiplier * regimeMultiplier;
        trailingThreshold = (atrTrailingDistance / position.entryPrice) * 100; // Convert to percentage
        trailingMethod = 'ATR-based';
      } else {
        // Percentage-based trailing (fallback)
        trailingThreshold = this.config.trailingPercent * regimeMultiplier;
        trailingMethod = 'percentage-based';
      }
      
      if (drawdownFromPeak >= trailingThreshold) {
        return {
          action: 'exit_full',
          reason: `Trailing stop hit (${trailingMethod}): Dropped ${drawdownFromPeak.toFixed(2)}% from peak of +${peakPnl.toFixed(2)}% (threshold: ${trailingThreshold.toFixed(2)}%, regime: ${position.marketRegime || 'unknown'})`,
          confidence: 0.95,
          urgency: 'high',
        };
      }
    }
    
    // 6. Check time-based exit
    const holdTimeHours = (Date.now() - position.entryTime) / (1000 * 60 * 60);
    const maxHoldTime = this.config.maxHoldTimeHours * regimeMultiplier;
    
    if (holdTimeHours >= maxHoldTime) {
      if (pnlPercent >= this.config.minProfitForTimeExit) {
        return {
          action: 'exit_full',
          reason: `Time exit: Held for ${holdTimeHours.toFixed(1)}h (max: ${maxHoldTime.toFixed(1)}h) with +${pnlPercent.toFixed(2)}% profit`,
          confidence: 0.8,
          urgency: 'medium',
        };
      }
    }
    
    // 7. Check agent consensus (if available)
    if (position.agentSignals.length > 0) {
      const exitSignals = position.agentSignals.filter(s => s.signal === 'exit');
      const exitConsensus = exitSignals.length / position.agentSignals.length;
      
      if (exitConsensus >= this.config.exitConsensusThreshold) {
        const avgConfidence = exitSignals.reduce((sum, s) => sum + s.confidence, 0) / exitSignals.length;
        return {
          action: 'exit_full',
          reason: `Agent consensus exit: ${(exitConsensus * 100).toFixed(0)}% of agents recommend exit`,
          confidence: avgConfidence,
          urgency: avgConfidence > 0.8 ? 'high' : 'medium',
        };
      }
    }
    
    // Default: Hold
    return {
      action: 'hold',
      reason: 'No exit conditions met',
      confidence: 0.5,
      urgency: 'low',
    };
  }

  /**
   * Consult agents for all positions
   */
  private async consultAgentsForAllPositions(): Promise<void> {
    if (!this.getAgentSignals) return;
    
    for (const [positionId, position] of this.positions) {
      try {
        // Only check if enough time has passed since last check
        if (Date.now() - position.lastAgentCheck < this.config.agentCheckIntervalMs) {
          continue;
        }
        
        const signals = await this.getAgentSignals(position.symbol, position);
        position.agentSignals = signals;
        position.lastAgentCheck = Date.now();
        
        // Log agent consensus
        const exitCount = signals.filter(s => s.signal === 'exit').length;
        const holdCount = signals.filter(s => s.signal === 'hold').length;
        console.log(`[IntelligentExitManager] Agent signals for ${positionId}: ${exitCount} exit, ${holdCount} hold`);
        
      } catch (err) {
        console.error(`[IntelligentExitManager] Error getting agent signals for ${positionId}:`, err);
      }
    }
  }

  /**
   * Get all monitored positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if the manager is currently running
   */
  isMonitoringActive(): boolean {
    return this.isRunning;
  }

  /**
   * Phase 5 FIX — Live breakeven stop activation.
   *
   * When a position crosses `breakevenActivationPercent` in the money, we must
   * actually MOVE the stop-loss to entry + buffer — not just flip a flag.
   *
   * The prior behavior set `breakevenActivated = true` and relied on a
   * secondary check (`pnlPercent <= breakevenBuffer`) downstream. That
   * secondary check is fragile:
   *   - It races against the hard-SL block above it.
   *   - A fast price drop through breakeven all the way to the original
   *     wide stop (-1.2%) blows past it and realizes a real loss.
   *
   * By mutating `position.stopLoss` in place, the hard-SL check at the top
   * of `evaluateExitConditionsRaw` fires automatically at entry+buffer,
   * giving every winner an iron-clad floor once it's crossed activation.
   *
   * Idempotent — safe to call on every tick.
   */
  private activateBreakeven(position: Position): void {
    if (position.breakevenActivated) return;

    position.breakevenActivated = true;

    const bufferAmount = position.entryPrice * (this.config.breakevenBuffer / 100);
    const newStopLoss =
      position.side === 'long'
        ? position.entryPrice + bufferAmount
        : position.entryPrice - bufferAmount;

    const prevStopLoss = position.stopLoss;

    // Only ratchet the SL inward — never widen it. For a long at entry $100
    // with existing SL $99 (-1%), newStopLoss ≈ $100.10 (+0.1%). This is
    // always MORE protective at breakeven activation, but the defensive
    // comparison protects against any upstream paths that pre-tighten the stop.
    const isRatchetInward =
      prevStopLoss == null ||
      (position.side === 'long' ? newStopLoss > prevStopLoss : newStopLoss < prevStopLoss);

    if (isRatchetInward) {
      position.stopLoss = newStopLoss;
    }

    console.log(
      `[IntelligentExitManager] 🛡️ BREAKEVEN ACTIVATED: ${position.id} ${position.symbol} ` +
        `| SL moved from $${prevStopLoss?.toFixed(4) ?? 'none'} → $${position.stopLoss!.toFixed(4)} ` +
        `(entry: $${position.entryPrice.toFixed(4)}, PnL: +${position.unrealizedPnlPercent.toFixed(2)}%)`,
    );

    this.emit('breakeven_activated', {
      positionId: position.id,
      pnlPercent: position.unrealizedPnlPercent,
      newStopLoss: position.stopLoss,
      previousStopLoss: prevStopLoss,
      entryPrice: position.entryPrice,
      side: position.side,
    });
  }

  /**
   * Update position price manually (for testing or external price feeds)
   * DEPRECATED: Use onPriceTick() for real-time tick-by-tick monitoring
   */
  updatePrice(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId);
    if (!position) return;
    
    // Update price tracking
    position.currentPrice = currentPrice;
    
    // Update high/low tracking
    if (position.side === 'long') {
      position.highestPrice = Math.max(position.highestPrice, currentPrice);
    } else {
      position.lowestPrice = Math.min(position.lowestPrice, currentPrice);
    }
    
    // Calculate P&L
    if (position.side === 'long') {
      position.unrealizedPnl = (currentPrice - position.entryPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      position.unrealizedPnl = (position.entryPrice - currentPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }
    
    // Check for breakeven activation — Phase 5: actually moves position.stopLoss
    if (!position.breakevenActivated && position.unrealizedPnlPercent >= this.config.breakevenActivationPercent) {
      this.activateBreakeven(position);
    }
  }

  /**
   * MILLISECOND TICK-BY-TICK POSITION MONITORING
   * 
   * This is the core method for institutional-grade real-time exit management.
   * Called on EVERY WebSocket price tick for instant response.
   * 
   * Performance target: < 1ms per tick per position
   */
  async onPriceTick(symbol: string, price: number, timestamp: number = Date.now()): Promise<void> {
    // Store price in memory-optimized buffer ALWAYS (O(1), ~0.001ms)
    this.priceBufferManager.push(symbol, price, timestamp);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6 — Tick-exact P&L + breakeven tracking
    //
    // The 200ms debounce below prevents the heavy async exit evaluation
    // (consensus/agent-signals/regime fetches, priority exit rule eval) from
    // backlogging at 40-50 Hz tick rates. Before Phase 6, the debounce gated
    // the ENTIRE tick — including the O(1) synchronous price/P&L/peak/
    // breakeven update. That created a real hole:
    //
    //   t=0ms    tick @ +0.3% → processed, no breakeven (threshold 0.5%)
    //   t=50ms   tick @ +0.7% → SKIPPED (debounce) — breakeven MISSED
    //   t=100ms  tick @ +0.3% → SKIPPED (debounce)
    //   t=200ms  tick @ +0.1% → processed, still no breakeven
    //
    // The +0.7% peak is invisible to the position state; breakeven never fires;
    // a subsequent drop through entry turns a winner into a loser.
    //
    // Fix: run the cheap synchronous pass on EVERY tick — it's O(1) per
    // position, just arithmetic and a flag flip. Only debounce the heavy
    // async eval, which is what actually backlogs.
    // ─────────────────────────────────────────────────────────────────────────

    // Find positions for this symbol and sync their price/P&L/peak/breakeven
    // on every tick. Pure synchronous — safe at full websocket tick rate.
    const symbolPositions: Position[] = [];
    for (const [, position] of this.positions) {
      if (position.symbol === symbol) {
        symbolPositions.push(position);
        this.updatePositionPriceSync(position, price);
      }
    }

    if (symbolPositions.length === 0) return;

    // Phase 11 Fix 2: Debounce the HEAVY async eval — process at most once
    // per 200ms per symbol. At 47 ticks/sec, without debounce each tick
    // queued a 50-200ms async operation, creating a backlog that grew to
    // 186 seconds. With 200ms debounce, we process at most 5 evaluations/sec
    // per symbol — still fast enough for exits (priority rules now fire on
    // state that's already been updated synchronously above).
    const lastProcess = this.lastTickProcessTime.get(symbol) || 0;
    if (timestamp - lastProcess < this.TICK_DEBOUNCE_MS) return;
    this.lastTickProcessTime.set(symbol, timestamp);

    // Phase 11B: Notify PositionGuardian that exit manager is alive and processing
    // Phase 12: Use cached reference instead of dynamic import() on every tick
    if (this.positionGuardianRef === undefined && !this.positionGuardianLoadPromise) {
      this.positionGuardianLoadPromise = import('./PositionGuardian').then(({ getPositionGuardian }) => {
        this.positionGuardianRef = getPositionGuardian();
        this.positionGuardianLoadPromise = null;
      }).catch(() => {
        this.positionGuardianRef = null; // Mark as unavailable
        this.positionGuardianLoadPromise = null;
      });
    }
    if (this.positionGuardianRef) {
      this.positionGuardianRef.onExitManagerTick();
    }

    const tickStart = performance.now();

    // Process each position in parallel for maximum speed.
    // NOTE: updatePositionPriceSync already ran above on every tick — the
    // async eval below reads the freshly-updated position state.
    const exitPromises = symbolPositions.map(async (position) => {
      // Phase 11 Fix 5: Fetch consensus, agent signals, and regime IN PARALLEL
      // Before: 3 sequential awaits = 150-600ms per position per tick
      // After: 1 parallel await = 50-200ms per position per tick (3x faster)
      const defaultConsensus = position.currentConfidence ?? position.originalConsensus ?? 0.65;
      const [fetchedConsensus, fetchedSignals, fetchedRegime] = await Promise.all([
        this.getCurrentConsensus?.(symbol).catch(() => defaultConsensus) ?? Promise.resolve(defaultConsensus),
        this.getAgentSignals?.(position.symbol, position).catch(() => [] as AgentExitSignal[]) ?? Promise.resolve([] as AgentExitSignal[]),
        this.getMarketRegime?.(position.symbol).catch(() => 'unknown') ?? Promise.resolve('unknown'),
      ]);

      const currentConsensus = fetchedConsensus;

      // Get current direction from consensus cache
      const currentDirection = getCurrentDirection(symbol);

      // Calculate current combined score
      const currentCombinedScore = calculateCombinedScore(currentConsensus, 50);

      // Update position state for hard exit rules
      const now = Date.now();
      position.currentConfidence = currentConsensus;
      position.currentCombinedScore = currentCombinedScore;
      position.currentDirection = currentDirection;

      // Update peak if new high
      if (currentCombinedScore > (position.peakCombinedScore || 0)) {
        position.peakCombinedScore = currentCombinedScore;
        position.peakCombinedScoreTime = now;
      }

      // Also update legacy confidence tracking
      if (currentConsensus > (position.peakConfidence || 0)) {
        position.peakConfidence = currentConsensus;
        position.peakConfidenceTime = now;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // PRIORITY EXIT RULES (Emergency Fix - Feb 6, 2026)
      // Restructured to reduce confidence decay exits from 64.7% to <10%
      // Priority: Stop-loss → Max loser time → Profit targets → Protection → Max winner → Direction flip → Confidence decay
      // ═══════════════════════════════════════════════════════════════════════════
      if (this.config.useHardExitRules) {
        // Phase 5B: Gather agent intelligence for exit decisions
        let atrPercent: number | undefined;
        let orderFlowScore: number | undefined;
        let regimeMultiplier = 1.0;
        let agentExitConsensus;

        // Process agent signals (already fetched in parallel above)
        if (fetchedSignals.length > 0) {
          agentExitConsensus = aggregateAgentExitConsensus(fetchedSignals);

          const techAgent = fetchedSignals.find(a => a.agentName === 'TechnicalAnalyst');
          if (techAgent?.evidence?.atr && position.currentPrice > 0) {
            atrPercent = (techAgent.evidence.atr / position.currentPrice) * 100;
          }

          const flowAgent = fetchedSignals.find(a => a.agentName === 'OrderFlowAnalyst');
          if (flowAgent?.evidence?.orderBookScore !== undefined) {
            orderFlowScore = flowAgent.evidence.orderBookScore;
          }
        }

        // Process regime (already fetched in parallel above)
        if (fetchedRegime !== 'unknown') {
          const regime = fetchedRegime;
          if (regime.includes('trend')) regimeMultiplier = 1.5;
          else if (regime.includes('range')) regimeMultiplier = 0.7;
          else if (regime.includes('volatile')) regimeMultiplier = 0.5;
        }

        // Build position object with full agent intelligence
        const priorityExitPosition: PriorityExitPosition = {
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          entryPrice: position.entryPrice,
          currentPrice: position.currentPrice,
          quantity: position.quantity,
          remainingQuantity: position.remainingQuantity,
          unrealizedPnlPercent: position.unrealizedPnlPercent,
          entryTime: position.entryTime,
          entryDirection: position.entryDirection || (position.side === 'long' ? 'bullish' : 'bearish'),
          entryCombinedScore: position.entryCombinedScore || 0.5,
          peakCombinedScore: position.peakCombinedScore || 0.5,
          peakCombinedScoreTime: position.peakCombinedScoreTime || position.entryTime,
          currentCombinedScore: currentCombinedScore,
          currentDirection: currentDirection || 'neutral',
          peakPnlPercent: position.peakPnlPercent || 0,
          targetsHit: position.targetsHit || {},
          recentPnlHistory: (position as any).recentPnlHistory,
          // Phase 5B: Agent intelligence fields
          atrPercent,
          agentExitConsensus,
          orderFlowScore,
          regimeMultiplier,
          recentOrderFlowHistory: (position as any).recentOrderFlowHistory,
        };

        // Track PnL history for momentum crash detection
        updatePnlHistory(priorityExitPosition, position.unrealizedPnlPercent);
        (position as any).recentPnlHistory = priorityExitPosition.recentPnlHistory;

        // Track order flow history for reversal detection
        if (orderFlowScore !== undefined) {
          updateOrderFlowHistory(priorityExitPosition, orderFlowScore);
          (position as any).recentOrderFlowHistory = priorityExitPosition.recentOrderFlowHistory;
        }

        // Evaluate priority exit rules (profit targets BEFORE confidence decay)
        const priorityExitDecision = evaluatePriorityExitRules(priorityExitPosition, DEFAULT_PRIORITY_EXIT_CONFIG);
        
        if (priorityExitDecision.shouldExit) {
          // Handle partial exits for profit targets
          const isPartialExit = priorityExitDecision.exitType === 'partial' && priorityExitDecision.partialPercent;
          
          const exitDecision: ExitDecision = {
            action: isPartialExit ? 'exit_partial' : 'exit_full',
            reason: `[${priorityExitDecision.rule}] ${priorityExitDecision.description}`,
            confidence: 1.0,
            urgency: priorityExitDecision.urgency || 'medium',
            exitPercent: priorityExitDecision.partialPercent,
          };
          
          // Log with appropriate emoji based on rule
          const emoji = priorityExitDecision.rule === 'AGENT_UNANIMOUS_EXIT' ? '🤖' :
                        priorityExitDecision.rule === 'AGENT_EXIT_CONSENSUS' ? '🧠' :
                        priorityExitDecision.rule === 'ATR_DYNAMIC_STOP' ? '📊' :
                        priorityExitDecision.rule === 'ATR_TRAILING_STOP' ? '📈' :
                        priorityExitDecision.rule === 'ORDER_FLOW_REVERSAL' ? '🌊' :
                        priorityExitDecision.rule?.includes('PROFIT_TARGET') ? '🎯' :
                        priorityExitDecision.rule === 'HARD_STOP_LOSS' ? '🛑' :
                        priorityExitDecision.rule === 'MOMENTUM_CRASH' ? '🛑' :
                        priorityExitDecision.rule === 'TRAILING_STOP' ? '📉' :
                        priorityExitDecision.rule === 'MAX_LOSER_TIME' ? '✂️' :
                        priorityExitDecision.rule === 'MAX_WINNER_TIME' ? '✅' :
                        priorityExitDecision.rule === 'DIRECTION_FLIP' ? '↩️' :
                        priorityExitDecision.rule === 'CONFIDENCE_DECAY_EXTREME' ? '⚠️' : '🚨';
          console.log(`[IntelligentExitManager] ${emoji} PRIORITY EXIT (${priorityExitDecision.rule}): ${position.id} - ${priorityExitDecision.description}`);
          
          // Update targetsHit if this was a profit target exit
          if (priorityExitDecision.rule === 'PROFIT_TARGET_0.5') {
            position.targetsHit = { ...position.targetsHit, target1: true };
          } else if (priorityExitDecision.rule === 'PROFIT_TARGET_1.5') {
            position.targetsHit = { ...position.targetsHit, target2: true };
          } else if (priorityExitDecision.rule === 'PROFIT_TARGET_3.0') {
            position.targetsHit = { ...position.targetsHit, target3: true };
          }
          
          await this.executeExitDecision(position, exitDecision);
          return;
        }
        
        // No priority exit triggered - continue holding
        return;
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // LEGACY EXIT LOGIC (if useHardExitRules is false)
      // Phase 5: Losing positions now routed to PriorityExitManager BEFORE confidence decay
      // ═══════════════════════════════════════════════════════════════════════════

      // Phase 5: For LOSING positions, use priority exit rules (hard stop, time, momentum)
      // instead of waiting for confidence decay (which is too slow for losers)
      if (position.unrealizedPnlPercent < 0) {
        const priorityPos: PriorityExitPosition = {
          id: position.id, symbol: position.symbol, side: position.side,
          entryPrice: position.entryPrice, currentPrice: position.currentPrice,
          quantity: position.quantity, remainingQuantity: position.remainingQuantity,
          unrealizedPnlPercent: position.unrealizedPnlPercent,
          entryTime: position.entryTime,
          entryDirection: position.entryDirection || (position.side === 'long' ? 'bullish' : 'bearish'),
          entryCombinedScore: position.entryCombinedScore || 0.5,
          peakCombinedScore: position.peakCombinedScore || 0.5,
          peakCombinedScoreTime: position.peakCombinedScoreTime || position.entryTime,
          currentCombinedScore: currentCombinedScore,
          currentDirection: currentDirection || 'neutral',
          peakPnlPercent: position.peakPnlPercent || 0,
          targetsHit: position.targetsHit || {},
          recentPnlHistory: (position as any).recentPnlHistory,
        };
        updatePnlHistory(priorityPos, position.unrealizedPnlPercent);
        (position as any).recentPnlHistory = priorityPos.recentPnlHistory;

        const priorityDecision = evaluatePriorityExitRules(priorityPos, DEFAULT_PRIORITY_EXIT_CONFIG);
        if (priorityDecision.shouldExit) {
          const exitDecision: ExitDecision = {
            action: priorityDecision.exitType === 'partial' ? 'exit_partial' : 'exit_full',
            reason: `[${priorityDecision.rule}] ${priorityDecision.description}`,
            confidence: 1.0,
            urgency: priorityDecision.urgency || 'high',
            exitPercent: priorityDecision.partialPercent,
          };
          console.log(`[IntelligentExitManager] PRIORITY EXIT (legacy path): ${position.id} - ${priorityDecision.rule}`);
          await this.executeExitDecision(position, exitDecision);
          return;
        }
      }

      // 3. Evaluate confidence decay exit (for WINNING/FLAT positions only per Phase 5)
      const decayDecision = this.confidenceDecayTracker.updateConfidence(
        position.id,
        currentConsensus,
        position.unrealizedPnlPercent
      );

      // Update position with latest confidence data
      position.exitThreshold = decayDecision.exitThreshold;

      // 4. Check confidence decay exit (now only fires for winning/flat positions per Phase 5 ConfidenceDecayTracker change)
      if (decayDecision.shouldExit) {
        const exitDecision: ExitDecision = {
          action: 'exit_full',
          reason: decayDecision.reason,
          confidence: 1.0 - (decayDecision.currentConfidence / decayDecision.peakConfidence),
          urgency: decayDecision.urgency,
        };
        console.log(`[IntelligentExitManager] CONFIDENCE DECAY EXIT: ${position.id} - ${decayDecision.reason}`);
        await this.executeExitDecision(position, exitDecision);
        return;
      }

      // 5. Fallback: Check catastrophic loss only (emergency protection)
      // Phase 40 FIX: Reduced from -5% to -2.5% — tighter safety net
      // Phase 8 FIX: read from config — see evaluateExitConditionsRaw for rationale.
      const emergencyFloor = getTradingConfig().profitLock?.catastrophicStopPercent ?? -2.5;
      if (position.unrealizedPnlPercent <= emergencyFloor) {
        const exitDecision: ExitDecision = {
          action: 'exit_full',
          reason: `Emergency exit: Position down ${position.unrealizedPnlPercent.toFixed(2)}% (limit: ${emergencyFloor.toFixed(2)}%)`,
          confidence: 1.0,
          urgency: 'critical',
        };
        console.log(`[IntelligentExitManager] EMERGENCY EXIT: ${position.id} - P&L: ${position.unrealizedPnlPercent.toFixed(2)}%`);
        await this.executeExitDecision(position, exitDecision);
        return;
      }
      
      // 6. No exit - agents still confident
    });
    
    await Promise.all(exitPromises);
    
    // Track performance
    const tickDuration = performance.now() - tickStart;
    if (tickDuration > 10) {
      console.warn(`[IntelligentExitManager] ⚠️ Slow tick processing: ${tickDuration.toFixed(2)}ms for ${symbol}`);
    }
    
    // Emit tick processed event for monitoring
    this.emit('tick_processed', {
      symbol,
      price,
      positionCount: symbolPositions.length,
      durationMs: tickDuration,
      timestamp,
    });
  }

  /**
   * Synchronous price update for maximum speed
   * No async calls, no logging - pure computation
   */
  private updatePositionPriceSync(position: Position, currentPrice: number): void {
    // Update price tracking
    position.currentPrice = currentPrice;
    
    // Update high/low tracking
    if (position.side === 'long') {
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
      }
    } else {
      if (currentPrice < position.lowestPrice) {
        position.lowestPrice = currentPrice;
      }
    }
    
    // Calculate P&L
    if (position.side === 'long') {
      position.unrealizedPnl = (currentPrice - position.entryPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      position.unrealizedPnl = (position.entryPrice - currentPrice) * position.remainingQuantity;
      position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }
    
    // Track peak P&L for trailing stop (NEW)
    if (position.peakPnlPercent === undefined || position.unrealizedPnlPercent > position.peakPnlPercent) {
      position.peakPnlPercent = position.unrealizedPnlPercent;
    }
    
    // Check for breakeven activation — Phase 5: actually moves position.stopLoss
    // Called in the HOT sync path (onPriceTick), so activateBreakeven's single
    // console.log fires exactly once per position (guarded by breakevenActivated).
    if (!position.breakevenActivated && position.unrealizedPnlPercent >= this.config.breakevenActivationPercent) {
      this.activateBreakeven(position);
    }
  }

  /**
   * Execute exit decision immediately
   */
  private async executeExitDecision(position: Position, decision: ExitDecision): Promise<void> {
    if (!this.executeExit) {
      console.error('[IntelligentExitManager] executeExit callback not set!');
      return;
    }

    // Phase 41: Exit guard — prevent duplicate exits on same position
    // Multiple price ticks can evaluate exit conditions concurrently.
    // Without this guard, all concurrent evaluations pass (position still in map)
    // and each fires executeExit, causing 2-3x duplicate POSITION_CLOSED events.
    // Phase 46: Lock at the START of executeExitDecision for ALL actions (full + partial)
    // using the exposed lockExit() primitive. unlockExit() runs in finally so every
    // exit path (success, no-op, error) releases the lock atomically.
    if (!this.lockExit(position.id)) {
      console.log(`[IntelligentExitManager] ⚠️ Skipping duplicate exit for ${position.id} (already exiting)`);
      return;
    }

    const exitStart = performance.now();

    try {
      let exitQuantity: number;

      if (decision.action === 'exit_full') {
        exitQuantity = position.remainingQuantity;
        console.log(`[IntelligentExitManager] 🚨 FULL EXIT: ${position.id} - ${decision.reason}`);
      } else if (decision.action === 'exit_partial' && decision.exitPercent) {
        exitQuantity = position.quantity * (decision.exitPercent / 100);
        console.log(`[IntelligentExitManager] 📊 PARTIAL EXIT (${decision.exitPercent}%): ${position.id} - ${decision.reason}`);
      } else {
        return; // No exit needed
      }

      // Determine pipeline event type from exit reason
      const exitEventType: PipelineEventType = this.classifyExitEvent(decision.reason);
      logPipelineEvent(exitEventType, {
        symbol: position.symbol,
        direction: position.side,
        action: decision.action === 'exit_full' ? 'close' : 'partial_close',
        price: position.currentPrice,
        quantity: exitQuantity,
        pnl: position.unrealizedPnl,
        pnlPercent: position.unrealizedPnlPercent,
        confidence: decision.confidence,
        reason: decision.reason,
        metadata: {
          positionId: position.id,
          urgency: decision.urgency,
          entryPrice: position.entryPrice,
          holdTimeMs: Date.now() - position.entryTime,
          breakevenActivated: position.breakevenActivated,
          partialExitsCount: position.partialExits.length,
        },
      });

      // Execute the exit
      await this.executeExit(position.id, exitQuantity, decision.reason);

      // Update position state
      position.remainingQuantity -= exitQuantity;

      // Record partial exit
      if (decision.action === 'exit_partial') {
        position.partialExits.push({
          timestamp: Date.now(),
          price: position.currentPrice,
          quantity: exitQuantity,
          pnlPercent: position.unrealizedPnlPercent,
          reason: decision.reason,
        });
      }

      // Remove position if fully exited
      if (position.remainingQuantity <= 0) {
        this.removePosition(position.id);
      }

      const exitDuration = performance.now() - exitStart;
      console.log(`[IntelligentExitManager] ⚡ Exit executed in ${exitDuration.toFixed(2)}ms`);

      this.emit('exit_executed', {
        positionId: position.id,
        action: decision.action,
        quantity: exitQuantity,
        reason: decision.reason,
        pnlPercent: position.unrealizedPnlPercent,
        durationMs: exitDuration,
      });

    } catch (err) {
      console.error(`[IntelligentExitManager] ❌ Exit execution failed: ${err}`);
      this.emit('exit_error', { positionId: position.id, error: err });
    } finally {
      // Phase 46: Always release lock — success, no-op return, or error.
      this.unlockExit(position.id);
    }
  }

  /**
   * Classify exit reason into pipeline event type
   */
  private classifyExitEvent(reason: string): PipelineEventType {
    const r = reason.toLowerCase();
    if (r.includes('emergency') || r.includes('critical loss') || r.includes('catastrophic') || r.includes('dead_mans') || r.includes('guardian')) return 'EXIT_EMERGENCY';
    if (r.includes('breakeven') || r.includes('break-even')) return 'EXIT_BREAKEVEN';
    if (r.includes('partial') || r.includes('profit target') || r.includes('scale out')) return 'EXIT_PARTIAL';
    if (r.includes('trailing') || r.includes('trail')) return 'EXIT_TRAILING';
    if (r.includes('agent') || r.includes('consensus') || r.includes('unanimous') || r.includes('direction flip') || r.includes('direction_flip')) return 'EXIT_AGENT_CONSENSUS';
    if (r.includes('time') || r.includes('decay') || r.includes('max hold') || r.includes('confidence decay')) return 'EXIT_TIME_DECAY';
    if (r.includes('stop') || r.includes('atr_dynamic') || r.includes('atr_trailing')) return 'EXIT_TRAILING';
    return 'POSITION_CLOSED'; // Generic close
  }

  /**
   * Get positions by symbol (for tick processing)
   */
  getPositionsBySymbol(symbol: string): Position[] {
    const result: Position[] = [];
    for (const position of this.positions.values()) {
      if (position.symbol === symbol) {
        result.push(position);
      }
    }
    return result;
  }

  /**
   * Evaluate a position and return exit decision (for testing)
   * This is a synchronous version that doesn't call async market regime
   */
  evaluatePosition(position: Position): ExitDecision {
    const pnlPercent = position.unrealizedPnlPercent;
    const regimeMultiplier = 1.0;
    
    // 1. Check for CRITICAL loss (emergency exit)
    if (pnlPercent <= -5) {
      return {
        action: 'exit_full',
        reason: 'Emergency exit: Position down 5%',
        confidence: 1.0,
        urgency: 'critical',
      };
    }
    
    // 2. Check breakeven exit
    if (position.breakevenActivated && pnlPercent <= this.config.breakevenBuffer) {
      return {
        action: 'exit_full',
        reason: `Breakeven exit: Price returned to entry`,
        confidence: 1.0,
        urgency: 'high',
      };
    }
    
    // 3. Check partial profit levels
    for (const level of this.config.partialProfitLevels) {
      const adjustedLevel = level.pnlPercent * regimeMultiplier;
      if (pnlPercent >= adjustedLevel) {
        const alreadyTaken = position.partialExits?.some(
          exit => Math.abs(exit.pnlPercent - adjustedLevel) < 0.1
        );
        
        if (!alreadyTaken && position.remainingQuantity > position.quantity * 0.25) {
          return {
            action: 'exit_partial',
            reason: `Partial profit at +${pnlPercent.toFixed(2)}%`,
            confidence: 0.9,
            exitPercent: level.exitPercent,
            urgency: 'medium',
          };
        }
      }
    }
    
    // 4. Check trailing stop
    if (pnlPercent >= this.config.trailingActivationPercent * regimeMultiplier) {
      const peakPnl = position.side === 'long'
        ? ((position.highestPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - position.lowestPrice) / position.entryPrice) * 100;
      const drawdownFromPeak = peakPnl - pnlPercent;
      const trailingThreshold = this.config.trailingPercent;
      
      if (drawdownFromPeak >= trailingThreshold) {
        return {
          action: 'exit_full',
          reason: `Trailing stop hit: Dropped ${drawdownFromPeak.toFixed(2)}% from peak`,
          confidence: 0.95,
          urgency: 'high',
        };
      }
    }
    
    // 5. Check time-based exit
    const holdTimeHours = (Date.now() - position.entryTime) / (1000 * 60 * 60);
    if (holdTimeHours >= this.config.maxHoldTimeHours) {
      if (pnlPercent >= this.config.minProfitForTimeExit) {
        return {
          action: 'exit_full',
          reason: `Time exit: Held for ${holdTimeHours.toFixed(1)}h`,
          confidence: 0.8,
          urgency: 'medium',
        };
      }
    }
    
    // Default: Hold
    return {
      action: 'hold',
      reason: 'No exit conditions met',
      confidence: 0.5,
      urgency: 'low',
    };
  }

  /**
   * Get status of all monitored positions
   */
  getStatus(): {
    isRunning: boolean;
    positionCount: number;
    positions: Position[];
  } {
    return {
      isRunning: this.isRunning,
      positionCount: this.positions.size,
      positions: Array.from(this.positions.values()),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IntelligentExitConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[IntelligentExitManager] Configuration updated');
  }

  /**
   * Get price buffer statistics for a symbol (Phase 4.2)
   * Useful for monitoring memory usage and buffer health
   */
  getPriceBufferStats(symbol: string): {
    count: number;
    capacity: number;
    vwap: number;
    sma: number;
    volatility: number;
    volatilityPercent: number;
    high: number;
    low: number;
    memoryUsageBytes: number;
  } | null {
    const buffer = this.priceBufferManager.getBuffer(symbol);
    if (!buffer || buffer.isEmpty()) return null;
    
    return {
      count: buffer.getCount(),
      capacity: buffer.getCapacity(),
      vwap: buffer.getVWAP(),
      sma: buffer.getSMA(),
      volatility: buffer.getVolatility(),
      volatilityPercent: buffer.getVolatilityPercent(),
      high: buffer.getHigh(),
      low: buffer.getLow(),
      memoryUsageBytes: buffer.getMemoryUsage(),
    };
  }

  /**
   * Get real-time volatility for a symbol (Phase 4.2)
   * Uses memory-optimized price buffer for O(1) calculation
   */
  getVolatility(symbol: string): number {
    return this.priceBufferManager.getVolatility(symbol);
  }

  /**
   * Get VWAP for a symbol (Phase 4.2)
   * Uses memory-optimized price buffer for O(1) calculation
   */
  getVWAP(symbol: string): number {
    return this.priceBufferManager.getVWAP(symbol);
  }

  /**
   * Get total memory usage across all price buffers (Phase 4.2)
   */
  getTotalPriceBufferMemory(): number {
    return this.priceBufferManager.getTotalMemoryUsage();
  }

  /**
   * Get all price buffer statistics (Phase 4.2)
   */
  getAllPriceBufferStats(): Record<string, ReturnType<typeof this.getPriceBufferStats>> {
    const stats: Record<string, ReturnType<typeof this.getPriceBufferStats>> = {};
    for (const symbol of this.priceBufferManager.getSymbols()) {
      stats[symbol] = this.getPriceBufferStats(symbol);
    }
    return stats;
  }

  /**
   * Sync in-memory position prices to database (every 5 seconds)
   * This ensures database has current prices for exit decisions
   */
  private async syncPositionsToDatabase(): Promise<void> {
    if (this.positions.size === 0) return;
    
    try {
      const { getDb } = await import('../db');
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      const db = await getDb();
      if (!db) return;
      
      let syncCount = 0;
      let skipCount = 0;
      for (const [positionId, position] of this.positions) {
        try {
          // Phase 40 FIX: Handle both numeric DB IDs and in-memory IDs (pos_xxx format)
          // The position_opened event uses in-memory ID, but dbPositionId is stored separately
          let dbPositionId = parseInt(positionId, 10);
          if (isNaN(dbPositionId)) {
            // Try to use the dbPositionId field stored on the position
            dbPositionId = position.dbPositionId || 0;
            if (!dbPositionId || dbPositionId <= 0) {
              skipCount++;
              continue;
            }
          }
          
          // Update database with current price, P&L, and consensus data
          const updateData: Record<string, any> = {
            currentPrice: position.currentPrice.toString(),
            unrealizedPnL: position.unrealizedPnl.toString(),
            unrealizedPnLPercent: position.unrealizedPnlPercent.toString(),
            updatedAt: new Date(),
          };
          
          // Sync consensus data if available
          if (position.currentConfidence !== undefined) {
            updateData.currentConfidence = position.currentConfidence.toString();
          }
          if (position.peakConfidence !== undefined && position.peakConfidence > 0) {
            updateData.peakConfidence = position.peakConfidence.toString();
          }
          if (position.peakConfidenceTime) {
            updateData.peakConfidenceTime = new Date(position.peakConfidenceTime);
          }
          
          await db.update(paperPositions)
            .set(updateData)
            .where(eq(paperPositions.id, dbPositionId));
          
          syncCount++;
        } catch (posErr) {
          // Silently skip individual position errors
        }
      }
      
      if (syncCount > 0 || skipCount > 0) {
        console.log(`[IntelligentExitManager] 💾 DB Sync: Updated ${syncCount} positions, skipped ${skipCount} (no dbPositionId)`);
      }
    } catch (err) {
      console.error('[IntelligentExitManager] DB sync failed:', err);
    }
  }
}

// Singleton instance
let exitManager: IntelligentExitManager | null = null;

export function getIntelligentExitManager(config?: Partial<IntelligentExitConfig>): IntelligentExitManager {
  if (!exitManager) {
    exitManager = new IntelligentExitManager(config);
  }
  return exitManager;
}

/**
 * Reset the singleton instance to force recreation with new config
 * Call this when config changes need to take effect
 */
export function resetIntelligentExitManager(): void {
  if (exitManager) {
    console.log('[IntelligentExitManager] Resetting singleton instance');
    exitManager = null;
  }
}
