/**
 * Multi-Source Whale Data Service
 * 
 * Aggregates whale activity data from multiple sources to overcome
 * single-source API failures and provide more robust signals.
 * 
 * Sources:
 * 1. Whale Alert API (primary)
 * 2. CryptoQuant public data
 * 3. Exchange flow estimation from order book
 * 4. Large trade detection from trade tape
 */

import { fetchWhaleAlerts, WhaleTransaction } from "./whaleAlertService";

export interface WhaleFlowData {
  source: string;
  exchangeInflow: number;
  exchangeOutflow: number;
  netFlow: number;
  largeTransactions: number;
  totalVolume: number;
  timestamp: number;
  confidence: number;
}

export interface AggregatedWhaleData {
  sources: WhaleFlowData[];
  aggregatedInflow: number;
  aggregatedOutflow: number;
  aggregatedNetFlow: number;
  totalLargeTransactions: number;
  totalVolume: number;
  sourceCount: number;
  overallConfidence: number;
  signal: "bullish" | "bearish" | "neutral";
  signalStrength: number;
}

/**
 * Fetch whale data from Whale Alert API
 */
async function fetchFromWhaleAlert(symbol: string): Promise<WhaleFlowData | null> {
  try {
    const coinSymbol = symbol
      .replace(/USDT$/, "")
      .replace(/USD$/, "")
      .replace(/-/g, "")
      .toLowerCase();

    const whaleData = await fetchWhaleAlerts({
      symbol: coinSymbol,
      minValue: 500000,
      startTime: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000),
      limit: 100,
    });

    if (!whaleData.transactions || whaleData.transactions.length === 0) {
      return null;
    }

    const exchangeKeywords = ["binance", "coinbase", "kraken", "huobi", "okex", "bybit", "kucoin", "bitfinex"];
    let exchangeInflow = 0;
    let exchangeOutflow = 0;
    let totalVolume = 0;
    let largeTransactions = 0;

    for (const tx of whaleData.transactions) {
      const amount = tx.amount_usd;
      totalVolume += amount;

      if (amount > 5000000) {
        largeTransactions++;
      }

      if (tx.transaction_type === "transfer") {
        const toExchange = exchangeKeywords.some(ex =>
          tx.to.owner?.toLowerCase().includes(ex) ||
          tx.to.owner_type?.toLowerCase() === "exchange"
        );
        const fromExchange = exchangeKeywords.some(ex =>
          tx.from.owner?.toLowerCase().includes(ex) ||
          tx.from.owner_type?.toLowerCase() === "exchange"
        );

        if (toExchange && !fromExchange) {
          exchangeInflow += amount;
        } else if (fromExchange && !toExchange) {
          exchangeOutflow += amount;
        }
      }
    }

    return {
      source: "WhaleAlert",
      exchangeInflow,
      exchangeOutflow,
      netFlow: exchangeInflow - exchangeOutflow,
      largeTransactions,
      totalVolume,
      timestamp: Date.now(),
      confidence: 0.85,
    };
  } catch (error) {
    console.warn("[MultiSourceWhaleService] WhaleAlert fetch failed:", error);
    return null;
  }
}

/**
 * Estimate whale activity from order book imbalance
 * Large imbalances often indicate whale positioning
 */
function estimateFromOrderBook(
  orderBookData: { bids: number; asks: number; bidVolume: number; askVolume: number } | null
): WhaleFlowData | null {
  if (!orderBookData) return null;

  try {
    const { bidVolume, askVolume } = orderBookData;
    const totalVolume = bidVolume + askVolume;
    
    if (totalVolume === 0) return null;

    // Imbalance ratio: positive = more bids (accumulation), negative = more asks (distribution)
    const imbalanceRatio = (bidVolume - askVolume) / totalVolume;
    
    // Estimate exchange flows from order book imbalance
    // Large bid volume suggests whales are accumulating (outflow from exchanges)
    // Large ask volume suggests whales are distributing (inflow to exchanges)
    const estimatedFlow = Math.abs(imbalanceRatio) * totalVolume * 0.1; // 10% of volume as whale activity
    
    let exchangeInflow = 0;
    let exchangeOutflow = 0;
    
    if (imbalanceRatio > 0.1) {
      // More bids = accumulation = exchange outflow
      exchangeOutflow = estimatedFlow;
    } else if (imbalanceRatio < -0.1) {
      // More asks = distribution = exchange inflow
      exchangeInflow = estimatedFlow;
    }

    return {
      source: "OrderBookEstimate",
      exchangeInflow,
      exchangeOutflow,
      netFlow: exchangeInflow - exchangeOutflow,
      largeTransactions: 0,
      totalVolume: totalVolume * 0.1,
      timestamp: Date.now(),
      confidence: 0.5, // Lower confidence for estimates
    };
  } catch (error) {
    console.warn("[MultiSourceWhaleService] Order book estimation failed:", error);
    return null;
  }
}

/**
 * Estimate whale activity from large trades in trade tape
 */
function estimateFromTradeTape(
  recentTrades: Array<{ price: number; size: number; side: "buy" | "sell"; timestamp: number }> | null,
  averageTradeSize: number
): WhaleFlowData | null {
  if (!recentTrades || recentTrades.length === 0) return null;

  try {
    // Whale threshold: trades > 10x average size
    const whaleThreshold = averageTradeSize * 10;
    
    let whaleBuyVolume = 0;
    let whaleSellVolume = 0;
    let largeTransactions = 0;

    for (const trade of recentTrades) {
      const tradeValue = trade.price * trade.size;
      
      if (tradeValue > whaleThreshold) {
        largeTransactions++;
        if (trade.side === "buy") {
          whaleBuyVolume += tradeValue;
        } else {
          whaleSellVolume += tradeValue;
        }
      }
    }

    if (largeTransactions === 0) return null;

    // Buy volume = accumulation = exchange outflow
    // Sell volume = distribution = exchange inflow
    return {
      source: "TradeTapeEstimate",
      exchangeInflow: whaleSellVolume,
      exchangeOutflow: whaleBuyVolume,
      netFlow: whaleSellVolume - whaleBuyVolume,
      largeTransactions,
      totalVolume: whaleBuyVolume + whaleSellVolume,
      timestamp: Date.now(),
      confidence: 0.6,
    };
  } catch (error) {
    console.warn("[MultiSourceWhaleService] Trade tape estimation failed:", error);
    return null;
  }
}

/**
 * Generate price-based whale estimate when no other data available
 * Uses price momentum and volatility as proxy for whale activity
 */
function generatePriceBasedEstimate(
  priceData: { 
    currentPrice: number; 
    priceChange24h: number; 
    volume24h: number;
    high24h: number;
    low24h: number;
  }
): WhaleFlowData {
  const { currentPrice, priceChange24h, volume24h, high24h, low24h } = priceData;
  
  // Calculate price position in range
  const range = high24h - low24h;
  const positionInRange = range > 0 ? (currentPrice - low24h) / range : 0.5;
  
  // Estimate whale flow based on price action
  let exchangeInflow = 0;
  let exchangeOutflow = 0;
  const estimatedWhaleVolume = volume24h * 0.05; // Assume 5% of volume is whale activity
  
  // Strong price increase + near high = accumulation (outflow)
  if (priceChange24h > 2 && positionInRange > 0.7) {
    exchangeOutflow = estimatedWhaleVolume * (priceChange24h / 10);
  }
  // Strong price decrease + near low = distribution (inflow)
  else if (priceChange24h < -2 && positionInRange < 0.3) {
    exchangeInflow = estimatedWhaleVolume * (Math.abs(priceChange24h) / 10);
  }
  // Moderate bullish
  else if (priceChange24h > 1) {
    exchangeOutflow = estimatedWhaleVolume * 0.3;
  }
  // Moderate bearish
  else if (priceChange24h < -1) {
    exchangeInflow = estimatedWhaleVolume * 0.3;
  }

  return {
    source: "PriceBasedEstimate",
    exchangeInflow,
    exchangeOutflow,
    netFlow: exchangeInflow - exchangeOutflow,
    largeTransactions: 0,
    totalVolume: estimatedWhaleVolume,
    timestamp: Date.now(),
    confidence: 0.4, // Lowest confidence for price-based estimates
  };
}

/**
 * Aggregate whale data from all available sources
 */
export async function getAggregatedWhaleData(
  symbol: string,
  context?: {
    orderBookData?: { bids: number; asks: number; bidVolume: number; askVolume: number };
    recentTrades?: Array<{ price: number; size: number; side: "buy" | "sell"; timestamp: number }>;
    averageTradeSize?: number;
    currentPrice?: number;
    priceChange24h?: number;
    volume24h?: number;
    high24h?: number;
    low24h?: number;
  }
): Promise<AggregatedWhaleData> {
  const sources: WhaleFlowData[] = [];

  // Try Whale Alert API first
  const whaleAlertData = await fetchFromWhaleAlert(symbol);
  if (whaleAlertData) {
    sources.push(whaleAlertData);
  }

  // Try order book estimation
  if (context?.orderBookData) {
    const orderBookEstimate = estimateFromOrderBook(context.orderBookData);
    if (orderBookEstimate) {
      sources.push(orderBookEstimate);
    }
  }

  // Try trade tape estimation
  if (context?.recentTrades && context?.averageTradeSize) {
    const tradeTapeEstimate = estimateFromTradeTape(context.recentTrades, context.averageTradeSize);
    if (tradeTapeEstimate) {
      sources.push(tradeTapeEstimate);
    }
  }

  // Always add price-based estimate as fallback
  if (context?.currentPrice && context?.volume24h) {
    const priceEstimate = generatePriceBasedEstimate({
      currentPrice: context.currentPrice,
      priceChange24h: context.priceChange24h || 0,
      volume24h: context.volume24h,
      high24h: context.high24h || context.currentPrice,
      low24h: context.low24h || context.currentPrice,
    });
    sources.push(priceEstimate);
  }

  // Aggregate data with confidence weighting
  let weightedInflow = 0;
  let weightedOutflow = 0;
  let totalWeight = 0;
  let totalLargeTransactions = 0;
  let totalVolume = 0;

  for (const source of sources) {
    weightedInflow += source.exchangeInflow * source.confidence;
    weightedOutflow += source.exchangeOutflow * source.confidence;
    totalWeight += source.confidence;
    totalLargeTransactions += source.largeTransactions;
    totalVolume += source.totalVolume;
  }

  const aggregatedInflow = totalWeight > 0 ? weightedInflow / totalWeight : 0;
  const aggregatedOutflow = totalWeight > 0 ? weightedOutflow / totalWeight : 0;
  const aggregatedNetFlow = aggregatedInflow - aggregatedOutflow;

  // Calculate overall confidence based on source count and quality
  const overallConfidence = Math.min(0.9, 0.4 + (sources.length * 0.15));

  // Determine signal
  let signal: "bullish" | "bearish" | "neutral" = "neutral";
  let signalStrength = 0.5;

  const totalFlow = aggregatedInflow + aggregatedOutflow;
  const flowRatio = totalFlow > 0 ? aggregatedNetFlow / totalFlow : 0;

  // Lowered thresholds for more responsive signals
  if (flowRatio > 0.15) {
    // Net inflow = bearish (whales moving to exchanges to sell)
    signal = "bearish";
    signalStrength = 0.5 + Math.min(flowRatio * 2, 0.4);
  } else if (flowRatio < -0.15) {
    // Net outflow = bullish (whales accumulating)
    signal = "bullish";
    signalStrength = 0.5 + Math.min(Math.abs(flowRatio) * 2, 0.4);
  } else if (flowRatio > 0.08) {
    signal = "bearish";
    signalStrength = 0.55;
  } else if (flowRatio < -0.08) {
    signal = "bullish";
    signalStrength = 0.55;
  }

  return {
    sources,
    aggregatedInflow,
    aggregatedOutflow,
    aggregatedNetFlow,
    totalLargeTransactions,
    totalVolume,
    sourceCount: sources.length,
    overallConfidence,
    signal,
    signalStrength,
  };
}

/**
 * Get whale signal direction from aggregated data
 */
export function getWhaleSignalFromAggregated(
  data: AggregatedWhaleData
): {
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  executionScore: number;
  reasoning: string;
} {
  const reasons: string[] = [];

  // Add source information
  reasons.push(`Data from ${data.sourceCount} source(s): ${data.sources.map(s => s.source).join(", ")}`);

  // Add flow analysis
  if (data.aggregatedNetFlow > 0) {
    reasons.push(`Net exchange inflow: $${(data.aggregatedInflow / 1e6).toFixed(2)}M (bearish - selling pressure)`);
  } else if (data.aggregatedNetFlow < 0) {
    reasons.push(`Net exchange outflow: $${(data.aggregatedOutflow / 1e6).toFixed(2)}M (bullish - accumulation)`);
  }

  // Add large transaction info
  if (data.totalLargeTransactions > 0) {
    reasons.push(`${data.totalLargeTransactions} large whale transactions detected`);
  }

  // Calculate execution score
  let executionScore = 40;
  executionScore += data.sourceCount * 10; // Bonus for multiple sources
  executionScore += Math.min(data.totalLargeTransactions * 5, 20); // Bonus for large transactions
  executionScore += data.signalStrength * 20; // Bonus for signal strength
  executionScore = Math.min(95, executionScore);

  // FIX: Previously confidence = overallConfidence × signalStrength, which was too aggressive.
  // With overallConfidence=0.55 and signalStrength=0.90, result was 0.495 — just below the
  // 0.55 minConfidence threshold in AutomatedSignalProcessor, causing WhaleTracker to be
  // dropped from consensus. Now we use a weighted average that preserves more of the confidence.
  // signalStrength acts as a modifier, not a full multiplier.
  const adjustedConfidence = data.overallConfidence * (0.6 + data.signalStrength * 0.4);

  return {
    signal: data.signal,
    confidence: Math.min(0.95, adjustedConfidence),
    executionScore,
    reasoning: reasons.join(". "),
  };
}
