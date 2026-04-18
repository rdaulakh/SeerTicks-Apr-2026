/**
 * Pattern Prediction Service
 * 
 * Uses LLM to analyze detected patterns with historical context
 * and generate predictions with confidence scores
 */

import { invokeLLM } from '../_core/llm';
import { getDb } from '../db';
import { historicalCandles, winningPatterns, paperPositions } from '../../drizzle/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import type { DetectedPattern } from '../agents/PatternDetection';

export interface PatternPrediction {
  pattern: DetectedPattern;
  prediction: {
    direction: 'bullish' | 'bearish' | 'neutral';
    targetPrice: number;
    confidence: number; // 0-100
    timeframe: string; // e.g., "1-3 days", "1-2 weeks"
    reasoning: string;
  };
  historicalContext: {
    similarPatterns: number;
    successRate: number;
    avgPriceMove: number;
  };
}

export interface MarketData {
  timestamp: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Analyze pattern with LLM and historical data
 */
export async function analyzePatterWithLLM(
  symbol: string,
  pattern: DetectedPattern,
  currentPrice: number,
  recentCandles: MarketData[]
): Promise<PatternPrediction> {
  // 1. Query historical data for similar patterns
  const historicalContext = await findSimilarPatterns(symbol, pattern);
  
  // 2. Prepare context for LLM
  const prompt = buildAnalysisPrompt(symbol, pattern, currentPrice, recentCandles, historicalContext);
  
  // 3. Get LLM analysis
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: 'system',
        content: 'You are an expert technical analyst specializing in chart pattern recognition and price prediction. Analyze patterns using historical data and provide actionable trading insights.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'pattern_analysis',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['bullish', 'bearish', 'neutral'],
              description: 'Expected price direction',
            },
            targetPrice: {
              type: 'number',
              description: 'Predicted target price',
            },
            confidence: {
              type: 'number',
              description: 'Confidence score 0-100',
            },
            timeframe: {
              type: 'string',
              description: 'Expected timeframe for price move (e.g., "1-3 days")',
            },
            reasoning: {
              type: 'string',
              description: 'Detailed reasoning for the prediction',
            },
          },
          required: ['direction', 'targetPrice', 'confidence', 'timeframe', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
  });
  
  const content = llmResponse.choices[0].message.content;
  const contentText = typeof content === 'string' ? content : JSON.stringify(content);
  const analysis = JSON.parse(contentText || '{}');
  
  return {
    pattern,
    prediction: {
      direction: analysis.direction || 'neutral',
      targetPrice: analysis.targetPrice || currentPrice,
      confidence: Math.min(100, Math.max(0, analysis.confidence || 50)),
      timeframe: analysis.timeframe || 'unknown',
      reasoning: analysis.reasoning || 'No reasoning provided',
    },
    historicalContext,
  };
}

/**
 * Find similar patterns in historical data
 */
async function findSimilarPatterns(
  symbol: string,
  pattern: DetectedPattern
): Promise<{
  similarPatterns: number;
  successRate: number;
  avgPriceMove: number;
}> {
  const db = await getDb();
  if (!db) {
    return { similarPatterns: 0, successRate: 0, avgPriceMove: 0 };
  }
  
  try {
    // 1. Query winningPatterns for patterns matching this symbol and pattern name
    const matchingPatterns = await db
      .select()
      .from(winningPatterns)
      .where(
        and(
          eq(winningPatterns.symbol, symbol.replace('-', '')),
          eq(winningPatterns.patternName, pattern.name),
          eq(winningPatterns.isActive, true)
        )
      );

    if (matchingPatterns.length === 0) {
      return { similarPatterns: 0, successRate: 0, avgPriceMove: 0 };
    }

    // 2. Aggregate stats from winningPatterns table
    const totalTrades = matchingPatterns.reduce((sum, p) => sum + p.totalTrades, 0);
    const totalWins = matchingPatterns.reduce((sum, p) => sum + p.winningTrades, 0);
    const aggregatedWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;
    const aggregatedAvgPnl = matchingPatterns.reduce((sum, p) => {
      const pnl = p.avgPnl ? parseFloat(p.avgPnl) : 0;
      return sum + pnl;
    }, 0) / matchingPatterns.length;

    // 3. Cross-reference with paperPositions linked to these pattern strategy IDs
    //    to get actual realized performance
    const patternIds = matchingPatterns.map(p => p.id);
    const linkedPositions = await db
      .select({
        totalClosed: sql<number>`COUNT(CASE WHEN ${paperPositions.status} = 'closed' THEN 1 END)`,
        totalWins: sql<number>`COUNT(CASE WHEN ${paperPositions.status} = 'closed' AND CAST(${paperPositions.realizedPnl} AS DECIMAL(20,8)) > 0 THEN 1 END)`,
        avgRealizedPnl: sql<number>`AVG(CASE WHEN ${paperPositions.status} = 'closed' THEN CAST(${paperPositions.realizedPnl} AS DECIMAL(20,8)) ELSE NULL END)`,
      })
      .from(paperPositions)
      .where(
        and(
          sql`${paperPositions.strategyId} IN (${sql.join(patternIds.map(id => sql`${id}`), sql`, `)})`,
          eq(paperPositions.symbol, symbol.replace('-', ''))
        )
      );

    const positionStats = linkedPositions[0];
    const closedCount = positionStats?.totalClosed ?? 0;

    // 4. Prefer position-based stats if available, fall back to winningPatterns aggregates
    if (closedCount > 0) {
      const posWinRate = (positionStats.totalWins ?? 0) / closedCount;
      const posAvgPnl = positionStats.avgRealizedPnl ?? 0;
      return {
        similarPatterns: closedCount,
        successRate: posWinRate,
        avgPriceMove: posAvgPnl,
      };
    }

    // Fall back to winningPatterns aggregate data
    return {
      similarPatterns: totalTrades,
      successRate: aggregatedWinRate,
      avgPriceMove: aggregatedAvgPnl,
    };
  } catch (error) {
    console.error('[PatternPredictionService] Failed to find similar patterns:', error);
    return { similarPatterns: 0, successRate: 0, avgPriceMove: 0 };
  }
}

/**
 * Build LLM analysis prompt
 */
function buildAnalysisPrompt(
  symbol: string,
  pattern: DetectedPattern,
  currentPrice: number,
  recentCandles: MarketData[],
  historicalContext: { similarPatterns: number; successRate: number; avgPriceMove: number }
): string {
  const candleSummary = recentCandles.slice(-10).map((c, i) => {
    const change = i > 0 ? ((c.close - recentCandles[i - 1].close) / recentCandles[i - 1].close * 100).toFixed(2) : '0.00';
    const date = new Date(c.timestamp).toISOString().split('T')[0];
    return `  ${date}: O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} (${change}%)`;
  }).join('\n');
  
  return `Analyze the following chart pattern for ${symbol}:

**Pattern Detected:** ${pattern.name}
**Timeframe:** ${pattern.timeframe}
**Confidence:** ${(pattern.confidence * 100).toFixed(1)}%
**Description:** ${pattern.description}

**Current Market Data:**
- Current Price: $${currentPrice.toFixed(2)}
- Recent Price Action (last 10 candles):
${candleSummary}

**Historical Context:**
${historicalContext.similarPatterns > 0 ? `
- Similar patterns found: ${historicalContext.similarPatterns}
- Historical success rate: ${(historicalContext.successRate * 100).toFixed(1)}%
- Average price move: ${historicalContext.avgPriceMove.toFixed(2)}%
` : '- No historical data available for this pattern yet'}

**Task:**
Based on the detected ${pattern.name} pattern and current market conditions:

1. Determine the most likely price direction (bullish, bearish, or neutral)
2. Estimate a realistic target price
3. Assign a confidence score (0-100) based on:
   - Pattern quality and confirmation
   - Volume analysis
   - Market context
   - Historical success rate (if available)
4. Estimate the timeframe for the predicted move
5. Provide clear reasoning for your prediction

**Important:**
- Be conservative with confidence scores
- Consider both technical and contextual factors
- If the pattern is weak or unclear, reflect that in lower confidence
- Provide actionable insights for traders`;
}

/**
 * Get historical candles from database
 */
export async function getHistoricalCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<MarketData[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }
  
  try {
    const candles = await db
      .select()
      .from(historicalCandles)
      .where(
        and(
          eq(historicalCandles.symbol, symbol.replace('-', '')),
          eq(historicalCandles.interval, interval)
        )
      )
      .orderBy(desc(historicalCandles.timestamp))
      .limit(limit);
    
    return candles.map(c => ({
      timestamp: c.timestamp.getTime(), // Convert Date to Unix timestamp
      open: parseFloat(c.open.toString()),
      high: parseFloat(c.high.toString()),
      low: parseFloat(c.low.toString()),
      close: parseFloat(c.close.toString()),
      volume: parseFloat(c.volume.toString()),
    })).reverse(); // Oldest first
  } catch (error) {
    console.error('[PatternPredictionService] Failed to get historical candles:', error);
    return [];
  }
}
