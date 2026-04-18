/**
 * Risk Calculations Utilities
 * 
 * Institutional-grade risk management calculations:
 * - Kelly Criterion position sizing
 * - ATR-based dynamic stop-loss
 * - Volatility-adjusted parameters
 * - Regime-based adjustments
 */

/**
 * Calculate ATR (Average True Range) from OHLC data
 * 
 * @param candles Array of OHLC candles
 * @param period ATR period (default: 14)
 * @returns ATR value
 */
export function calculateATR(
  candles: Array<{ high: number; low: number; close: number }>,
  period: number = 14
): number {
  if (candles.length < period + 1) {
    throw new Error(`Insufficient data: need at least ${period + 1} candles`);
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  // Calculate initial ATR (simple average of first N true ranges)
  let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

  // Calculate exponential moving average for remaining periods
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Calculate Kelly Criterion position size
 * 
 * Formula: Position Size = (Win_Probability * Avg_Win - Loss_Probability * Avg_Loss) / (Avg_Win * 0.25)
 * 
 * @param winProbability Agent confidence (e.g., 0.75 for 75%)
 * @param avgWin Expected profit (e.g., 0.03 for 3%)
 * @param avgLoss Expected loss (e.g., 0.015 for 1.5% with 2:1 risk-reward)
 * @param accountBalance Total account balance
 * @returns Position size in quote currency (e.g., USDT)
 */
export function calculateKellyPosition(
  winProbability: number,
  avgWin: number,
  avgLoss: number,
  accountBalance: number
): {
  positionSize: number;
  kellyPercent: number;
  quarterKellyPercent: number;
} {
  const lossProbability = 1 - winProbability;

  // Kelly formula
  const kelly = (winProbability * avgWin - lossProbability * avgLoss) / (avgWin * 0.25);

  // Use Quarter Kelly for safety (institutional standard)
  const quarterKelly = kelly * 0.25;

  // Clamp to reasonable limits (max 5% of account per trade)
  const clampedKelly = Math.max(0, Math.min(quarterKelly, 0.05));

  const positionSize = accountBalance * clampedKelly;

  return {
    positionSize,
    kellyPercent: kelly,
    quarterKellyPercent: clampedKelly,
  };
}

/**
 * Calculate ATR-based dynamic stop-loss
 * 
 * Formula: Stop-Loss = Entry Price - (ATR * Multiplier)
 * Multiplier = 1.5-2.5 (higher for volatile markets)
 * 
 * @param entryPrice Entry price
 * @param atr Current ATR value
 * @param side Position side ("long" or "short")
 * @param volatilityMultiplier ATR multiplier (1.5-3.0, higher for volatile markets)
 * @returns Stop-loss price
 */
export function calculateATRStopLoss(
  entryPrice: number,
  atr: number,
  side: "long" | "short",
  volatilityMultiplier: number = 2.0
): number {
  const stopDistance = atr * volatilityMultiplier;

  if (side === "long") {
    return entryPrice - stopDistance;
  } else {
    return entryPrice + stopDistance;
  }
}

/**
 * Calculate ATR-based take-profit
 * 
 * @param entryPrice Entry price
 * @param stopLoss Stop-loss price
 * @param side Position side ("long" or "short")
 * @param riskRewardRatio Risk-reward ratio (default: 2.0 for 2:1)
 * @returns Take-profit price
 */
export function calculateATRTakeProfit(
  entryPrice: number,
  stopLoss: number,
  side: "long" | "short",
  riskRewardRatio: number = 2.0
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = risk * riskRewardRatio;

  if (side === "long") {
    return entryPrice + reward;
  } else {
    return entryPrice - reward;
  }
}

/**
 * Detect market regime for regime-based strategy switching
 * 
 * @param price Current price
 * @param sma50 50-period SMA
 * @param sma200 200-period SMA
 * @param atr Current ATR
 * @param avgATR Average ATR over longer period
 * @returns Market regime
 */
export function detectMarketRegime(
  price: number,
  sma50: number,
  sma200: number,
  atr: number,
  avgATR: number
): "trending_up" | "trending_down" | "range_bound" | "high_volatility" {
  const volatilityRatio = atr / avgATR;

  // High Volatility: ATR > 1.5x average
  if (volatilityRatio > 1.5) {
    return "high_volatility";
  }

  // Trending Up: Price > SMA50 > SMA200
  if (price > sma50 && sma50 > sma200) {
    return "trending_up";
  }

  // Trending Down: Price < SMA50 < SMA200
  if (price < sma50 && sma50 < sma200) {
    return "trending_down";
  }

  // Range-Bound: Price oscillating between support/resistance
  return "range_bound";
}

/**
 * Get regime-based parameters
 * 
 * @param regime Market regime
 * @returns Position size multiplier, stop-loss multiplier, profit target, strategy
 */
export function getRegimeParameters(regime: "trending_up" | "trending_down" | "range_bound" | "high_volatility"): {
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
  profitTargetPercent: number;
  strategy: string;
} {
  switch (regime) {
    case "trending_up":
      return {
        positionSizeMultiplier: 1.2,
        stopLossMultiplier: 2.5,
        profitTargetPercent: 5.0,
        strategy: "momentum",
      };
    case "trending_down":
      return {
        positionSizeMultiplier: 0.5,
        stopLossMultiplier: 2.0,
        profitTargetPercent: 2.0,
        strategy: "short_only",
      };
    case "range_bound":
      return {
        positionSizeMultiplier: 0.8,
        stopLossMultiplier: 1.5,
        profitTargetPercent: 2.0,
        strategy: "mean_reversion",
      };
    case "high_volatility":
      return {
        positionSizeMultiplier: 0.5,
        stopLossMultiplier: 3.0,
        profitTargetPercent: 3.0,
        strategy: "defensive",
      };
  }
}

/**
 * FIX #9: Calculate trailing stop distance with trend-strength adjustment
 * 
 * @param atr Current ATR
 * @param price Current price
 * @param trendStrength Optional trend strength indicator (0-1, default 0.5 for neutral)
 *   - Strong trend (>0.7): Use 2.0x ATR (wider stops to avoid whipsaws)
 *   - Medium trend (0.3-0.7): Use 1.5x ATR (balanced)
 *   - Weak trend (<0.3): Use 1.0x ATR (tighter stops to protect profits)
 * @returns Trailing stop distance adjusted for trend strength
 */
export function calculateTrailingDistance(
  atr: number,
  price: number,
  trendStrength?: number
): number {
  // Default to neutral trend strength if not provided
  const strength = trendStrength ?? 0.5;

  // Dynamic ATR multiplier based on trend strength
  let atrMultiplier: number;
  if (strength > 0.7) {
    atrMultiplier = 2.0; // Strong trend: wider stops
  } else if (strength < 0.3) {
    atrMultiplier = 1.0; // Weak trend: tighter stops
  } else {
    atrMultiplier = 1.5; // Medium trend: balanced
  }

  const atrDistance = atr * atrMultiplier;
  const percentDistance = price * 0.015; // 1.5% of price as minimum

  return Math.max(atrDistance, percentDistance);
}

/**
 * Calculate slippage and execution costs
 * 
 * @param orderSize Order size in quote currency
 * @param bidPrice Current bid price
 * @param askPrice Current ask price
 * @param orderBookDepth Order book depth at best bid/ask
 * @returns Total cost breakdown
 */
export function calculateExecutionCosts(
  orderSize: number,
  bidPrice: number,
  askPrice: number,
  orderBookDepth: number
): {
  spreadCost: number;
  impactCost: number;
  tradingFee: number;
  totalCost: number;
} {
  // Spread cost
  const spreadCost = (askPrice - bidPrice) / 2;

  // Impact cost (market impact based on order size vs order book depth)
  const impactCost = (orderSize / orderBookDepth) * 0.001;

  // Trading fee (0.1% for Binance)
  const tradingFee = orderSize * 0.001;

  const totalCost = spreadCost + impactCost + tradingFee;

  return {
    spreadCost,
    impactCost,
    tradingFee,
    totalCost,
  };
}

/**
 * Check if trade is profitable after costs
 * 
 * Rule: Only execute if Expected Profit > 2x Total Cost
 * 
 * @param expectedProfit Expected profit in quote currency
 * @param totalCost Total execution cost
 * @returns Whether trade should be executed
 */
export function shouldExecuteTrade(expectedProfit: number, totalCost: number): boolean {
  return expectedProfit > totalCost * 2;
}
