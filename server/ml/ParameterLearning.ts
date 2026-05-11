/**
 * Parameter Learning Service
 * 
 * Learns optimal parameters from historical trade data:
 * - Consensus thresholds per regime
 * - Agent-specific confidence thresholds
 * - Alpha signal criteria
 * - Regime multipliers
 * 
 * Updates parameters weekly based on rolling 90-day performance.
 */

import { getDb } from "../db";
import { getActiveClock } from '../_core/clock';
import { learnedParameters } from "../../drizzle/schema";
import { eq, and, isNull } from "drizzle-orm";

export interface LearnedParameter {
  parameterName: string;
  parameterType: 'consensus_threshold' | 'agent_confidence' | 'alpha_criteria' | 'regime_multiplier' | 'other';
  symbol?: string | null;
  regime?: string | null;
  agentName?: string | null;
  value: number;
  confidence: number;
  sampleSize: number;
  winRate?: number | null;
  sharpeRatio?: number | null;
}

export class ParameterLearningService {
  private static instance: ParameterLearningService;
  private cache: Map<string, LearnedParameter> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 3600000; // 1 hour

  private constructor() {}

  static getInstance(): ParameterLearningService {
    if (!ParameterLearningService.instance) {
      ParameterLearningService.instance = new ParameterLearningService();
    }
    return ParameterLearningService.instance;
  }

  /**
   * Get consensus threshold for a specific symbol and regime
   * Falls back to global threshold if symbol-specific not found
   */
  async getConsensusThreshold(symbol: string, regime: string): Promise<number> {
    const cacheKey = `consensus_threshold_${symbol}_${regime}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached.value;

    const db = await getDb();
    if (!db) return 0.15; // Default fallback

    try {
      // Try symbol + regime specific
      let result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'consensus_threshold'),
            eq(learnedParameters.symbol, symbol),
            eq(learnedParameters.regime, regime)
          )
        )
        .limit(1);

      if (result.length === 0) {
        // Try regime-specific (global)
        result = await db
          .select()
          .from(learnedParameters)
          .where(
            and(
              eq(learnedParameters.parameterName, 'consensus_threshold'),
              isNull(learnedParameters.symbol),
              eq(learnedParameters.regime, regime)
            )
          )
          .limit(1);
      }

      if (result.length === 0) {
        // Use global default
        return 0.15;
      }

      const param = result[0];
      const learned: LearnedParameter = {
        ...param,
        value: parseFloat(param.value as any),
        confidence: parseFloat(param.confidence as any),
        winRate: param.winRate ? parseFloat(param.winRate as any) : null,
        sharpeRatio: param.sharpeRatio ? parseFloat(param.sharpeRatio as any) : null
      };
      this.setCache(cacheKey, learned);
      return learned.value;

    } catch (error) {
      console.error(`[ParameterLearning] Failed to get consensus threshold:`, error);
      return 0.15; // Default fallback
    }
  }

  /**
   * Get agent-specific confidence threshold
   * Falls back to global threshold if agent-specific not found
   */
  async getAgentConfidenceThreshold(agentName: string): Promise<number> {
    const cacheKey = `agent_confidence_${agentName}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached.value;

    const db = await getDb();
    if (!db) return 0.30; // Default fallback

    try {
      const result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'min_confidence'),
            eq(learnedParameters.agentName, agentName)
          )
        )
        .limit(1);

      if (result.length === 0) {
        return 0.30; // Default
      }

      const param = result[0];
      const learned: LearnedParameter = {
        ...param,
        value: parseFloat(param.value as any),
        confidence: parseFloat(param.confidence as any),
        winRate: param.winRate ? parseFloat(param.winRate as any) : null,
        sharpeRatio: param.sharpeRatio ? parseFloat(param.sharpeRatio as any) : null
      };
      this.setCache(cacheKey, learned);
      return learned.value;

    } catch (error) {
      console.error(`[ParameterLearning] Failed to get agent confidence threshold:`, error);
      return 0.30; // Default fallback
    }
  }

  /**
   * Learn optimal consensus threshold from historical trades
   * Finds threshold that maximizes Sharpe ratio
   */
  async learnConsensusThreshold(
    symbol: string,
    regime: string,
    trades: Array<{
      consensusScore: number;
      pnl: number;
      duration: number;
    }>
  ): Promise<void> {
    if (trades.length < 30) {
      console.log(`[ParameterLearning] Insufficient trades (${trades.length}) to learn consensus threshold`);
      return;
    }

    // Test different thresholds (0.05 to 0.30 in 0.05 increments)
    const thresholds = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
    let bestThreshold = 0.15;
    let bestSharpe = -Infinity;
    let bestWinRate = 0;

    for (const threshold of thresholds) {
      // Filter trades that would pass this threshold
      const filteredTrades = trades.filter(t => Math.abs(t.consensusScore) >= threshold);
      
      if (filteredTrades.length < 10) continue; // Need minimum sample size

      // Calculate performance metrics
      const returns = filteredTrades.map(t => t.pnl);
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const stdDev = Math.sqrt(
        returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
      );
      const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;
      const winRate = returns.filter(r => r > 0).length / returns.length;

      if (sharpe > bestSharpe) {
        bestSharpe = sharpe;
        bestThreshold = threshold;
        bestWinRate = winRate;
      }
    }

    // Store learned parameter
    await this.storeParameter({
      parameterName: 'consensus_threshold',
      parameterType: 'consensus_threshold',
      symbol,
      regime,
      value: bestThreshold,
      confidence: Math.min(0.95, 0.5 + (trades.length / 200)), // Higher confidence with more data
      sampleSize: trades.length,
      winRate: bestWinRate,
      sharpeRatio: bestSharpe
    });

    console.log(`[ParameterLearning] Learned consensus threshold for ${symbol} ${regime}: ${bestThreshold} (Sharpe: ${bestSharpe.toFixed(2)}, WinRate: ${(bestWinRate * 100).toFixed(1)}%)`);
  }

  /**
   * FIX #6: Get regime-specific learned parameters
   * Queries database for parameters optimized for specific market regimes
   */
  async getRegimeSpecificParameters(symbol: string, regime: string): Promise<{
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
    positionSizeMultiplier: number;
    qualityThreshold: number;
    alphaThreshold: number;
  }> {
    const cacheKey = `regime_params_${symbol}_${regime}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached && cached.parameterType === 'regime_multiplier') {
      // Parse stored JSON value
      try {
        const params = JSON.parse(cached.value.toString());
        return params;
      } catch {
        // Fall through to database query
      }
    }

    const db = await getDb();
    if (!db) {
      return this.getDefaultRegimeParameters(regime);
    }

    try {
      // Query regime-specific parameters from database
      const result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterType, 'regime_multiplier'),
            eq(learnedParameters.symbol, symbol),
            eq(learnedParameters.regime, regime)
          )
        )
        .limit(1);

      if (result.length > 0) {
        try {
          const params = JSON.parse(result[0].value as string);
          // Cache the result
          this.setCache(cacheKey, {
            parameterName: 'regime_params',
            parameterType: 'regime_multiplier',
            symbol,
            regime,
            value: params,
            confidence: parseFloat(result[0].confidence as any),
            sampleSize: result[0].sampleSize || 0
          });
          return params;
        } catch {
          // Invalid JSON, use defaults
        }
      }

      // No learned parameters, return regime-specific defaults
      return this.getDefaultRegimeParameters(regime);
    } catch (error) {
      console.error(`[ParameterLearning] Failed to get regime parameters:`, error);
      return this.getDefaultRegimeParameters(regime);
    }
  }

  /**
   * FIX #6: Default regime-specific parameters based on market conditions
   */
  private getDefaultRegimeParameters(regime: string): {
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
    positionSizeMultiplier: number;
    qualityThreshold: number;
    alphaThreshold: number;
  } {
    switch (regime) {
      case 'trending_up':
        return {
          stopLossMultiplier: 2.0,      // Wider stops in trends
          takeProfitMultiplier: 3.0,    // Let winners run
          positionSizeMultiplier: 1.2,  // Larger positions in trends
          qualityThreshold: 0.25,       // Lower quality threshold (more signals)
          alphaThreshold: 0.6           // Lower alpha threshold
        };
      case 'trending_down':
        return {
          stopLossMultiplier: 1.5,      // Tighter stops in downtrends
          takeProfitMultiplier: 2.0,    // Take profits quicker
          positionSizeMultiplier: 0.8,  // Smaller positions
          qualityThreshold: 0.35,       // Higher quality threshold
          alphaThreshold: 0.7           // Higher alpha threshold
        };
      case 'high_volatility':
        return {
          stopLossMultiplier: 2.5,      // Much wider stops
          takeProfitMultiplier: 2.5,    // Balanced R:R
          positionSizeMultiplier: 0.6,  // Smaller positions
          qualityThreshold: 0.40,       // Require high quality
          alphaThreshold: 0.8           // Very high alpha threshold
        };
      case 'range_bound':
        return {
          stopLossMultiplier: 1.5,      // Tighter stops
          takeProfitMultiplier: 1.5,    // Quick profits
          positionSizeMultiplier: 0.9,  // Slightly smaller positions
          qualityThreshold: 0.30,       // Standard threshold
          alphaThreshold: 0.65          // Standard alpha
        };
      default: // 'unknown' or other
        return {
          stopLossMultiplier: 2.0,
          takeProfitMultiplier: 2.0,
          positionSizeMultiplier: 1.0,
          qualityThreshold: 0.30,
          alphaThreshold: 0.7
        };
    }
  }

  /**
   * FIX #5: Get quality score threshold for an agent based on historical accuracy
   * High-accuracy agents can use lower thresholds, low-accuracy need higher
   */
  async getAgentQualityThreshold(agentName: string): Promise<number> {
    const cacheKey = `quality_threshold_${agentName}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached.value;

    const db = await getDb();
    if (!db) return 0.30; // Default fallback

    try {
      const result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'quality_threshold'),
            eq(learnedParameters.agentName, agentName)
          )
        )
        .limit(1);

      if (result.length === 0) {
        // No learned threshold, use default based on agent type
        return this.getDefaultQualityThreshold(agentName);
      }

      const param = result[0];
      const learned: LearnedParameter = {
        ...param,
        value: parseFloat(param.value as any),
        confidence: parseFloat(param.confidence as any),
        winRate: param.winRate ? parseFloat(param.winRate as any) : null,
        sharpeRatio: param.sharpeRatio ? parseFloat(param.sharpeRatio as any) : null
      };
      this.setCache(cacheKey, learned);
      return learned.value;

    } catch (error) {
      console.error(`[ParameterLearning] Failed to get quality threshold:`, error);
      return 0.30; // Default fallback
    }
  }

  /**
   * Default quality thresholds by agent type
   */
  private getDefaultQualityThreshold(agentName: string): number {
    // Fast agents (real-time data) can have lower thresholds
    const fastAgents = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
    // Slow agents (delayed data) need higher quality
    const slowAgents = ['SentimentAnalyst', 'NewsSentinel', 'MacroAnalyst', 'OnChainAnalyst'];
    
    if (fastAgents.includes(agentName)) {
      return 0.25; // Lower threshold for fast agents
    } else if (slowAgents.includes(agentName)) {
      return 0.35; // Higher threshold for slow agents
    }
    return 0.30; // Default
  }

  /**
   * FIX #4: Get action decision threshold based on regime and volatility
   */
  async getActionDecisionThreshold(symbol: string, regime: string, volatility: number): Promise<number> {
    const cacheKey = `action_threshold_${symbol}_${regime}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      // Adjust cached value by volatility
      return this.adjustThresholdByVolatility(cached.value, volatility);
    }

    const db = await getDb();
    if (!db) {
      return this.getDefaultActionThreshold(regime, volatility);
    }

    try {
      const result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterName, 'action_threshold'),
            eq(learnedParameters.symbol, symbol),
            eq(learnedParameters.regime, regime)
          )
        )
        .limit(1);

      if (result.length > 0) {
        const baseThreshold = parseFloat(result[0].value as any);
        this.setCache(cacheKey, {
          parameterName: 'action_threshold',
          parameterType: 'other',
          symbol,
          regime,
          value: baseThreshold,
          confidence: parseFloat(result[0].confidence as any),
          sampleSize: result[0].sampleSize || 0
        });
        return this.adjustThresholdByVolatility(baseThreshold, volatility);
      }

      return this.getDefaultActionThreshold(regime, volatility);
    } catch (error) {
      console.error(`[ParameterLearning] Failed to get action threshold:`, error);
      return this.getDefaultActionThreshold(regime, volatility);
    }
  }

  /**
   * Adjust threshold based on current volatility
   */
  private adjustThresholdByVolatility(baseThreshold: number, volatility: number): number {
    // High volatility (>5% ATR) → lower threshold (more opportunities)
    // Low volatility (<2% ATR) → higher threshold (wait for quality)
    if (volatility > 0.05) {
      return baseThreshold * 0.8; // 20% lower threshold
    } else if (volatility < 0.02) {
      return baseThreshold * 1.2; // 20% higher threshold
    }
    return baseThreshold;
  }

  /**
   * Default action thresholds by regime
   */
  private getDefaultActionThreshold(regime: string, volatility: number): number {
    let baseThreshold: number;
    
    // Phase 11 Fix 7: Raised default thresholds — 0.50 for trending was barely above random
    // and caused 100% execution rate (zero HOLD decisions). Institutional standard is 0.65+
    switch (regime) {
      case 'trending_up':
      case 'trending_down':
        baseThreshold = 0.65; // Was 0.50 — raised to prevent over-trading in trends
        break;
      case 'high_volatility':
        baseThreshold = 0.75; // Was 0.70 — raised for volatile markets (higher bar)
        break;
      case 'range_bound':
        baseThreshold = 0.70; // Was 0.60 — range-bound needs higher selectivity
        break;
      default:
        baseThreshold = 0.65; // Was 0.60
    }
    
    return this.adjustThresholdByVolatility(baseThreshold, volatility);
  }

  /**
   * FIX #2: Get alpha signal criteria based on regime
   */
  async getAlphaCriteria(symbol: string, regime: string): Promise<{
    minConsensusScore: number;
    minConfidence: number;
    minAgentAgreement: number;
    minQualityScore: number;
  }> {
    const cacheKey = `alpha_criteria_${symbol}_${regime}`;
    
    const cached = this.getFromCache(cacheKey);
    if (cached && cached.parameterType === 'alpha_criteria') {
      try {
        return JSON.parse(cached.value.toString());
      } catch {
        // Fall through to database query
      }
    }

    const db = await getDb();
    if (!db) {
      return this.getDefaultAlphaCriteria(regime);
    }

    try {
      const result = await db
        .select()
        .from(learnedParameters)
        .where(
          and(
            eq(learnedParameters.parameterType, 'alpha_criteria'),
            eq(learnedParameters.symbol, symbol),
            eq(learnedParameters.regime, regime)
          )
        )
        .limit(1);

      if (result.length > 0) {
        try {
          const criteria = JSON.parse(result[0].value as string);
          this.setCache(cacheKey, {
            parameterName: 'alpha_criteria',
            parameterType: 'alpha_criteria',
            symbol,
            regime,
            value: criteria,
            confidence: parseFloat(result[0].confidence as any),
            sampleSize: result[0].sampleSize || 0
          });
          return criteria;
        } catch {
          // Invalid JSON, use defaults
        }
      }

      return this.getDefaultAlphaCriteria(regime);
    } catch (error) {
      console.error(`[ParameterLearning] Failed to get alpha criteria:`, error);
      return this.getDefaultAlphaCriteria(regime);
    }
  }

  /**
   * Default alpha criteria by regime
   */
  private getDefaultAlphaCriteria(regime: string): {
    minConsensusScore: number;
    minConfidence: number;
    minAgentAgreement: number;
    minQualityScore: number;
  } {
    switch (regime) {
      case 'trending_up':
        return {
          minConsensusScore: 0.6,
          minConfidence: 0.7,
          minAgentAgreement: 4,
          minQualityScore: 0.6
        };
      case 'trending_down':
        return {
          minConsensusScore: 0.65,
          minConfidence: 0.75,
          minAgentAgreement: 4,
          minQualityScore: 0.65
        };
      case 'high_volatility':
        return {
          minConsensusScore: 0.75,
          minConfidence: 0.8,
          minAgentAgreement: 5,
          minQualityScore: 0.7
        };
      case 'range_bound':
        return {
          minConsensusScore: 0.65,
          minConfidence: 0.7,
          minAgentAgreement: 4,
          minQualityScore: 0.6
        };
      default:
        return {
          minConsensusScore: 0.7,
          minConfidence: 0.75,
          minAgentAgreement: 4,
          minQualityScore: 0.65
        };
    }
  }

  /**
   * FIX #1: Get stop-loss parameters based on regime and ATR
   */
  async getStopLossParameters(symbol: string, regime: string, atr: number, price: number): Promise<{
    multiplier: number;
    minPercent: number;
    maxPercent: number;
    useATR: boolean;
  }> {
    // Get regime-specific parameters
    const regimeParams = await this.getRegimeSpecificParameters(symbol, regime);
    
    // Calculate ATR as percentage of price
    const atrPercent = (atr / price) * 100;
    
    // Determine if ATR-based stop is appropriate
    const useATR = atrPercent >= 0.5 && atrPercent <= 10; // ATR between 0.5% and 10%
    
    return {
      multiplier: regimeParams.stopLossMultiplier,
      minPercent: 0.5,  // Minimum 0.5% stop
      maxPercent: 5.0,  // Maximum 5% stop
      useATR
    };
  }

  /**
   * Learn optimal confidence threshold for an agent
   * Finds threshold where win rate > 55%
   */
  async learnAgentConfidenceThreshold(
    agentName: string,
    signals: Array<{
      confidence: number;
      correct: boolean;
    }>
  ): Promise<void> {
    if (signals.length < 50) {
      console.log(`[ParameterLearning] Insufficient signals (${signals.length}) to learn agent confidence threshold`);
      return;
    }

    // Test different confidence thresholds (0.20 to 0.80 in 0.05 increments)
    const thresholds = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
    let bestThreshold = 0.30;
    let bestWinRate = 0;

    for (const threshold of thresholds) {
      // Filter signals that would pass this threshold
      const filteredSignals = signals.filter(s => s.confidence >= threshold);
      
      if (filteredSignals.length < 20) continue; // Need minimum sample size

      // Calculate win rate
      const winRate = filteredSignals.filter(s => s.correct).length / filteredSignals.length;

      // Find lowest threshold where win rate > 55%
      if (winRate >= 0.55 && threshold < bestThreshold) {
        bestThreshold = threshold;
        bestWinRate = winRate;
      }
    }

    // Store learned parameter
    await this.storeParameter({
      parameterName: 'min_confidence',
      parameterType: 'agent_confidence',
      agentName,
      value: bestThreshold,
      confidence: Math.min(0.95, 0.5 + (signals.length / 200)),
      sampleSize: signals.length,
      winRate: bestWinRate
    });

    console.log(`[ParameterLearning] Learned confidence threshold for ${agentName}: ${bestThreshold} (WinRate: ${(bestWinRate * 100).toFixed(1)}%)`);
  }

  /**
   * Store learned parameter in database
   */
  private async storeParameter(param: LearnedParameter): Promise<void> {
    const db = await getDb();
    if (!db) return;

    try {
      await db
        .insert(learnedParameters)
        .values({
          parameterName: param.parameterName,
          parameterType: param.parameterType,
          symbol: param.symbol || null,
          regime: param.regime || null,
          agentName: param.agentName || null,
          value: param.value.toString(),
          confidence: param.confidence.toString(),
          sampleSize: param.sampleSize,
          winRate: param.winRate?.toString() || null,
          sharpeRatio: param.sharpeRatio?.toString() || null
        })
        .onDuplicateKeyUpdate({
          set: {
            value: param.value.toString(),
            confidence: param.confidence.toString(),
            sampleSize: param.sampleSize,
            winRate: param.winRate?.toString() || null,
            sharpeRatio: param.sharpeRatio?.toString() || null,
            lastUpdated: new Date()
          }
        });

      // Invalidate cache
      const cacheKey = this.buildCacheKey(param);
      this.cache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);

    } catch (error) {
      console.error(`[ParameterLearning] Failed to store parameter:`, error);
    }
  }

  /**
   * Cache management
   */
  private getFromCache(key: string): LearnedParameter | null {
    const expiry = this.cacheExpiry.get(key);
    if (!expiry || getActiveClock().now() > expiry) {
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
      return null;
    }
    return this.cache.get(key) || null;
  }

  private setCache(key: string, param: LearnedParameter): void {
    this.cache.set(key, param);
    this.cacheExpiry.set(key, getActiveClock().now() + this.CACHE_TTL);
  }

  private buildCacheKey(param: LearnedParameter): string {
    return `${param.parameterName}_${param.symbol || 'global'}_${param.regime || 'all'}_${param.agentName || 'all'}`;
  }

  /**
   * Clear all cached parameters
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
  }
}

// Export singleton instance
export const parameterLearning = ParameterLearningService.getInstance();
