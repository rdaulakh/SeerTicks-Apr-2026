/**
 * Institutional-Grade Trading Enhancements
 * 
 * This module implements hedge fund-level trading logic for:
 * - Entry price validation (VWAP, spread, slippage)
 * - Stop loss placement (support/resistance integration)
 * - Take profit calculation (market structure, R:R validation)
 * - Risk management (portfolio heat, correlation adjustments)
 * 
 * Standards based on major crypto hedge funds and financial institutions.
 */

import { ExchangeInterface, MarketData } from "../exchanges";

/**
 * Entry Price Validation Result
 */
export interface EntryValidation {
  isValid: boolean;
  entryPrice: number;
  reason: string;
  vwap: number;
  spread: number;
  spreadPercent: number;
  estimatedSlippage: number;
  qualityScore: number; // 0-100, higher is better entry quality
}

/**
 * Stop Loss Calculation Result
 */
export interface StopLossResult {
  stopLossPrice: number;
  stopLossPercent: number;
  method: 'atr' | 'support' | 'hybrid' | 'max_loss';
  supportLevel?: number;
  atrDistance?: number;
  reasoning: string;
}

/**
 * Take Profit Calculation Result
 */
export interface TakeProfitResult {
  takeProfitPrice: number;
  takeProfitPercent: number;
  resistanceCluster: number[];
  riskRewardRatio: number;
  partialExits: {
    price: number;
    percent: number;
    riskUnits: number;
  }[];
  reasoning: string;
}

/**
 * Risk-Reward Validation Result
 */
export interface RiskRewardValidation {
  isValid: boolean;
  ratio: number;
  minRequired: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  expectedReturn: number;
  maxLoss: number;
  reasoning: string;
}

/**
 * Portfolio Heat Calculation
 */
export interface PortfolioHeat {
  totalHeat: number; // Sum of all position risks (percentage)
  positions: {
    symbol: string;
    positionSize: number;
    stopLossDistance: number;
    risk: number; // positionSize * stopLossDistance
  }[];
  isOverLimit: boolean;
  maxAllowed: number;
  availableRisk: number;
}

/**
 * Validate entry price using institutional standards
 * 
 * Checks:
 * 1. VWAP deviation (should be within ±0.5-1%)
 * 2. Bid-ask spread (should be <0.2% for BTC, <0.5% for altcoins)
 * 3. Slippage estimation based on order size
 * 4. Overall entry quality score
 * 
 * @param currentPrice Current market price
 * @param vwap Volume-weighted average price
 * @param bid Current bid price
 * @param ask Current ask price
 * @param orderSize Order size in base currency
 * @param orderBookDepth Order book depth at current price
 * @param symbol Trading symbol (for spread thresholds)
 * @returns Entry validation result
 */
export function validateEntryPrice(
  currentPrice: number,
  vwap: number,
  bid: number,
  ask: number,
  orderSize: number,
  orderBookDepth: number,
  symbol: string
): EntryValidation {
  // Calculate spread
  const spread = ask - bid;
  const spreadPercent = (spread / currentPrice) * 100;

  // Determine spread threshold based on asset
  const isBTC = symbol.includes('BTC');
  const maxSpreadPercent = isBTC ? 0.2 : 0.5; // 0.2% for BTC, 0.5% for altcoins

  // Check VWAP deviation
  const vwapDeviation = Math.abs((currentPrice - vwap) / vwap) * 100;
  const maxVWAPDeviation = 1.0; // 1% maximum deviation

  // Estimate slippage
  const estimatedSlippage = estimateSlippage(orderSize, orderBookDepth, spreadPercent);

  // Calculate quality score (0-100)
  let qualityScore = 100;

  // Penalize for VWAP deviation
  if (vwapDeviation > 0.5) {
    qualityScore -= (vwapDeviation - 0.5) * 20; // -20 points per 1% deviation
  }

  // Penalize for wide spread
  if (spreadPercent > maxSpreadPercent / 2) {
    qualityScore -= (spreadPercent - maxSpreadPercent / 2) * 40;
  }

  // Penalize for high slippage
  if (estimatedSlippage > 0.1) {
    qualityScore -= (estimatedSlippage - 0.1) * 30;
  }

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  // Validation logic
  let isValid = true;
  let reason = 'Entry price validated';

  if (vwapDeviation > maxVWAPDeviation) {
    isValid = false;
    reason = `Price deviates ${vwapDeviation.toFixed(2)}% from VWAP (max ${maxVWAPDeviation}%)`;
  } else if (spreadPercent > maxSpreadPercent) {
    isValid = false;
    reason = `Spread too wide: ${spreadPercent.toFixed(3)}% (max ${maxSpreadPercent}%)`;
  } else if (estimatedSlippage > 0.5) {
    isValid = false;
    reason = `Estimated slippage too high: ${estimatedSlippage.toFixed(2)}%`;
  } else if (qualityScore < 60) {
    isValid = false;
    reason = `Entry quality too low: ${qualityScore.toFixed(0)}/100`;
  }

  return {
    isValid,
    entryPrice: (bid + ask) / 2, // Use mid-price
    reason,
    vwap,
    spread,
    spreadPercent,
    estimatedSlippage,
    qualityScore,
  };
}

/**
 * Estimate slippage based on order size and order book depth
 * 
 * @param orderSize Order size in base currency
 * @param orderBookDepth Available liquidity at current price level
 * @param spreadPercent Current bid-ask spread percentage
 * @returns Estimated slippage percentage
 */
function estimateSlippage(
  orderSize: number,
  orderBookDepth: number,
  spreadPercent: number
): number {
  if (orderBookDepth === 0) {
    return spreadPercent * 2; // Assume 2x spread if no depth data
  }

  const depthRatio = orderSize / orderBookDepth;

  // Slippage model: base spread + impact based on order size
  let slippage = spreadPercent / 2; // Start with half spread (mid-price)

  if (depthRatio > 0.5) {
    // Large order relative to depth
    slippage += depthRatio * 0.5; // Add 0.5% per 100% of depth
  } else if (depthRatio > 0.2) {
    // Medium order
    slippage += depthRatio * 0.3;
  } else {
    // Small order
    slippage += depthRatio * 0.1;
  }

  return slippage;
}

/**
 * Calculate institutional-grade stop loss
 * 
 * Integrates:
 * 1. ATR-based volatility stop
 * 2. Support/resistance levels
 * 3. Maximum loss limits (1-2% hard cap)
 * 4. Buffer zone to avoid stop hunts
 * 
 * @param currentPrice Current market price
 * @param atr Average True Range
 * @param supportLevels Array of support levels (sorted, closest first)
 * @param side Position side ('long' or 'short')
 * @param maxLossPercent Maximum allowed loss percentage (default 2%)
 * @param accountBalance Account balance for position sizing
 * @returns Stop loss calculation result
 */
export function calculateInstitutionalStopLoss(
  currentPrice: number,
  atr: number,
  supportLevels: number[],
  side: 'long' | 'short',
  maxLossPercent: number = 2.0,
  accountBalance: number = 100000
): StopLossResult {
  // 1. Calculate ATR-based stop (2x ATR for long, 2.5x for short)
  const atrMultiplier = side === 'long' ? 2.0 : 2.5;
  const atrDistance = atr * atrMultiplier;
  const atrStopPrice = side === 'long' 
    ? currentPrice - atrDistance 
    : currentPrice + atrDistance;
  const atrStopPercent = Math.abs((atrStopPrice - currentPrice) / currentPrice) * 100;

  // 2. Find nearest support/resistance level
  let keyLevel: number | undefined;
  if (supportLevels && supportLevels.length > 0) {
    if (side === 'long') {
      // For long, find support below current price
      keyLevel = supportLevels.find(level => level < currentPrice);
    } else {
      // For short, find resistance above current price
      keyLevel = supportLevels.find(level => level > currentPrice);
    }
  }

  // 3. Apply buffer zone (0.5-1% below support to avoid stop hunts)
  const bufferPercent = 0.7; // 0.7% buffer
  let hybridStopPrice: number;
  let method: 'atr' | 'support' | 'hybrid' | 'max_loss' = 'atr';

  if (keyLevel) {
    // Use support/resistance with buffer
    const buffer = keyLevel * (bufferPercent / 100);
    const supportStopPrice = side === 'long' 
      ? keyLevel - buffer 
      : keyLevel + buffer;
    
    // Choose the tighter of ATR or support-based stop
    if (side === 'long') {
      hybridStopPrice = Math.max(atrStopPrice, supportStopPrice); // Tighter stop
    } else {
      hybridStopPrice = Math.min(atrStopPrice, supportStopPrice); // Tighter stop
    }
    
    method = 'hybrid';
  } else {
    // No support level, use ATR only
    hybridStopPrice = atrStopPrice;
    method = 'atr';
  }

  // 4. Enforce maximum loss limit (1-2% hard cap)
  const maxLossPrice = side === 'long'
    ? currentPrice * (1 - maxLossPercent / 100)
    : currentPrice * (1 + maxLossPercent / 100);

  let finalStopPrice = hybridStopPrice;
  const hybridStopPercent = Math.abs((hybridStopPrice - currentPrice) / currentPrice) * 100;

  if (hybridStopPercent > maxLossPercent) {
    // Stop too wide, enforce maximum loss
    finalStopPrice = maxLossPrice;
    method = 'max_loss';
  }

  const finalStopPercent = Math.abs((finalStopPrice - currentPrice) / currentPrice) * 100;

  // ✅ P0-3 FIX: Validate stop loss is reasonable (not too tight)
  const minStopPercent = 0.5; // 0.5% minimum stop distance
  if (finalStopPercent < minStopPercent) {
    console.warn(`[InstitutionalTrading] Stop loss too tight: ${finalStopPercent.toFixed(2)}% < ${minStopPercent}%`);
    // Widen stop to minimum distance
    finalStopPrice = side === 'long'
      ? currentPrice * (1 - minStopPercent / 100)
      : currentPrice * (1 + minStopPercent / 100);
  }

  // Build reasoning
  let reasoning = `Stop loss: ${finalStopPrice.toFixed(2)} (${finalStopPercent.toFixed(2)}%). `;
  
  if (method === 'hybrid') {
    reasoning += `Hybrid: ATR (${atrStopPercent.toFixed(2)}%) + Support ${keyLevel?.toFixed(2)} with ${bufferPercent}% buffer. `;
  } else if (method === 'atr') {
    reasoning += `ATR-based: ${atrMultiplier}x ATR (${atr.toFixed(2)}). `;
  } else if (method === 'max_loss') {
    reasoning += `Maximum loss enforced: ${maxLossPercent}% hard cap. `;
  }

  if (keyLevel) {
    reasoning += `Key level: ${keyLevel.toFixed(2)}. `;
  }

  return {
    stopLossPrice: finalStopPrice,
    stopLossPercent: finalStopPercent,
    method,
    supportLevel: keyLevel,
    atrDistance,
    reasoning,
  };
}

/**
 * Calculate institutional-grade take profit
 * 
 * Features:
 * 1. Resistance cluster identification
 * 2. Market structure analysis
 * 3. Risk-reward ratio validation (minimum 1:2)
 * 4. Risk-unit based partial exits
 * 5. Trend strength adjustment
 * 
 * @param currentPrice Current market price
 * @param stopLossPrice Stop loss price
 * @param resistanceLevels Array of resistance levels (sorted, closest first)
 * @param side Position side ('long' or 'short')
 * @param trendStrength Trend strength (0-1, from ADX or similar)
 * @param minRiskReward Minimum risk-reward ratio (default 2.0)
 * @returns Take profit calculation result
 */
export function calculateInstitutionalTakeProfit(
  currentPrice: number,
  stopLossPrice: number,
  resistanceLevels: number[],
  side: 'long' | 'short',
  trendStrength: number = 0.5,
  minRiskReward: number = 2.0
): TakeProfitResult {
  // Calculate risk (distance to stop loss)
  const risk = Math.abs(currentPrice - stopLossPrice);
  const riskPercent = (risk / currentPrice) * 100;

  // 1. Identify resistance cluster (multiple levels within 1-2%)
  const resistanceCluster = identifyResistanceCluster(resistanceLevels, currentPrice, side);

  // 2. Calculate minimum target based on risk-reward ratio
  const minReward = risk * minRiskReward;
  const minTargetPrice = side === 'long'
    ? currentPrice + minReward
    : currentPrice - minReward;

  // 3. Find optimal target (resistance cluster or minimum R:R, whichever is further)
  let targetPrice: number;
  let targetReason = '';

  if (resistanceCluster.length > 0) {
    // Use resistance cluster, but place target 0.5% before to avoid rejection
    const clusterMid = resistanceCluster.reduce((sum, r) => sum + r, 0) / resistanceCluster.length;
    const buffer = clusterMid * 0.005; // 0.5% buffer
    const resistanceTarget = side === 'long' 
      ? clusterMid - buffer 
      : clusterMid + buffer;

    // Check if resistance target meets minimum R:R
    const resistanceReward = Math.abs(resistanceTarget - currentPrice);
    const resistanceRR = resistanceReward / risk;

    if (resistanceRR >= minRiskReward) {
      // Resistance target is good
      targetPrice = resistanceTarget;
      targetReason = `Resistance cluster at ${clusterMid.toFixed(2)} (${resistanceCluster.length} levels), target 0.5% before. R:R = ${resistanceRR.toFixed(2)}`;
    } else {
      // Resistance too close, use minimum R:R target
      targetPrice = minTargetPrice;
      targetReason = `Resistance too close (R:R ${resistanceRR.toFixed(2)}), using minimum R:R ${minRiskReward}:1 target`;
    }
  } else {
    // No resistance cluster, use minimum R:R target
    targetPrice = minTargetPrice;
    targetReason = `No resistance cluster found, using minimum R:R ${minRiskReward}:1 target`;
  }

  // 4. Adjust for trend strength
  if (trendStrength > 0.7) {
    // Strong trend: extend target by 20%
    const extension = Math.abs(targetPrice - currentPrice) * 0.2;
    targetPrice = side === 'long' 
      ? targetPrice + extension 
      : targetPrice - extension;
    targetReason += ` Extended 20% for strong trend (${(trendStrength * 100).toFixed(0)}%)`;
  } else if (trendStrength < 0.3) {
    // Weak trend: reduce target by 10%
    const reduction = Math.abs(targetPrice - currentPrice) * 0.1;
    targetPrice = side === 'long' 
      ? targetPrice - reduction 
      : targetPrice + reduction;
    targetReason += ` Reduced 10% for weak trend (${(trendStrength * 100).toFixed(0)}%)`;
  }

  const takeProfitPercent = Math.abs((targetPrice - currentPrice) / currentPrice) * 100;
  const finalRR = Math.abs(targetPrice - currentPrice) / risk;

  // ✅ P0-3 FIX: Validate SL/TP separation to prevent convergence
  const slTpDistance = Math.abs(targetPrice - stopLossPrice);
  const slTpDistancePercent = (slTpDistance / currentPrice) * 100;
  const minSeparation = 2.0; // Minimum 2% separation between SL and TP
  
  if (slTpDistancePercent < minSeparation) {
    console.warn(`[InstitutionalTrading] SL/TP too close: ${slTpDistancePercent.toFixed(2)}% < ${minSeparation}%`);
    // Widen TP to maintain minimum separation
    const minSeparationDistance = currentPrice * (minSeparation / 100);
    targetPrice = side === 'long'
      ? stopLossPrice + minSeparationDistance
      : stopLossPrice - minSeparationDistance;
    targetReason += ` [Adjusted: SL/TP separation enforced]`;
  }

  // Recalculate after potential adjustment
  const adjustedTakeProfitPercent = Math.abs((targetPrice - currentPrice) / currentPrice) * 100;
  const adjustedFinalRR = Math.abs(targetPrice - currentPrice) / risk;

  // 5. Calculate risk-unit based partial exits
  const partialExits = calculatePartialExits(currentPrice, stopLossPrice, targetPrice, side);

  return {
    takeProfitPrice: targetPrice,
    takeProfitPercent: adjustedTakeProfitPercent,
    resistanceCluster,
    riskRewardRatio: adjustedFinalRR,
    partialExits,
    reasoning: targetReason,
  };
}

/**
 * Identify resistance cluster (multiple levels within 1-2%)
 */
function identifyResistanceCluster(
  levels: number[],
  currentPrice: number,
  side: 'long' | 'short'
): number[] {
  if (!levels || levels.length === 0) {
    return [];
  }

  // Filter levels in the direction of the trade
  const relevantLevels = side === 'long'
    ? levels.filter(level => level > currentPrice)
    : levels.filter(level => level < currentPrice);

  if (relevantLevels.length === 0) {
    return [];
  }

  // Sort by proximity to current price
  relevantLevels.sort((a, b) => 
    Math.abs(a - currentPrice) - Math.abs(b - currentPrice)
  );

  // Find cluster (levels within 2% of each other)
  const cluster: number[] = [relevantLevels[0]];
  const clusterThreshold = 0.02; // 2%

  for (let i = 1; i < relevantLevels.length; i++) {
    const level = relevantLevels[i];
    const clusterMid = cluster.reduce((sum, l) => sum + l, 0) / cluster.length;
    const deviation = Math.abs((level - clusterMid) / clusterMid);

    if (deviation <= clusterThreshold) {
      cluster.push(level);
    } else {
      // Cluster complete
      break;
    }
  }

  return cluster.length >= 2 ? cluster : []; // Require at least 2 levels for a cluster
}

/**
 * Calculate risk-unit based partial exits
 * 
 * Institutional standard:
 * - 25% at +1R (breakeven, risk-free)
 * - 25% at +2R (2x initial risk)
 * - 25% at +3R (3x initial risk)
 * - 25% runner with trailing stop
 */
function calculatePartialExits(
  entryPrice: number,
  stopLossPrice: number,
  targetPrice: number,
  side: 'long' | 'short'
): { price: number; percent: number; riskUnits: number }[] {
  const risk = Math.abs(entryPrice - stopLossPrice);

  const exits = [
    { riskUnits: 1, percent: 25 },
    { riskUnits: 2, percent: 25 },
    { riskUnits: 3, percent: 25 },
    { riskUnits: 999, percent: 25 }, // Runner (use target price)
  ];

  return exits.map(exit => {
    let price: number;
    if (exit.riskUnits === 999) {
      // Runner uses final target
      price = targetPrice;
    } else {
      // Calculate price at risk units
      price = side === 'long'
        ? entryPrice + (risk * exit.riskUnits)
        : entryPrice - (risk * exit.riskUnits);
    }

    return {
      price,
      percent: exit.percent,
      riskUnits: exit.riskUnits,
    };
  });
}

/**
 * Validate risk-reward ratio before trade execution
 * 
 * Institutional standard: Minimum 1:2 R:R, preferably 1:3
 * 
 * @param entryPrice Entry price
 * @param stopLossPrice Stop loss price
 * @param takeProfitPrice Take profit price
 * @param minRatio Minimum acceptable risk-reward ratio (default 2.0)
 * @returns Risk-reward validation result
 */
export function validateRiskReward(
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number,
  minRatio: number = 2.0
): RiskRewardValidation {
  // ✅ P0-3 FIX: Validate SL and TP are not equal or too close
  const slTpDistance = Math.abs(takeProfitPrice - stopLossPrice) / entryPrice;
  const minDistance = 0.01; // 1% minimum distance between SL and TP
  
  if (slTpDistance < minDistance) {
    return {
      isValid: false,
      ratio: 0,
      minRequired: minRatio,
      entryPrice,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      expectedReturn: 0,
      maxLoss: 0,
      reasoning: `Stop-loss and take-profit too close: ${(slTpDistance * 100).toFixed(2)}% < ${(minDistance * 100).toFixed(2)}% minimum - TRADE REJECTED`,
    };
  }

  // ✅ P0-3 FIX: Validate SL and TP are on correct sides of entry
  const slDirection = stopLossPrice < entryPrice ? 'below' : 'above';
  const tpDirection = takeProfitPrice < entryPrice ? 'below' : 'above';
  
  if (slDirection === tpDirection) {
    return {
      isValid: false,
      ratio: 0,
      minRequired: minRatio,
      entryPrice,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      expectedReturn: 0,
      maxLoss: 0,
      reasoning: `Stop-loss and take-profit on same side of entry (both ${slDirection}) - TRADE REJECTED`,
    };
  }

  const risk = Math.abs(entryPrice - stopLossPrice);
  const reward = Math.abs(takeProfitPrice - entryPrice);
  const ratio = reward / risk;

  const maxLoss = (risk / entryPrice) * 100;
  const expectedReturn = (reward / entryPrice) * 100;

  const isValid = ratio >= minRatio;
  const reasoning = isValid
    ? `Risk-reward ratio ${ratio.toFixed(2)}:1 meets minimum ${minRatio}:1 requirement`
    : `Risk-reward ratio ${ratio.toFixed(2)}:1 below minimum ${minRatio}:1 requirement - TRADE REJECTED`;

  return {
    isValid,
    ratio,
    minRequired: minRatio,
    entryPrice,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    expectedReturn,
    maxLoss,
    reasoning,
  };
}

/**
 * Calculate portfolio heat (total risk across all positions)
 * 
 * Institutional standard: Maximum 10% portfolio heat at any time
 * 
 * @param positions Array of open positions with size and stop loss
 * @param maxHeat Maximum allowed portfolio heat percentage (default 10%)
 * @returns Portfolio heat calculation
 */
export function calculatePortfolioHeat(
  positions: {
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    stopLoss: number;
    accountBalance: number;
  }[],
  maxHeat: number = 10.0
): PortfolioHeat {
  const positionRisks = positions.map(pos => {
    const positionValue = pos.currentPrice * pos.quantity;
    const positionSize = (positionValue / pos.accountBalance) * 100;
    const stopLossDistance = Math.abs((pos.stopLoss - pos.currentPrice) / pos.currentPrice) * 100;
    const risk = (positionSize / 100) * stopLossDistance; // Risk as percentage of account

    return {
      symbol: pos.symbol,
      positionSize,
      stopLossDistance,
      risk,
    };
  });

  const totalHeat = positionRisks.reduce((sum, pos) => sum + pos.risk, 0);
  const isOverLimit = totalHeat > maxHeat;
  const availableRisk = Math.max(0, maxHeat - totalHeat);

  return {
    totalHeat,
    positions: positionRisks,
    isOverLimit,
    maxAllowed: maxHeat,
    availableRisk,
  };
}

/**
 * Adjust position size based on correlation with existing positions
 * 
 * Institutional standard: Reduce size by 50% for correlated positions
 * 
 * @param basePositionSize Base position size percentage
 * @param symbol New position symbol
 * @param existingPositions Array of existing positions
 * @param correlationMatrix Correlation matrix between symbols
 * @param correlationThreshold Threshold for considering positions correlated (default 0.7)
 * @returns Adjusted position size
 */
export function adjustPositionSizeForCorrelation(
  basePositionSize: number,
  symbol: string,
  existingPositions: { symbol: string; positionSize: number }[],
  correlationMatrix: Map<string, Map<string, number>>,
  correlationThreshold: number = 0.7
): { adjustedSize: number; reasoning: string; correlations: { symbol: string; correlation: number }[] } {
  let totalCorrelatedExposure = 0;
  const correlatedSymbols: { symbol: string; correlation: number }[] = [];

  for (const pos of existingPositions) {
    const correlation = correlationMatrix.get(symbol)?.get(pos.symbol) || 0;
    
    if (Math.abs(correlation) >= correlationThreshold) {
      totalCorrelatedExposure += pos.positionSize;
      correlatedSymbols.push({ symbol: pos.symbol, correlation });
    }
  }

  if (correlatedSymbols.length === 0) {
    return {
      adjustedSize: basePositionSize,
      reasoning: 'No correlated positions, using base size',
      correlations: [],
    };
  }

  // Calculate reduction factor based on correlation strength
  // Higher correlation = more reduction
  const avgCorrelation = correlatedSymbols.reduce((sum, c) => sum + Math.abs(c.correlation), 0) / correlatedSymbols.length;
  
  // Reduction: 30% for weak correlation (0.7), 50% for moderate (0.8), 70% for strong (0.9+)
  const reductionFactor = Math.min(0.7, 0.3 + (avgCorrelation - 0.7) * 2);
  const adjustedSize = basePositionSize * (1 - reductionFactor);
  
  const correlationList = correlatedSymbols.map(c => `${c.symbol} (${(c.correlation * 100).toFixed(0)}%)`).join(', ');
  const reasoning = `Reduced by ${(reductionFactor * 100).toFixed(0)}% due to ${correlatedSymbols.length} correlated positions: ${correlationList}. Total correlated exposure: ${totalCorrelatedExposure.toFixed(1)}%`;

  return {
    adjustedSize,
    reasoning,
    correlations: correlatedSymbols,
  };
}
