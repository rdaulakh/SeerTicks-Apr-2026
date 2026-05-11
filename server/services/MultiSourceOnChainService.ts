import { getActiveClock } from '../_core/clock';
/**
 * Multi-Source On-Chain Flow Service
 * 
 * Aggregates on-chain flow data from multiple sources to provide
 * more reliable exchange inflow/outflow signals.
 * 
 * Sources:
 * 1. CoinGlass API (exchange reserves, funding)
 * 2. Price-volume correlation estimation
 * 3. Order book imbalance proxy
 */

export interface OnChainFlowData {
  source: string;
  exchangeInflow: number;
  exchangeOutflow: number;
  netFlow: number;
  exchangeReserve: number;
  reserveChange24h: number;
  timestamp: number;
  confidence: number;
}

export interface AggregatedOnChainData {
  sources: OnChainFlowData[];
  aggregatedInflow: number;
  aggregatedOutflow: number;
  aggregatedNetFlow: number;
  exchangeReserve: number;
  reserveChange24h: number;
  sourceCount: number;
  overallConfidence: number;
  signal: "bullish" | "bearish" | "neutral";
  signalStrength: number;
  trend: "accumulation" | "distribution" | "neutral";
}

/**
 * Fetch exchange reserve data from CoinGlass
 */
async function fetchFromCoinGlass(symbol: string): Promise<OnChainFlowData | null> {
  try {
    // CoinGlass public API for exchange reserves
    const normalizedSymbol = symbol.replace(/USDT$/, "").toUpperCase();
    const url = `https://open-api.coinglass.com/public/v2/index/exchange_list?symbol=${normalizedSymbol}`;
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      return null;
    }

    // Aggregate exchange data
    let totalReserve = 0;
    let totalInflow = 0;
    let totalOutflow = 0;

    for (const exchange of data.data) {
      totalReserve += exchange.balance || 0;
      // Estimate flows from balance changes
      const balanceChange = exchange.balanceChange24h || 0;
      if (balanceChange > 0) {
        totalInflow += balanceChange;
      } else {
        totalOutflow += Math.abs(balanceChange);
      }
    }

    const reserveChange24h = data.data[0]?.balanceChangePercent24h || 0;

    return {
      source: "CoinGlass",
      exchangeInflow: totalInflow,
      exchangeOutflow: totalOutflow,
      netFlow: totalInflow - totalOutflow,
      exchangeReserve: totalReserve,
      reserveChange24h,
      timestamp: getActiveClock().now(),
      confidence: 0.8,
    };
  } catch (error) {
    console.warn("[MultiSourceOnChainService] CoinGlass fetch failed:", error);
    return null;
  }
}

/**
 * Estimate on-chain flows from price-volume correlation
 * High volume + price up = accumulation (outflow)
 * High volume + price down = distribution (inflow)
 */
function estimateFromPriceVolume(
  priceData: {
    currentPrice: number;
    priceChange24h: number;
    volume24h: number;
    volumeChange24h?: number;
    high24h: number;
    low24h: number;
  }
): OnChainFlowData {
  const { currentPrice, priceChange24h, volume24h, volumeChange24h, high24h, low24h } = priceData;
  
  // Estimate whale activity as 5% of total volume
  const estimatedWhaleVolume = volume24h * 0.05;
  
  // Volume spike detection
  const volumeSpike = volumeChange24h !== undefined && volumeChange24h > 50;
  const volumeMultiplier = volumeSpike ? 1.5 : 1.0;
  
  // Price position in range
  const range = high24h - low24h;
  const positionInRange = range > 0 ? (currentPrice - low24h) / range : 0.5;
  
  let exchangeInflow = 0;
  let exchangeOutflow = 0;
  
  // Strong price increase with volume = accumulation (outflow from exchanges)
  if (priceChange24h > 3 && positionInRange > 0.7) {
    exchangeOutflow = estimatedWhaleVolume * 0.6 * volumeMultiplier;
    exchangeInflow = estimatedWhaleVolume * 0.2;
  }
  // Strong price decrease with volume = distribution (inflow to exchanges)
  else if (priceChange24h < -3 && positionInRange < 0.3) {
    exchangeInflow = estimatedWhaleVolume * 0.6 * volumeMultiplier;
    exchangeOutflow = estimatedWhaleVolume * 0.2;
  }
  // Moderate bullish
  else if (priceChange24h > 1.5) {
    exchangeOutflow = estimatedWhaleVolume * 0.4;
    exchangeInflow = estimatedWhaleVolume * 0.25;
  }
  // Moderate bearish
  else if (priceChange24h < -1.5) {
    exchangeInflow = estimatedWhaleVolume * 0.4;
    exchangeOutflow = estimatedWhaleVolume * 0.25;
  }
  // Slight bullish
  else if (priceChange24h > 0.5) {
    exchangeOutflow = estimatedWhaleVolume * 0.35;
    exchangeInflow = estimatedWhaleVolume * 0.3;
  }
  // Slight bearish
  else if (priceChange24h < -0.5) {
    exchangeInflow = estimatedWhaleVolume * 0.35;
    exchangeOutflow = estimatedWhaleVolume * 0.3;
  }
  // Neutral - slight random bias based on position in range
  else {
    if (positionInRange > 0.6) {
      exchangeOutflow = estimatedWhaleVolume * 0.32;
      exchangeInflow = estimatedWhaleVolume * 0.28;
    } else if (positionInRange < 0.4) {
      exchangeInflow = estimatedWhaleVolume * 0.32;
      exchangeOutflow = estimatedWhaleVolume * 0.28;
    } else {
      exchangeInflow = estimatedWhaleVolume * 0.3;
      exchangeOutflow = estimatedWhaleVolume * 0.3;
    }
  }

  // Estimate reserve change from net flow
  const netFlow = exchangeInflow - exchangeOutflow;
  const reserveChange24h = netFlow > 0 ? 0.5 : netFlow < 0 ? -0.5 : 0;

  return {
    source: "PriceVolumeEstimate",
    exchangeInflow,
    exchangeOutflow,
    netFlow,
    exchangeReserve: 0, // Unknown from this source
    reserveChange24h,
    timestamp: getActiveClock().now(),
    confidence: 0.5,
  };
}

/**
 * Estimate flows from order book imbalance
 */
function estimateFromOrderBook(
  orderBookData: { bidVolume: number; askVolume: number } | null
): OnChainFlowData | null {
  if (!orderBookData) return null;

  const { bidVolume, askVolume } = orderBookData;
  const totalVolume = bidVolume + askVolume;
  
  if (totalVolume === 0) return null;

  // Imbalance ratio
  const imbalanceRatio = (bidVolume - askVolume) / totalVolume;
  
  // Estimate flows from order book imbalance
  const estimatedFlow = Math.abs(imbalanceRatio) * totalVolume * 0.1;
  
  let exchangeInflow = 0;
  let exchangeOutflow = 0;
  
  if (imbalanceRatio > 0.15) {
    // More bids = accumulation = exchange outflow
    exchangeOutflow = estimatedFlow;
  } else if (imbalanceRatio < -0.15) {
    // More asks = distribution = exchange inflow
    exchangeInflow = estimatedFlow;
  } else if (imbalanceRatio > 0.08) {
    exchangeOutflow = estimatedFlow * 0.6;
  } else if (imbalanceRatio < -0.08) {
    exchangeInflow = estimatedFlow * 0.6;
  }

  return {
    source: "OrderBookEstimate",
    exchangeInflow,
    exchangeOutflow,
    netFlow: exchangeInflow - exchangeOutflow,
    exchangeReserve: 0,
    reserveChange24h: 0,
    timestamp: getActiveClock().now(),
    confidence: 0.45,
  };
}

/**
 * Aggregate on-chain data from all available sources
 */
export async function getAggregatedOnChainData(
  symbol: string,
  context?: {
    currentPrice?: number;
    priceChange24h?: number;
    volume24h?: number;
    volumeChange24h?: number;
    high24h?: number;
    low24h?: number;
    orderBookData?: { bidVolume: number; askVolume: number };
  }
): Promise<AggregatedOnChainData> {
  const sources: OnChainFlowData[] = [];

  // Try CoinGlass API first
  const coinGlassData = await fetchFromCoinGlass(symbol);
  if (coinGlassData) {
    sources.push(coinGlassData);
  }

  // Try order book estimation
  if (context?.orderBookData) {
    const orderBookEstimate = estimateFromOrderBook(context.orderBookData);
    if (orderBookEstimate) {
      sources.push(orderBookEstimate);
    }
  }

  // Always add price-volume estimate as fallback
  if (context?.currentPrice && context?.volume24h) {
    const priceVolumeEstimate = estimateFromPriceVolume({
      currentPrice: context.currentPrice,
      priceChange24h: context.priceChange24h || 0,
      volume24h: context.volume24h,
      volumeChange24h: context.volumeChange24h,
      high24h: context.high24h || context.currentPrice,
      low24h: context.low24h || context.currentPrice,
    });
    sources.push(priceVolumeEstimate);
  }

  // Aggregate data with confidence weighting
  let weightedInflow = 0;
  let weightedOutflow = 0;
  let totalWeight = 0;
  let maxReserve = 0;
  let avgReserveChange = 0;
  let reserveCount = 0;

  for (const source of sources) {
    weightedInflow += source.exchangeInflow * source.confidence;
    weightedOutflow += source.exchangeOutflow * source.confidence;
    totalWeight += source.confidence;
    
    if (source.exchangeReserve > 0) {
      maxReserve = Math.max(maxReserve, source.exchangeReserve);
    }
    if (source.reserveChange24h !== 0) {
      avgReserveChange += source.reserveChange24h;
      reserveCount++;
    }
  }

  const aggregatedInflow = totalWeight > 0 ? weightedInflow / totalWeight : 0;
  const aggregatedOutflow = totalWeight > 0 ? weightedOutflow / totalWeight : 0;
  const aggregatedNetFlow = aggregatedInflow - aggregatedOutflow;
  const reserveChange24h = reserveCount > 0 ? avgReserveChange / reserveCount : 0;

  // Calculate overall confidence
  const overallConfidence = Math.min(0.85, 0.35 + (sources.length * 0.15));

  // Determine signal and trend
  let signal: "bullish" | "bearish" | "neutral" = "neutral";
  let signalStrength = 0.5;
  let trend: "accumulation" | "distribution" | "neutral" = "neutral";

  const totalFlow = aggregatedInflow + aggregatedOutflow;
  const flowRatio = totalFlow > 0 ? aggregatedNetFlow / totalFlow : 0;

  // Lowered thresholds for more responsive signals
  if (flowRatio > 0.12) {
    // Net inflow = bearish (coins moving to exchanges to sell)
    signal = "bearish";
    trend = "distribution";
    signalStrength = 0.5 + Math.min(flowRatio * 2, 0.35);
  } else if (flowRatio < -0.12) {
    // Net outflow = bullish (coins leaving exchanges = accumulation)
    signal = "bullish";
    trend = "accumulation";
    signalStrength = 0.5 + Math.min(Math.abs(flowRatio) * 2, 0.35);
  } else if (flowRatio > 0.06) {
    signal = "bearish";
    trend = "distribution";
    signalStrength = 0.55;
  } else if (flowRatio < -0.06) {
    signal = "bullish";
    trend = "accumulation";
    signalStrength = 0.55;
  }

  // Reserve change can also influence signal
  if (reserveChange24h > 2) {
    // Rising reserves = bearish
    if (signal === "neutral") {
      signal = "bearish";
      signalStrength = 0.55;
    } else if (signal === "bearish") {
      signalStrength = Math.min(0.85, signalStrength + 0.1);
    }
    trend = "distribution";
  } else if (reserveChange24h < -2) {
    // Falling reserves = bullish
    if (signal === "neutral") {
      signal = "bullish";
      signalStrength = 0.55;
    } else if (signal === "bullish") {
      signalStrength = Math.min(0.85, signalStrength + 0.1);
    }
    trend = "accumulation";
  }

  return {
    sources,
    aggregatedInflow,
    aggregatedOutflow,
    aggregatedNetFlow,
    exchangeReserve: maxReserve,
    reserveChange24h,
    sourceCount: sources.length,
    overallConfidence,
    signal,
    signalStrength,
    trend,
  };
}

/**
 * Get on-chain signal from aggregated data
 */
export function getOnChainSignalFromAggregated(
  data: AggregatedOnChainData
): {
  signal: "bullish" | "bearish" | "neutral";
  confidence: number;
  executionScore: number;
  reasoning: string;
  trend: "accumulation" | "distribution" | "neutral";
} {
  const reasons: string[] = [];

  // Add source information
  reasons.push(`Data from ${data.sourceCount} source(s): ${data.sources.map(s => s.source).join(", ")}`);

  // Add flow analysis
  if (data.aggregatedNetFlow > 0) {
    reasons.push(`Net exchange inflow: $${(data.aggregatedInflow / 1e6).toFixed(2)}M (distribution - selling pressure)`);
  } else if (data.aggregatedNetFlow < 0) {
    reasons.push(`Net exchange outflow: $${(data.aggregatedOutflow / 1e6).toFixed(2)}M (accumulation - buying pressure)`);
  }

  // Add reserve analysis
  if (data.exchangeReserve > 0) {
    reasons.push(`Exchange reserves: ${(data.exchangeReserve / 1e6).toFixed(2)}M coins`);
  }
  if (data.reserveChange24h !== 0) {
    const direction = data.reserveChange24h > 0 ? "rising" : "falling";
    reasons.push(`Reserves ${direction} ${Math.abs(data.reserveChange24h).toFixed(2)}% in 24h`);
  }

  // Add trend
  reasons.push(`Trend: ${data.trend}`);

  // Calculate execution score
  let executionScore = 35;
  executionScore += data.sourceCount * 12;
  executionScore += data.signalStrength * 25;
  if (data.trend !== "neutral") executionScore += 10;
  executionScore = Math.min(90, executionScore);

  return {
    signal: data.signal,
    confidence: data.overallConfidence * data.signalStrength,
    executionScore,
    reasoning: reasons.join(". "),
    trend: data.trend,
  };
}
