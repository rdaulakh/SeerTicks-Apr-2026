/**
 * Confidence Decay Tracker
 * 
 * Institutional-Grade Exit System Based on Agent Consensus Decay
 * 
 * Core Principle: Exit trades when agents meaningfully lose conviction, not on noise.
 * 
 * Formula: EXIT_THRESHOLD = PEAK_CONFIDENCE - (GAP × DECAY_RATIO)
 * Where:
 *   - GAP = PEAK_CONFIDENCE - ENTRY_CONFIDENCE
 *   - DECAY_RATIO = Adaptive based on P&L (50% profitable, 30% losing, 20% deep loss)
 * 
 * Key Features:
 * 1. Proportional decay model - exit threshold scales with conviction gap
 * 2. Adaptive decay ratio - faster exits for losing positions
 * 3. Floor protection - never exit below entry confidence
 * 4. Momentum consideration - faster exit on rapid confidence drops
 * 5. Time-weighted decay - tighter thresholds for longer holds
 * 6. No neutral agent dilution - only count agents with clear signals
 */

import { getTradingConfig } from '../config/TradingConfig';
import { getActiveClock } from '../_core/clock';

export interface ConfidenceTrackingState {
  positionId: string;
  symbol: string;
  entryConfidence: number;        // Consensus at trade entry
  peakConfidence: number;         // Highest consensus reached during trade
  currentConfidence: number;      // Current consensus
  entryTimestamp: number;         // When position was opened
  peakTimestamp: number;          // When peak was reached
  lastUpdateTimestamp: number;    // Last confidence update
  confidenceHistory: ConfidencePoint[];  // Rolling history for momentum
  exitThreshold: number;          // Current calculated exit threshold
  decayRatio: number;             // Current decay ratio being used
}

export interface ConfidencePoint {
  confidence: number;
  timestamp: number;
  pnlPercent: number;
}

export interface DecayExitDecision {
  shouldExit: boolean;
  reason: string;
  currentConfidence: number;
  peakConfidence: number;
  exitThreshold: number;
  gap: number;
  decayRatio: number;
  momentumFactor: number;
  timeDecayFactor: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface ConfidenceDecayConfig {
  // Entry threshold
  entryThreshold: number;              // Minimum consensus to enter (default: 0.65)
  
  // Base decay ratios (percentage of gap to tolerate)
  baseDecayRatio: number;              // For profitable positions (default: 0.50)
  losingDecayRatio: number;            // For losing positions (default: 0.30)
  deepLossDecayRatio: number;          // For deep loss positions (default: 0.20)
  
  // P&L thresholds for decay ratio selection
  losingThreshold: number;             // P&L below this = losing (default: -0.5%)
  deepLossThreshold: number;           // P&L below this = deep loss (default: -1.5%)
  
  // Momentum detection
  momentumWindowMs: number;            // Window for momentum calculation (default: 5000ms)
  rapidDropThreshold: number;          // Confidence drop rate that triggers urgency (default: 0.02/sec)
  
  // Time decay
  timeDecayStartHours: number;         // Start tightening threshold after this (default: 1h)
  timeDecayMaxReduction: number;       // Max reduction in decay ratio from time (default: 0.20)
  timeDecayFullHours: number;          // Full time decay applied after this (default: 4h)
  
  // History settings
  maxHistoryPoints: number;            // Max confidence points to keep (default: 100)
  
  // Floor protection
  floorBuffer: number;                 // Buffer above entry confidence for floor (default: 0.02)
  
  // Minimum hold time
  minHoldSecondsForDecayExit: number;  // Minimum seconds before decay exits can trigger (default: 60)
}

// Phase 18: entryThreshold from TradingConfig consensus (single source of truth)
const DEFAULT_CONFIG: ConfidenceDecayConfig = {
  entryThreshold: (() => { try { return getTradingConfig().consensus.minConsensusStrength; } catch { return 0.65; } })(),
  
  // Phase 40 FIX: Further relaxed decay ratios — confidence decay was #1 loss cause (-$710, 160 trades)
  // The system was exiting profitable positions too early on minor consensus fluctuations
  // 80%/60%/40% gives agents much more room to fluctuate before triggering exit
  baseDecayRatio: 0.80,      // Phase 40: relaxed from 0.70 — allow 80% of gap fluctuation for profitable
  losingDecayRatio: 0.60,    // Phase 40: relaxed from 0.50 — PriorityExitManager handles losers
  deepLossDecayRatio: 0.40,  // Phase 40: relaxed from 0.35 — hard stop catches deep losses
  
  losingThreshold: -0.5,
  deepLossThreshold: -1.5,
  
  momentumWindowMs: 5000,
  rapidDropThreshold: 0.02,
  
  timeDecayStartHours: 1,
  timeDecayMaxReduction: 0.20,
  timeDecayFullHours: 4,
  
  maxHistoryPoints: 100,
  
  // Phase 40: Keep floor buffer at 0 — entry = peak should not trigger immediate exit
  floorBuffer: 0.00,
  
  // Phase 40 FIX: Increased from 60s to 300s (5 minutes)
  // Confidence decay was killing positions within 1-2 minutes of entry
  // 5 minutes gives the trade time to develop before decay exits can trigger
  minHoldSecondsForDecayExit: 300,  // Phase 40: up from 60s — wait 5 min before decay exits
};

export class ConfidenceDecayTracker {
  private config: ConfidenceDecayConfig;
  private positions: Map<string, ConfidenceTrackingState> = new Map();
  
  constructor(config?: Partial<ConfidenceDecayConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[ConfidenceDecayTracker] Initialized with institutional-grade settings');
    console.log(`[ConfidenceDecayTracker] Entry threshold: ${this.config.entryThreshold * 100}%`);
    console.log(`[ConfidenceDecayTracker] Decay ratios: ${this.config.baseDecayRatio * 100}% base, ${this.config.losingDecayRatio * 100}% losing, ${this.config.deepLossDecayRatio * 100}% deep loss`);
  }

  /**
   * Register a new position for confidence tracking
   */
  registerPosition(positionId: string, symbol: string, entryConfidence: number): void {
    const now = getActiveClock().now();
    
    const state: ConfidenceTrackingState = {
      positionId,
      symbol,
      entryConfidence,
      peakConfidence: entryConfidence,
      currentConfidence: entryConfidence,
      entryTimestamp: now,
      peakTimestamp: now,
      lastUpdateTimestamp: now,
      confidenceHistory: [{
        confidence: entryConfidence,
        timestamp: now,
        pnlPercent: 0,
      }],
      exitThreshold: entryConfidence, // Initially, threshold = entry
      decayRatio: this.config.baseDecayRatio,
    };
    
    this.positions.set(positionId, state);
    console.log(`[ConfidenceDecayTracker] Registered position ${positionId} with entry confidence ${(entryConfidence * 100).toFixed(1)}%`);
  }

  /**
   * Update confidence for a position and evaluate exit
   * This is called on every tick for millisecond-level monitoring
   */
  updateConfidence(positionId: string, currentConfidence: number, pnlPercent: number): DecayExitDecision {
    const state = this.positions.get(positionId);
    
    if (!state) {
      return {
        shouldExit: false,
        reason: 'Position not tracked',
        currentConfidence,
        peakConfidence: 0,
        exitThreshold: 0,
        gap: 0,
        decayRatio: 0,
        momentumFactor: 1,
        timeDecayFactor: 1,
        urgency: 'low',
      };
    }
    
    const now = getActiveClock().now();
    
    // Update current confidence
    state.currentConfidence = currentConfidence;
    state.lastUpdateTimestamp = now;
    
    // Update peak if new high
    if (currentConfidence > state.peakConfidence) {
      state.peakConfidence = currentConfidence;
      state.peakTimestamp = now;
    }
    
    // Add to history (with pruning)
    state.confidenceHistory.push({
      confidence: currentConfidence,
      timestamp: now,
      pnlPercent,
    });
    
    if (state.confidenceHistory.length > this.config.maxHistoryPoints) {
      state.confidenceHistory.shift();
    }
    
    // Calculate exit decision
    return this.evaluateExit(state, pnlPercent);
  }

  /**
   * Core exit evaluation logic
   * Implements the proportional decay model with all institutional-grade features
   */
  private evaluateExit(state: ConfidenceTrackingState, pnlPercent: number): DecayExitDecision {
    const now = getActiveClock().now();

    // Phase 15C FIX: Enable confidence decay for ALL positions including losers.
    // Previously disabled for losers (Phase 5), causing them to bleed to -5% emergency exit
    // instead of exiting early when agents lose conviction.
    // PriorityExitManager still handles hard stops as safety net, but confidence decay
    // now provides early warning for losing positions too.
    // Only skip for very new positions (< 60 seconds) to avoid noise.
    if (pnlPercent < -0.3 && (now - state.entryTimestamp) < 60_000) {
      return {
        shouldExit: false,
        reason: `New losing position (${pnlPercent.toFixed(2)}%) - too early for decay`,
        currentConfidence: state.currentConfidence,
        peakConfidence: state.peakConfidence,
        exitThreshold: 0,
        gap: 0,
        decayRatio: this.config.baseDecayRatio,
        momentumFactor: 1,
        timeDecayFactor: 1,
        urgency: 'low',
      };
    }

    // ✅ CRITICAL FIX: Check minimum hold time before allowing decay exits
    // This prevents premature exits during the initial stabilization period
    const holdTimeSeconds = (now - state.entryTimestamp) / 1000;
    if (holdTimeSeconds < this.config.minHoldSecondsForDecayExit) {
      return {
        shouldExit: false,
        reason: `Holding: Within minimum hold period (${holdTimeSeconds.toFixed(0)}s < ${this.config.minHoldSecondsForDecayExit}s)`,
        currentConfidence: state.currentConfidence,
        peakConfidence: state.peakConfidence,
        exitThreshold: state.entryConfidence, // Use entry as threshold during hold period
        gap: 0,
        decayRatio: this.config.baseDecayRatio,
        momentumFactor: 1,
        timeDecayFactor: 1,
        urgency: 'low',
      };
    }
    
    // Phase 40 FIX: Disable confidence decay for PROFITABLE positions entirely
    // Confidence decay was the #1 loss cause — it was exiting winning trades too early
    // Let profit targets and trailing stops handle profitable exits instead
    if (pnlPercent > 0.1) {
      return {
        shouldExit: false,
        reason: `Profitable position (+${pnlPercent.toFixed(2)}%) — confidence decay disabled, using profit targets/trailing`,
        currentConfidence: state.currentConfidence,
        peakConfidence: state.peakConfidence,
        exitThreshold: 0,
        gap: 0,
        decayRatio: this.config.baseDecayRatio,
        momentumFactor: 1,
        timeDecayFactor: 1,
        urgency: 'low',
      };
    }

    // Phase 40 FIX: Require minimum gap before decay can trigger
    // When gap is tiny (peak barely above entry), any fluctuation triggers exit
    const gap = state.peakConfidence - state.entryConfidence;
    if (gap < 0.08) {
      return {
        shouldExit: false,
        reason: `Insufficient confidence gap (${(gap * 100).toFixed(1)}% < 8%) — too early for decay`,
        currentConfidence: state.currentConfidence,
        peakConfidence: state.peakConfidence,
        exitThreshold: state.entryConfidence,
        gap,
        decayRatio: this.config.baseDecayRatio,
        momentumFactor: 1,
        timeDecayFactor: 1,
        urgency: 'low',
      };
    }

    // 1. Calculate base decay ratio based on P&L
    let decayRatio: number;
    if (pnlPercent < this.config.deepLossThreshold) {
      decayRatio = this.config.deepLossDecayRatio;
    } else if (pnlPercent < this.config.losingThreshold) {
      decayRatio = this.config.losingDecayRatio;
    } else {
      decayRatio = this.config.baseDecayRatio;
    }
    
    // 2. Apply time decay (tighter thresholds for longer holds)
    const holdTimeHours = (now - state.entryTimestamp) / (1000 * 60 * 60);
    let timeDecayFactor = 1.0;
    
    if (holdTimeHours >= this.config.timeDecayStartHours) {
      const timeProgress = Math.min(
        (holdTimeHours - this.config.timeDecayStartHours) / 
        (this.config.timeDecayFullHours - this.config.timeDecayStartHours),
        1.0
      );
      // Reduce decay ratio over time (tighter exit threshold)
      timeDecayFactor = 1.0 - (timeProgress * this.config.timeDecayMaxReduction);
      decayRatio *= timeDecayFactor;
    }
    
    // 3. Calculate momentum factor (faster exit on rapid drops)
    const momentumFactor = this.calculateMomentumFactor(state);
    
    // 4. Calculate exit threshold (gap already computed above for minimum gap check)
    // Re-use the gap variable from Phase 40 minimum gap check above
    const decayAmount = gap * decayRatio * momentumFactor;
    let exitThreshold = state.peakConfidence - decayAmount;
    
    // 5. Apply floor protection (never exit below entry + buffer)
    const floor = state.entryConfidence + this.config.floorBuffer;
    exitThreshold = Math.max(exitThreshold, floor);
    
    // Update state
    state.exitThreshold = exitThreshold;
    state.decayRatio = decayRatio;
    
    // 6. Evaluate exit condition
    const shouldExit = state.currentConfidence <= exitThreshold;
    
    // 7. Determine urgency
    let urgency: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (shouldExit) {
      const dropFromPeak = state.peakConfidence - state.currentConfidence;
      const dropPercent = dropFromPeak / state.peakConfidence;
      
      if (dropPercent > 0.30 || pnlPercent < this.config.deepLossThreshold) {
        urgency = 'critical';
      } else if (dropPercent > 0.20 || pnlPercent < this.config.losingThreshold) {
        urgency = 'high';
      } else if (dropPercent > 0.10) {
        urgency = 'medium';
      }
    }
    
    // Build reason string
    let reason: string;
    if (shouldExit) {
      reason = `Confidence decay exit: ${(state.currentConfidence * 100).toFixed(1)}% <= ${(exitThreshold * 100).toFixed(1)}% threshold (peak: ${(state.peakConfidence * 100).toFixed(1)}%, gap: ${(gap * 100).toFixed(1)}%, decay: ${(decayRatio * 100).toFixed(0)}%)`;
    } else {
      reason = `Holding: ${(state.currentConfidence * 100).toFixed(1)}% > ${(exitThreshold * 100).toFixed(1)}% threshold`;
    }
    
    return {
      shouldExit,
      reason,
      currentConfidence: state.currentConfidence,
      peakConfidence: state.peakConfidence,
      exitThreshold,
      gap,
      decayRatio,
      momentumFactor,
      timeDecayFactor,
      urgency,
    };
  }

  /**
   * Calculate momentum factor for rapid confidence drops
   * Returns < 1.0 for rapid drops (tighter threshold), 1.0 for normal
   */
  private calculateMomentumFactor(state: ConfidenceTrackingState): number {
    const now = getActiveClock().now();
    const windowStart = now - this.config.momentumWindowMs;
    
    // Get recent history within momentum window
    const recentHistory = state.confidenceHistory.filter(p => p.timestamp >= windowStart);
    
    if (recentHistory.length < 2) {
      return 1.0; // Not enough data
    }
    
    // Calculate rate of change
    const oldest = recentHistory[0];
    const newest = recentHistory[recentHistory.length - 1];
    const timeDeltaSec = (newest.timestamp - oldest.timestamp) / 1000;
    
    if (timeDeltaSec < 0.1) {
      return 1.0; // Too short time span
    }
    
    const confidenceDelta = oldest.confidence - newest.confidence; // Positive = dropping
    const dropRate = confidenceDelta / timeDeltaSec;
    
    // If dropping rapidly, reduce decay ratio (tighter threshold)
    if (dropRate >= this.config.rapidDropThreshold) {
      // Rapid drop detected - reduce decay ratio by up to 50%
      const severity = Math.min(dropRate / this.config.rapidDropThreshold, 2.0);
      return Math.max(0.5, 1.0 - (severity * 0.25));
    }
    
    return 1.0;
  }

  /**
   * Get tracking state for a position
   */
  getState(positionId: string): ConfidenceTrackingState | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Remove a position from tracking
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId);
    console.log(`[ConfidenceDecayTracker] Removed position ${positionId} from tracking`);
  }

  /**
   * Get all tracked positions
   */
  getAllPositions(): ConfidenceTrackingState[] {
    return Array.from(this.positions.values());
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConfidenceDecayConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[ConfidenceDecayTracker] Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): ConfidenceDecayConfig {
    return { ...this.config };
  }

  /**
   * Calculate what the exit threshold would be for given parameters
   * Useful for UI display and testing
   */
  calculateExitThreshold(
    entryConfidence: number,
    peakConfidence: number,
    pnlPercent: number,
    holdTimeHours: number = 0
  ): {
    exitThreshold: number;
    decayRatio: number;
    gap: number;
    timeDecayFactor: number;
  } {
    // Calculate decay ratio based on P&L
    let decayRatio: number;
    if (pnlPercent < this.config.deepLossThreshold) {
      decayRatio = this.config.deepLossDecayRatio;
    } else if (pnlPercent < this.config.losingThreshold) {
      decayRatio = this.config.losingDecayRatio;
    } else {
      decayRatio = this.config.baseDecayRatio;
    }
    
    // Apply time decay
    let timeDecayFactor = 1.0;
    if (holdTimeHours >= this.config.timeDecayStartHours) {
      const timeProgress = Math.min(
        (holdTimeHours - this.config.timeDecayStartHours) / 
        (this.config.timeDecayFullHours - this.config.timeDecayStartHours),
        1.0
      );
      timeDecayFactor = 1.0 - (timeProgress * this.config.timeDecayMaxReduction);
      decayRatio *= timeDecayFactor;
    }
    
    // Calculate threshold
    const gap = peakConfidence - entryConfidence;
    const decayAmount = gap * decayRatio;
    let exitThreshold = peakConfidence - decayAmount;
    
    // Apply floor
    const floor = entryConfidence + this.config.floorBuffer;
    exitThreshold = Math.max(exitThreshold, floor);
    
    return {
      exitThreshold,
      decayRatio,
      gap,
      timeDecayFactor,
    };
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    trackedPositions: number;
    avgPeakConfidence: number;
    avgCurrentConfidence: number;
    positionsNearExit: number;
  } {
    const positions = this.getAllPositions();
    
    if (positions.length === 0) {
      return {
        trackedPositions: 0,
        avgPeakConfidence: 0,
        avgCurrentConfidence: 0,
        positionsNearExit: 0,
      };
    }
    
    const avgPeak = positions.reduce((sum, p) => sum + p.peakConfidence, 0) / positions.length;
    const avgCurrent = positions.reduce((sum, p) => sum + p.currentConfidence, 0) / positions.length;
    const nearExit = positions.filter(p => {
      const buffer = (p.peakConfidence - p.exitThreshold) * 0.2;
      return p.currentConfidence <= p.exitThreshold + buffer;
    }).length;
    
    return {
      trackedPositions: positions.length,
      avgPeakConfidence: avgPeak,
      avgCurrentConfidence: avgCurrent,
      positionsNearExit: nearExit,
    };
  }

  /**
   * Get statistics for a specific position
   */
  getPositionStats(positionId: string): {
    entryConfidence: number;
    peakConfidence: number;
    currentConfidence: number;
    exitThreshold: number;
    decayRatio: number;
    holdTimeMs: number;
  } | null {
    const state = this.positions.get(positionId);
    if (!state) {
      return null;
    }
    
    return {
      entryConfidence: state.entryConfidence,
      peakConfidence: state.peakConfidence,
      currentConfidence: state.currentConfidence,
      exitThreshold: state.exitThreshold,
      decayRatio: state.decayRatio,
      holdTimeMs: getActiveClock().now() - state.entryTimestamp,
    };
  }
}

// Singleton instance for global access
let confidenceDecayTrackerInstance: ConfidenceDecayTracker | null = null;

export function getConfidenceDecayTracker(config?: Partial<ConfidenceDecayConfig>): ConfidenceDecayTracker {
  // ✅ CRITICAL FIX: Always create new instance if config is provided
  // This ensures config changes take effect immediately
  if (config) {
    confidenceDecayTrackerInstance = new ConfidenceDecayTracker(config);
    console.log('[ConfidenceDecayTracker] Created new instance with custom config:', {
      baseDecayRatio: config.baseDecayRatio,
      minHoldSecondsForDecayExit: config.minHoldSecondsForDecayExit,
      floorBuffer: config.floorBuffer,
    });
  } else if (!confidenceDecayTrackerInstance) {
    confidenceDecayTrackerInstance = new ConfidenceDecayTracker();
  }
  return confidenceDecayTrackerInstance;
}

export function resetConfidenceDecayTracker(): void {
  confidenceDecayTrackerInstance = null;
}
