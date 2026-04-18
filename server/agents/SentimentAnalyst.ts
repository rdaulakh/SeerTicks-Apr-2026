/**
 * SentimentAnalyst Agent
 * 
 * Tracks social media sentiment and market fear/greed indicators using
 * Z-Score normalization to eliminate bias and generate statistically
 * significant signals.
 * 
 * Key Features:
 * 1. Z-Score normalization of Fear & Greed values
 * 2. Only generates signals on statistically significant deviations (>1.5 std dev)
 * 3. Returns neutral for normal market conditions
 * 4. Proper contrarian logic with confidence scaling
 * 
 * Expected Signal Distribution:
 * - Bullish: ~15-25% (only during extreme fear)
 * - Bearish: ~15-25% (only during extreme greed)
 * - Neutral: ~50-70% (normal market conditions)
 * 
 * Data Sources:
 * - LLM Web Search (Twitter/X, Reddit, forums, Telegram, Discord)
 * - Fear & Greed Index (Alternative.me)
 */

import { AgentBase, AgentSignal, AgentConfig } from './AgentBase';
import { getLLMRateLimiter } from '../utils/RateLimiter';
import { fallbackManager, MarketDataInput } from './DeterministicFallback';
import { getZScoreSentimentModel, ZScoreResult } from '../utils/ZScoreSentimentModel';

interface SocialSentimentData {
  sentiment: number; // -1 (very bearish) to +1 (very bullish)
  summary: string;
  sources: string[];
}

interface FearGreedData {
  value: number; // 0-100 (0 = extreme fear, 100 = extreme greed)
  classification: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";
  timestamp: number;
}

export class SentimentAnalyst extends AgentBase {
  private sentimentCache: Map<string, { sentiment: number; timestamp: number }> = new Map();
  private fearGreedCache: FearGreedData | null = null;
  private readonly CACHE_TTL = 300000; // 5 minutes
  
  // Price tracking for dynamic confidence
  private currentPrice: number = 0;
  private lastPrice: number = 0;
  private priceHistory: number[] = [];

  // Z-Score model for normalized sentiment analysis
  private zScoreModel = getZScoreSentimentModel();

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "SentimentAnalyst",
      enabled: true,
      updateInterval: 300000, // Update every 5 minutes
      timeout: 15000,
      maxRetries: 3,
      ...config,
    });
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing with Z-Score sentiment model...`);
    
    // Pre-fetch Fear & Greed Index and initialize Z-Score model
    await this.fetchFearGreedIndex();
    
    // Fetch historical Fear & Greed data to initialize the model
    await this.initializeZScoreHistory();
  }

  /**
   * Initialize Z-Score model with historical Fear & Greed data
   */
  private async initializeZScoreHistory(): Promise<void> {
    try {
      // Fetch last 30 days of Fear & Greed data
      const response = await fetch('https://api.alternative.me/fng/?limit=30');
      
      if (!response.ok) {
        console.warn(`[${this.config.name}] Could not fetch F&G history: ${response.status}`);
        return;
      }
      
      const data = await response.json();
      
      if (data && data.data && Array.isArray(data.data)) {
        const history = data.data.map((item: any) => ({
          value: parseInt(item.value),
          timestamp: parseInt(item.timestamp) * 1000, // Convert to milliseconds
        }));
        
        this.zScoreModel.initializeWithHistory(history);
        console.log(`[${this.config.name}] Z-Score model initialized with ${history.length} days of F&G history`);
      }
    } catch (error) {
      console.error(`[${this.config.name}] Failed to initialize Z-Score history:`, error);
    }
  }

  protected async cleanup(): Promise<void> {
    this.sentimentCache.clear();
    this.fearGreedCache = null;
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = Date.now();

    try {
      // Fetch sentiment data
      const [socialSentiment, fearGreed] = await Promise.all([
        this.fetchSocialSentiment(symbol),
        this.getFearGreedIndex(),
      ]);

      // Use Z-Score model for signal calculation
      const zScoreResult = this.zScoreModel.calculateCombinedZScore(
        fearGreed?.value ?? null,
        socialSentiment.sentiment
      );

      // Get LLM analysis for additional context
      const analysis = await this.analyzeSentiment(symbol, socialSentiment, fearGreed);

      const processingTime = Date.now() - startTime;
      const dataFreshness = fearGreed ? (Date.now() - fearGreed.timestamp) / 1000 : 0;
      const qualityScore = this.calculateQualityScore(socialSentiment, fearGreed, dataFreshness);

      // Calculate execution score
      const executionScore = this.calculateExecutionScore(zScoreResult, socialSentiment, fearGreed);

      // Build reasoning with Z-Score context
      let reasoning = zScoreResult.reasoning;
      if (analysis && analysis !== "Unable to analyze sentiment at this time.") {
        reasoning += ` LLM Analysis: ${analysis}`;
      }

      // Phase 30: Apply MarketContext regime adjustments
      let adjustedConfidence = zScoreResult.confidence;
      if (context?.regime) {
        const regime = context.regime as string;
        // Sentiment is a lagging indicator in trending markets — dampen
        if (regime === 'trending_up' || regime === 'trending_down') {
          adjustedConfidence *= 0.85;
          reasoning += ` [Regime: ${regime} — sentiment lagging, confidence dampened]`;
        }
        // In high volatility, sentiment extremes are more meaningful (contrarian)
        if (regime === 'high_volatility' && Math.abs(zScoreResult.zScore) > 2) {
          adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.1);
          reasoning += ' [High volatility + extreme sentiment — contrarian signal boosted]';
        }
      }

      // Phase 33: Incorporate task-specific questions from MarketRegimeAI
      if (context?.taskQuestions?.length > 0) {
        const taskAnswers: string[] = [];
        for (const question of context.taskQuestions as string[]) {
          const answer = this.answerSentimentQuestion(question, zScoreResult, socialSentiment, fearGreed);
          if (answer) taskAnswers.push(answer);
        }
        if (taskAnswers.length > 0) {
          reasoning += ` [Task Analysis: ${taskAnswers.join('; ')}]`;
        }
      }
      if (context?.taskFocus) {
        reasoning += ` [Focus: ${context.taskFocus}]`;
      }

      // Log the Z-Score based signal for debugging
      console.log(`[${this.config.name}] Z-Score Signal: ${zScoreResult.signal} (Z=${zScoreResult.zScore.toFixed(2)}, conf=${(adjustedConfidence * 100).toFixed(0)}%)`);

      return {
        agentName: this.config.name,
        symbol,
        signal: zScoreResult.signal,
        confidence: adjustedConfidence,
        strength: Math.abs(zScoreResult.zScore) / 3, // Normalize to 0-1 range
        reasoning,
        evidence: {
          zScore: zScoreResult.zScore.toFixed(2),
          zScoreMean: zScoreResult.mean.toFixed(1),
          zScoreStdDev: zScoreResult.stdDev.toFixed(2),
          isStatisticallySignificant: zScoreResult.isStatisticallySignificant,
          socialSentiment: socialSentiment.sentiment.toFixed(2),
          fearGreedIndex: fearGreed?.value || 'N/A',
          fearGreedClassification: fearGreed?.classification || 'N/A',
          sources: socialSentiment.sources.join(', '),
          analysis,
        },
        timestamp: Date.now(),
        processingTime,
        dataFreshness: (Date.now() - startTime) / 1000,
        qualityScore,
        executionScore,
      };
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      
      // DETERMINISTIC FALLBACK
      console.warn(`[${this.config.name}] Activating deterministic fallback...`);
      
      const marketData: MarketDataInput = {
        currentPrice: context?.currentPrice || this.currentPrice || 0,
        priceChange24h: context?.priceChange24h || 0,
        volume24h: context?.volume24h || 0,
        high24h: context?.high24h || 0,
        low24h: context?.low24h || 0,
        priceHistory: this.priceHistory,
        fearGreedIndex: this.fearGreedCache?.value,
      };
      
      const fallbackResult = fallbackManager.getSentimentFallback(symbol, marketData);
      
      return {
        agentName: this.config.name,
        symbol,
        signal: fallbackResult.signal,
        confidence: fallbackResult.confidence,
        strength: fallbackResult.strength,
        reasoning: fallbackResult.reasoning,
        evidence: {
          fallbackReason: fallbackResult.fallbackReason,
          isDeterministic: true,
          originalError: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: Date.now(),
        processingTime: Date.now() - startTime,
        dataFreshness: 0,
        qualityScore: 0.6,
        executionScore: 50,
      };
    }
  }

  /**
   * Live price injection for dynamic confidence
   */
  public setCurrentPrice(price: number): void {
    this.lastPrice = this.currentPrice;
    this.currentPrice = price;
    
    this.priceHistory.push(price);
    if (this.priceHistory.length > 10) {
      this.priceHistory.shift();
    }
  }

  /**
   * Phase 33: Answer regime-specific task questions using sentiment data.
   */
  private answerSentimentQuestion(
    question: string,
    zScoreResult: any,
    socialSentiment: any,
    fearGreed: any
  ): string | null {
    const q = question.toLowerCase();

    if (q.includes('euphoria') || q.includes('extreme') || q.includes('greed')) {
      const fg = fearGreed?.value ?? 'N/A';
      const cls = fearGreed?.classification ?? 'unknown';
      return `Fear & Greed: ${fg} (${cls}), Z-Score: ${zScoreResult.zScore.toFixed(2)}`;
    }

    if (q.includes('contrarian') || q.includes('crowd')) {
      const extreme = Math.abs(zScoreResult.zScore) > 2;
      return extreme
        ? `Sentiment at statistical extreme (Z=${zScoreResult.zScore.toFixed(2)}) — contrarian signal active`
        : `Sentiment within normal range (Z=${zScoreResult.zScore.toFixed(2)}) — no contrarian setup`;
    }

    if (q.includes('social') || q.includes('twitter') || q.includes('reddit')) {
      return `Social sentiment: ${(socialSentiment.sentiment * 100).toFixed(0)}% (sources: ${socialSentiment.sources?.join(', ') || 'N/A'})`;
    }

    if (q.includes('fear') || q.includes('panic')) {
      const fg = fearGreed?.value ?? 0;
      return fg < 25 ? `Extreme fear (${fg}) — potential capitulation` : `Fear & Greed: ${fg} — not in fear territory`;
    }

    if (q.includes('shift') || q.includes('changing') || q.includes('momentum')) {
      return `Sentiment Z-Score: ${zScoreResult.zScore.toFixed(2)} (${zScoreResult.isStatisticallySignificant ? 'statistically significant' : 'within normal range'})`;
    }

    return null;
  }

  /**
   * Fetch social sentiment using LLM web search
   */
  private async fetchSocialSentiment(symbol: string): Promise<SocialSentimentData> {
    try {
      const coinName = symbol.replace('USDT', '').replace('USD', '').replace('-', '');
      const coinFullName = coinName === 'BTC' ? 'Bitcoin' : coinName === 'ETH' ? 'Ethereum' : coinName;

      const prompt = `Search the web for the latest social media sentiment about ${coinFullName} (${coinName}) cryptocurrency in the last 24 hours.

Analyze sentiment from:
- Twitter/X posts and trending topics
- Reddit discussions (r/cryptocurrency, r/bitcoin, r/ethereum)
- Crypto forums (Bitcointalk, CryptoCompare)
- Telegram group mentions
- Discord server discussions

Return ONLY a valid JSON object (no markdown, no code blocks) with this exact structure:
{
  "sentiment": <number from -1.0 (very bearish) to +1.0 (very bullish)>,
  "summary": "<2-3 sentence summary of overall sentiment>",
  "sources": ["<source 1>", "<source 2>", "<source 3>"]
}`;

      const rateLimiter = getLLMRateLimiter();
      const cacheKey = `social-sentiment:${symbol}`;
      
      const response = await rateLimiter.execute(
        cacheKey,
        () => this.callLLM([
          { role: "system", content: "You are a crypto sentiment analyst with web search access. Return ONLY valid JSON, no markdown formatting." },
          { role: "user", content: prompt },
        ]),
        { cacheable: true, cacheTTL: this.CACHE_TTL }
      );

      const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const data = JSON.parse(cleanResponse);

      if (typeof data.sentiment !== 'number' || !data.summary || !Array.isArray(data.sources)) {
        throw new Error('Invalid LLM response structure');
      }

      data.sentiment = Math.max(-1, Math.min(1, data.sentiment));

      console.log(`[${this.config.name}] Social sentiment for ${symbol}: ${(data.sentiment * 100).toFixed(0)}% (${data.sources.length} sources)`);
      return data;
    } catch (error) {
      console.error(`[${this.config.name}] Failed to fetch social sentiment:`, error);
      
      // Return neutral sentiment
      return {
        sentiment: 0,
        summary: 'Social sentiment data unavailable',
        sources: [],
      };
    }
  }

  /**
   * Fetch Fear & Greed Index from Alternative.me API
   */
  private async fetchFearGreedIndex(): Promise<void> {
    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=1');
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data && data.data && data.data[0]) {
        const fng = data.data[0];
        const value = parseInt(fng.value);
        
        this.fearGreedCache = {
          value,
          classification: this.classifyFearGreed(value),
          timestamp: Date.now(),
        };
        
        // Add to Z-Score model
        this.zScoreModel.addFearGreedValue(value);
        
        console.log(`[${this.config.name}] Fear & Greed Index: ${value} (${this.fearGreedCache.classification})`);
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error) {
      console.error(`[${this.config.name}] Failed to fetch Fear & Greed Index:`, error);
      this.fearGreedCache = null;
    }
  }

  /**
   * Get cached Fear & Greed Index
   */
  private async getFearGreedIndex(): Promise<FearGreedData | null> {
    if (!this.fearGreedCache || (Date.now() - this.fearGreedCache.timestamp) > this.CACHE_TTL) {
      await this.fetchFearGreedIndex();
    }
    return this.fearGreedCache;
  }

  /**
   * Classify Fear & Greed value
   */
  private classifyFearGreed(value: number): FearGreedData["classification"] {
    if (value <= 25) return "Extreme Fear";
    if (value <= 45) return "Fear";
    if (value <= 55) return "Neutral";
    if (value <= 70) return "Greed";
    return "Extreme Greed";
  }

  /**
   * Analyze sentiment using LLM
   */
  private async analyzeSentiment(
    symbol: string,
    socialSentiment: SocialSentimentData,
    fearGreed: FearGreedData | null
  ): Promise<string> {
    const prompt = `You are a crypto sentiment analyst. Analyze the current market sentiment for ${symbol} and provide a brief outlook (2-3 sentences).

Social Sentiment Score: ${socialSentiment.sentiment.toFixed(2)} (-1 to +1)
Social Sentiment Summary: ${socialSentiment.summary}
Sources: ${socialSentiment.sources.join(', ')}

Fear & Greed Index: ${fearGreed?.value || 'N/A'} (${fearGreed?.classification || 'N/A'})

Provide your sentiment analysis:`;

    try {
      const rateLimiter = getLLMRateLimiter();
      const cacheKey = `sentiment-analysis:${symbol}:${socialSentiment.sentiment.toFixed(2)}:${fearGreed?.value || 'na'}`;
      
      return await rateLimiter.execute(
        cacheKey,
        () => this.callLLM([
          { role: "system", content: "You are an expert crypto sentiment analyst." },
          { role: "user", content: prompt },
        ]),
        { cacheable: true, cacheTTL: this.CACHE_TTL }
      );
    } catch (error) {
      return "Unable to analyze sentiment at this time.";
    }
  }

  /**
   * Calculate quality score for the signal
   */
  private calculateQualityScore(
    socialSentiment: SocialSentimentData,
    fearGreed: FearGreedData | null,
    dataFreshness: number
  ): number {
    let score = 0;

    // Data availability (40%)
    if (fearGreed) score += 0.2;
    if (socialSentiment.sources.length > 0) score += 0.2;

    // Data freshness (30%)
    if (dataFreshness < 300) score += 0.3;
    else if (dataFreshness < 600) score += 0.2;
    else score += 0.1;

    // Source diversity (30%)
    const sourceCount = socialSentiment.sources.length;
    if (sourceCount >= 3) score += 0.3;
    else if (sourceCount >= 2) score += 0.2;
    else if (sourceCount >= 1) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate execution score (0-100) for tactical timing
   * Uses Z-Score for better signal quality
   */
  private calculateExecutionScore(
    zScoreResult: ZScoreResult,
    socialSentiment: SocialSentimentData,
    fearGreed: FearGreedData | null
  ): number {
    let score = 0;

    // Component 1: Z-Score Significance (0-40 points)
    const absZScore = Math.abs(zScoreResult.zScore);
    if (absZScore >= 3.0) score += 40;
    else if (absZScore >= 2.5) score += 35;
    else if (absZScore >= 2.0) score += 30;
    else if (absZScore >= 1.5) score += 20;
    else if (absZScore >= 1.0) score += 10;
    else score += 5;

    // Component 2: Statistical Significance (0-20 points)
    if (zScoreResult.isStatisticallySignificant) score += 20;

    // Component 3: Data Quality (0-20 points)
    const sourceCount = socialSentiment.sources.length;
    if (fearGreed && sourceCount >= 3) score += 20;
    else if (fearGreed && sourceCount >= 2) score += 15;
    else if (fearGreed || sourceCount >= 2) score += 10;
    else score += 5;

    // Component 4: Confidence Level (0-20 points)
    score += Math.round(zScoreResult.confidence * 20);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Create neutral signal when data is unavailable
   */
  protected createNeutralSignal(symbol: string = 'UNKNOWN', reason: string = 'Data unavailable'): AgentSignal {
    return {
      agentName: this.config.name,
      symbol,
      signal: "neutral",
      confidence: 0,
      strength: 0,
      reasoning: reason,
      evidence: {
        zScore: '0',
        socialSentiment: 'N/A',
        fearGreedIndex: 'N/A',
        fearGreedClassification: 'N/A',
        sources: 'None',
        analysis: 'Data unavailable',
      },
      timestamp: Date.now(),
      processingTime: 0,
      dataFreshness: 0,
      qualityScore: 0,
      executionScore: 0,
    };
  }

  /**
   * Periodic update (not used for sentiment — it's event-driven)
   */
  protected async periodicUpdate(): Promise<void> {
    // Sentiment analysis is event-driven, not periodic
  }
}

export default SentimentAnalyst;
