/**
 * Hard Exit Rules - Consensus-Based Exit System with Price-Aware Adjustment
 * 
 * CORE PRINCIPLE: Exits are driven by agent consensus, but with intelligent
 * adjustment when consensus becomes stale (agents not updating fast enough).
 * 
 * Exit Rules (Priority Order):
 * 1. Consensus Direction FLIPS → immediate exit (thesis invalidated)
 * 2. Combined Score drops 40% from peak → exit (consensus weakening)
 * 3. STALE CONSENSUS with adverse P&L → exit (agents not reacting to price)
 * 4. Capital rotation after 4.5h with no new peak → exit (stale position)
 * 5. Emergency loss -4.5% → exit (catastrophic protection only)
 * 
 * STALE CONSENSUS RULE (NEW):
 * If consensus hasn't changed significantly (within 5% of peak) for 10+ minutes
 * AND position is in loss (-1% or worse), the consensus is considered stale.
 * This handles the case where agents don't react fast enough to price drops.
 */

import { getLatestConsensusDirection, getLatestConsensus } from './AutomatedSignalProcessor';

export interface HardExitPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  remainingQuantity: number;
  unrealizedPnlPercent: number;
  entryTime: number;
  
  // Entry state (captured at trade entry)
  entryDirection: 'bullish' | 'bearish';
  entryCombinedScore: number;
  
  // Peak tracking (for 40% decay rule)
  peakCombinedScore: number;
  peakCombinedScoreTime: number;
  
  // Current state (updated on each tick)
  currentCombinedScore: number;
  currentDirection: 'bullish' | 'bearish' | null;
  
  // P&L tracking
  peakPnlPercent?: number;
}

export interface HardExitDecision {
  shouldExit: boolean;
  rule: 'DIRECTION_FLIP' | 'COMBINED_SCORE_DECAY' | 'STALE_CONSENSUS' | 'CAPITAL_ROTATION' | 'EMERGENCY_LOSS' | 'HOLD';
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  metrics: {
    currentDirection: string | null;
    entryDirection: string;
    currentCombinedScore: number;
    peakCombinedScore: number;
    exitThreshold: number;
    positionAgeHours: number;
    timeSinceLastPeakMinutes: number;
    unrealizedPnlPercent: number;
  };
}

export interface HardExitConfig {
  // Rule 2: Fixed decay ratio (40% = consensus must drop 40% from peak)
  decayRatio: number;
  
  // Rule 3: Stale consensus detection
  staleConsensusMinutes: number;      // How long consensus must be unchanged (10 min)
  staleConsensusThreshold: number;    // How close to peak to be considered "unchanged" (5%)
  staleConsensusLossPercent: number;  // Minimum loss to trigger stale exit (-1%)
  
  // Rule 4: Capital rotation
  maxPositionAgeHours: number;
  noPeakWindowMinutes: number;
  
  // Rule 5: Emergency loss (catastrophic protection only)
  emergencyLossPercent: number;
  
  // Minimum hold time before decay exits can trigger
  minHoldSecondsForDecayExit: number;
}

const DEFAULT_CONFIG: HardExitConfig = {
  // ✅ CRITICAL FIX: Increased decay ratio from 40% to 60%
  // 40% was too aggressive - positions were exiting on normal confidence fluctuations
  // 60% means exit only when score drops 60% from peak (more tolerance)
  decayRatio: 0.60,  // Was 0.40 - exit when combined score drops 60% from peak
  
  // Stale consensus detection
  staleConsensusMinutes: 10,       // Consensus unchanged for 10 minutes
  staleConsensusThreshold: 0.05,  // Within 5% of peak = unchanged
  staleConsensusLossPercent: -1,  // Must be in loss to trigger
  
  maxPositionAgeHours: 4.5,
  noPeakWindowMinutes: 60,
  emergencyLossPercent: -4.5,
  
  // ✅ CRITICAL: Minimum hold time before score decay exits can trigger
  // Agents need time to stabilize their analysis - 120 seconds minimum
  minHoldSecondsForDecayExit: 120,  // Wait at least 120 seconds before decay exits
};

/**
 * Evaluate Consensus-Based Exit Rules with Price-Aware Adjustment
 * 
 * This handles the case where agents don't update fast enough when price moves against us.
 */
export function evaluateHardExitRules(
  position: HardExitPosition,
  config: HardExitConfig = DEFAULT_CONFIG
): HardExitDecision {
  const now = Date.now();
  const positionAgeHours = (now - position.entryTime) / (1000 * 60 * 60);
  const positionAgeMinutes = positionAgeHours * 60;
  const positionAgeSeconds = positionAgeMinutes * 60;
  const timeSinceLastPeakMinutes = (now - position.peakCombinedScoreTime) / (1000 * 60);
  
  // Calculate exit threshold: Peak × (1 - decayRatio)
  const exitThreshold = position.peakCombinedScore * (1 - config.decayRatio);
  
  // ✅ CRITICAL FIX: Minimum hold time before score decay exits can trigger
  // This prevents premature exits during initial stabilization
  const minHoldSeconds = config.minHoldSecondsForDecayExit || 60;
  const withinMinHoldPeriod = positionAgeSeconds < minHoldSeconds;
  
  // Build metrics for logging/debugging
  const metrics = {
    currentDirection: position.currentDirection,
    entryDirection: position.entryDirection,
    currentCombinedScore: position.currentCombinedScore,
    peakCombinedScore: position.peakCombinedScore,
    exitThreshold,
    positionAgeHours,
    timeSinceLastPeakMinutes,
    unrealizedPnlPercent: position.unrealizedPnlPercent,
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE 1: Consensus Direction FLIPS → IMMEDIATE EXIT
  // ═══════════════════════════════════════════════════════════════════════════
  if (position.currentDirection !== null && position.currentDirection !== position.entryDirection) {
    return {
      shouldExit: true,
      rule: 'DIRECTION_FLIP',
      reason: `🔄 CONSENSUS FLIP: Entered ${position.entryDirection.toUpperCase()}, now ${position.currentDirection.toUpperCase()}. Trade thesis invalidated by agents.`,
      urgency: 'critical',
      metrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE 2: Combined Score drops 60% from peak → EXIT
  // ✅ CRITICAL FIX: Only apply AFTER minimum hold period to let agents stabilize
  // ═══════════════════════════════════════════════════════════════════════════
  if (!withinMinHoldPeriod && position.currentCombinedScore <= exitThreshold) {
    const decayPercent = ((position.peakCombinedScore - position.currentCombinedScore) / position.peakCombinedScore * 100).toFixed(1);
    return {
      shouldExit: true,
      rule: 'COMBINED_SCORE_DECAY',
      reason: `📉 CONSENSUS DECAY: Score dropped ${decayPercent}% from peak. Current: ${(position.currentCombinedScore * 100).toFixed(1)}% ≤ Threshold: ${(exitThreshold * 100).toFixed(1)}%`,
      urgency: 'high',
      metrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE 3: STALE CONSENSUS with adverse P&L → EXIT
  // ═══════════════════════════════════════════════════════════════════════════
  // If consensus hasn't changed significantly AND we're in loss, agents aren't reacting
  // This is the key fix for when only PatternMatcher is contributing
  const consensusChangeFromPeak = Math.abs(position.peakCombinedScore - position.currentCombinedScore) / position.peakCombinedScore;
  const isConsensusStale = consensusChangeFromPeak <= config.staleConsensusThreshold;
  const isInLoss = position.unrealizedPnlPercent <= config.staleConsensusLossPercent;
  const isOldEnough = positionAgeMinutes >= config.staleConsensusMinutes;
  
  if (isConsensusStale && isInLoss && isOldEnough) {
    return {
      shouldExit: true,
      rule: 'STALE_CONSENSUS',
      reason: `⚠️ STALE CONSENSUS: Consensus unchanged (${(consensusChangeFromPeak * 100).toFixed(1)}% from peak) for ${positionAgeMinutes.toFixed(0)} min while P&L is ${position.unrealizedPnlPercent.toFixed(2)}%. Agents not reacting to price drop.`,
      urgency: 'high',
      metrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE 4: Capital Rotation
  // ═══════════════════════════════════════════════════════════════════════════
  if (positionAgeHours >= config.maxPositionAgeHours && timeSinceLastPeakMinutes >= config.noPeakWindowMinutes) {
    return {
      shouldExit: true,
      rule: 'CAPITAL_ROTATION',
      reason: `⏰ CAPITAL ROTATION: Position held ${positionAgeHours.toFixed(1)}h with no new consensus peak in ${timeSinceLastPeakMinutes.toFixed(0)} minutes.`,
      urgency: 'medium',
      metrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RULE 5: Emergency Loss
  // ═══════════════════════════════════════════════════════════════════════════
  if (position.unrealizedPnlPercent <= config.emergencyLossPercent) {
    return {
      shouldExit: true,
      rule: 'EMERGENCY_LOSS',
      reason: `🚨 EMERGENCY EXIT: Position down ${position.unrealizedPnlPercent.toFixed(2)}% (catastrophic threshold: ${config.emergencyLossPercent}%)`,
      urgency: 'critical',
      metrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NO EXIT - Continue holding
  // ═══════════════════════════════════════════════════════════════════════════
  return {
    shouldExit: false,
    rule: 'HOLD',
    reason: `✅ HOLDING: Consensus ${(position.currentCombinedScore * 100).toFixed(1)}% > ${(exitThreshold * 100).toFixed(1)}% threshold. Direction: ${position.currentDirection}. P&L: ${position.unrealizedPnlPercent.toFixed(2)}%`,
    urgency: 'low',
    metrics,
  };
}

/**
 * Update position with latest market data
 */
export function updatePositionState(
  position: HardExitPosition,
  currentPrice: number,
  currentCombinedScore: number,
  currentDirection: 'bullish' | 'bearish' | null
): void {
  const now = Date.now();
  
  // Update price and P&L
  position.currentPrice = currentPrice;
  if (position.side === 'long') {
    position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }
  
  // Update combined score and direction
  position.currentCombinedScore = currentCombinedScore;
  position.currentDirection = currentDirection;
  
  // Update peak if new high
  if (currentCombinedScore > position.peakCombinedScore) {
    position.peakCombinedScore = currentCombinedScore;
    position.peakCombinedScoreTime = now;
    console.log(`[HardExitRules] 📈 New consensus peak for ${position.symbol}: ${(currentCombinedScore * 100).toFixed(1)}%`);
  }
}

/**
 * Create a new position for tracking
 */
export function createHardExitPosition(
  id: string,
  symbol: string,
  side: 'long' | 'short',
  entryPrice: number,
  quantity: number,
  entryCombinedScore: number,
  entryDirection: 'bullish' | 'bearish'
): HardExitPosition {
  const now = Date.now();
  
  return {
    id,
    symbol,
    side,
    entryPrice,
    currentPrice: entryPrice,
    quantity,
    remainingQuantity: quantity,
    unrealizedPnlPercent: 0,
    entryTime: now,
    entryDirection,
    entryCombinedScore,
    peakCombinedScore: entryCombinedScore,
    peakCombinedScoreTime: now,
    currentCombinedScore: entryCombinedScore,
    currentDirection: entryDirection,
  };
}

/**
 * Calculate Combined Score from consensus and execution score
 */
export function calculateCombinedScore(confidence: number, executionScore: number): number {
  return (confidence * 0.6) + ((executionScore / 100) * 0.4);
}

/**
 * Get current combined score for a symbol from the consensus cache
 */
export function getCurrentCombinedScore(symbol: string, executionScore: number = 50): number {
  const consensus = getLatestConsensus(symbol);
  if (consensus === null) return 0.5;
  return calculateCombinedScore(consensus, executionScore);
}

/**
 * Get current consensus direction for a symbol
 */
export function getCurrentDirection(symbol: string): 'bullish' | 'bearish' | null {
  return getLatestConsensusDirection(symbol);
}

export { DEFAULT_CONFIG as DEFAULT_HARD_EXIT_CONFIG };
