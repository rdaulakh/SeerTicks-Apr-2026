/**
 * On-Chain Analyst Agent
 * 
 * Monitors blockchain activity and on-chain metrics:
 * - Whale Alert API integration (large transactions)
 * - Exchange inflow/outflow tracking
 * - Wallet accumulation/distribution patterns
 * - Miner behavior analysis
 * - Stablecoin flow monitoring
 * 
 * Signals:
 * - Bullish: Whale accumulation, exchange outflows, stablecoin inflows
 * - Bearish: Whale distribution, exchange inflows, stablecoin outflows
 * 
 * NOTE: Glassnode/CryptoQuant API Integration Status:
 * - SOPR, MVRV, NVT metrics currently use simulated data
 * - Real API integration pending Glassnode API key (paid subscription required)
 * - When API key is available, update calculateSOPR(), calculateMVRV(), calculateNVT()
 * - Estimated cost: Glassnode Professional tier ~$799/month
 */

import { AgentBase, AgentConfig, AgentSignal } from './AgentBase';
import { getActiveClock } from '../_core/clock';
import { FreeOnChainDataProvider } from './FreeOnChainDataProvider';
import { rateLimitedFetch, retryWithBackoff, RateLimitError } from '../services/ExternalAPIRateLimiter';
import { engineLogger } from '../utils/logger';

interface WhaleTransaction {
  id: string;
  blockchain: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: { owner: string; owner_type: string };
  to: { owner: string; owner_type: string };
  timestamp: number;
  transactionType: 'transfer' | 'mint' | 'burn';
}

interface OnChainMetrics {
  whaleTransactions: WhaleTransaction[];
  exchangeNetFlow: number; // Positive = inflow (bearish), Negative = outflow (bullish)
  walletAccumulation: number; // Positive = accumulation (bullish)
  minerBehavior: 'accumulating' | 'distributing' | 'neutral';
  stablecoinFlow: number; // Positive = inflow (bullish), Negative = outflow (bearish)
  // A+ Grade: Advanced On-Chain Metrics
  sopr?: number;           // Spent Output Profit Ratio (>1 = profit taking, <1 = capitulation)
  mvrv?: number;           // Market Value to Realized Value (>3.5 = overvalued, <1 = undervalued)
  nvt?: number;            // Network Value to Transactions (high = overvalued)
  minerRevenue?: number;   // Daily miner revenue in USD
  hashRate?: number;       // Current hash rate
  hashRateTrend?: 'rising' | 'falling' | 'stable';
  valuationZone?: 'extreme-greed' | 'greed' | 'neutral' | 'fear' | 'extreme-fear';
}

export class OnChainAnalyst extends AgentBase {
  private readonly WHALE_ALERT_API_KEY: string;
  private readonly WHALE_THRESHOLD_USD = 1000000; // $1M+ transactions
  private metricsCache: Map<string, { metrics: OnChainMetrics; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 900000; // 15 minutes (increased to reduce API calls)
  private freeDataProvider: FreeOnChainDataProvider;

  // Phase 93.22 — rate-limit the dead-data-factory warn to once per 5 min.
  // Forensic audit: 12,832 neutrals/24h at conf 0.45 with all 5 sub-inputs at 0.
  private lastDeadDataWarnAt = 0;

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: 'OnChainAnalyst',
      enabled: true,
      updateInterval: 900000, // Update every 15 minutes (reduced frequency to avoid rate limits)
      timeout: 20000,
      maxRetries: 3,
      ...config,
    });

    this.WHALE_ALERT_API_KEY = process.env.WHALE_ALERT_API_KEY || '';
    if (!this.WHALE_ALERT_API_KEY) {
      console.warn(`[${this.config.name}] WHALE_ALERT_API_KEY not configured. Using mock data.`);
    }
    this.freeDataProvider = new FreeOnChainDataProvider();
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing on-chain monitoring...`);
  }

  protected async cleanup(): Promise<void> {
    this.metricsCache.clear();
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Fetch on-chain metrics
      const metrics = await this.fetchOnChainMetrics(symbol);

      // Analyze whale activity
      const whaleSignal = this.analyzeWhaleActivity(metrics.whaleTransactions);

      // Analyze exchange flows
      const flowSignal = this.analyzeExchangeFlows(metrics.exchangeNetFlow);

      // Analyze wallet behavior
      const walletSignal = this.analyzeWalletBehavior(metrics.walletAccumulation);

      // Analyze stablecoin flows
      const stablecoinSignal = this.analyzeStablecoinFlows(metrics.stablecoinFlow);

      // Analyze miner behavior
      const minerSignal = this.analyzeMinerBehavior(metrics.minerBehavior);

      // A+ Grade: Analyze valuation zone
      const valuationSignal = this.analyzeValuationZone(metrics.valuationZone, metrics.sopr, metrics.mvrv);

      // Aggregate signals (including A+ grade valuation signal)
      const signals = [whaleSignal, flowSignal, walletSignal, stablecoinSignal, minerSignal, valuationSignal];
      const bullishCount = signals.filter(s => s > 0).length;
      const bearishCount = signals.filter(s => s < 0).length;

      const netSignal = (bullishCount - bearishCount) / signals.length;
      let signal: 'bullish' | 'bearish' | 'neutral';

      if (netSignal > 0.2) signal = 'bullish';
      else if (netSignal < -0.2) signal = 'bearish';
      else signal = 'neutral';

      let confidence = Math.min(Math.abs(netSignal) + 0.4, 0.9);
      const strength = Math.min(Math.abs(netSignal) * 1.5, 1.0);

      // A+ Grade: Boost confidence in extreme zones
      if (metrics.valuationZone === 'extreme-fear' && signal === 'bullish') {
        confidence = Math.min(confidence + 0.15, 0.95); // High confidence buy at capitulation
      } else if (metrics.valuationZone === 'extreme-greed' && signal === 'bearish') {
        confidence = Math.min(confidence + 0.15, 0.95); // High confidence sell at euphoria
      }

      // Build reasoning (including A+ grade metrics)
      const reasoning = this.buildReasoning(metrics, whaleSignal, flowSignal, walletSignal, stablecoinSignal, minerSignal, valuationSignal);

      // A++ Grade: Calculate execution score (0-100) for tactical timing quality
      const executionScore = this.calculateExecutionScore(metrics, signal);

      const processingTime = getActiveClock().now() - startTime;

      // Calculate actual data freshness from cache timestamp
      const cached = this.metricsCache.get(symbol);
      const actualFreshness = cached ? Math.floor((getActiveClock().now() - cached.timestamp) / 1000) : processingTime / 1000;

      // Detect if data is synthetic (no API key configured)
      const isSyntheticData = !this.WHALE_ALERT_API_KEY;

      // Penalize confidence for stale data
      if (actualFreshness > 300) { // >5 minutes
        confidence *= 0.8; // -20% penalty
      }
      if (actualFreshness > 900) { // >15 minutes
        confidence *= 0.625; // additional -50% penalty (total -60%)
      }

      // Phase 93.22 — dead-data-factory guard. When ALL 5 sub-signals are
      // exactly 0 AND there are no whale transactions, the agent is being
      // fed zero/neutral defaults from a broken upstream (Whale Alert + free
      // provider both 401/429). Forensic showed 12,832 neutrals/24h at conf
      // 0.45 with every sub-input at zero — that's an empty-cup vote that
      // dilutes the brain's consensus tally. Demote to 0.05 and flag
      // dataAvailable=false so the agent still appears but with near-zero
      // weight.
      const allSubSignalsZero =
        whaleSignal === 0 &&
        flowSignal === 0 &&
        walletSignal === 0 &&
        stablecoinSignal === 0 &&
        minerSignal === 0;
      const noWhaleTxs = metrics.whaleTransactions.length === 0;
      const dataAvailable = !(allSubSignalsZero && noWhaleTxs);
      if (!dataAvailable) {
        const nowMs = getActiveClock().now();
        if (nowMs - this.lastDeadDataWarnAt > 300_000) {
          this.lastDeadDataWarnAt = nowMs;
          engineLogger.warn('OnChainAnalyst demoted (all sub-signals zero — upstream dead)', {
            agent: this.config.name,
            symbol,
            originalConfidence: confidence,
            whaleTransactions: metrics.whaleTransactions.length,
          });
        }
        confidence = 0.05;
      }

      // Phase 30: Apply MarketContext regime adjustments
      let adjustedReasoning = isSyntheticData ? `[NO API KEY - DISABLED] ${reasoning}` : reasoning;
      if (!dataAvailable) {
        adjustedReasoning = `[DEAD-DATA: all sub-signals zero, upstream unavailable] ${adjustedReasoning}`;
      }
      if (context?.regime) {
        const regime = context.regime as string;
        // On-chain data is a leading indicator in trending markets
        if (regime === 'trending_up' && signal === 'bullish') {
          confidence = Math.min(0.95, confidence * 1.10);
          adjustedReasoning += ' [Regime: trending_up — on-chain confirms accumulation]';
        }
        if (regime === 'trending_down' && signal === 'bearish') {
          confidence = Math.min(0.95, confidence * 1.10);
          adjustedReasoning += ' [Regime: trending_down — on-chain confirms distribution]';
        }
        // In high volatility, on-chain is slower to react
        if (regime === 'high_volatility') {
          confidence *= 0.90;
          adjustedReasoning += ' [Regime: high_volatility — on-chain lagging]';
        }
      }

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence,
        strength,
        executionScore,
        reasoning: adjustedReasoning,
        evidence: {
          whaleTransactions: metrics.whaleTransactions.length,
          exchangeNetFlow: metrics.exchangeNetFlow,
          walletAccumulation: metrics.walletAccumulation,
          minerBehavior: metrics.minerBehavior,
          stablecoinFlow: metrics.stablecoinFlow,
          whaleSignal,
          flowSignal,
          walletSignal,
          stablecoinSignal,
          minerSignal,
          dataAvailable,
        },
        qualityScore: this.calculateQualityScore(metrics),
        processingTime,
        dataFreshness: actualFreshness,
        isSyntheticData,
        recommendation: {
          action: signal === 'bullish' ? 'buy' : signal === 'bearish' ? 'sell' : 'hold',
          urgency: strength > 0.7 ? 'high' : strength > 0.4 ? 'medium' : 'low',
        },
      };
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      return this.createNeutralSignal(symbol, `On-chain analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async periodicUpdate(): Promise<void> {
    // Clear old cache entries
    const now = getActiveClock().now();
    for (const [key, value] of Array.from(this.metricsCache.entries())) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.metricsCache.delete(key);
      }
    }
  }

  /**
   * Fetch on-chain metrics from Whale Alert API
   */
  private async fetchOnChainMetrics(symbol: string): Promise<OnChainMetrics> {
    // Check cache
    const cached = this.metricsCache.get(symbol);
    if (cached && getActiveClock().now() - cached.timestamp < this.CACHE_TTL) {
      return cached.metrics;
    }

    if (!this.WHALE_ALERT_API_KEY) {
      // No Whale Alert API key: use free data sources instead of random data
      return this.fetchFreeOnChainMetrics(symbol);
    }

    try {
      // Fetch whale transactions from Whale Alert API
      const whaleTransactions = await this.fetchWhaleTransactions(symbol);

      // Calculate exchange net flow
      const exchangeNetFlow = this.calculateExchangeNetFlow(whaleTransactions);

      // Calculate wallet accumulation
      const walletAccumulation = this.calculateWalletAccumulation(whaleTransactions);

      // Analyze miner behavior (simplified - would need additional data sources)
      const minerBehavior = this.detectMinerBehavior(whaleTransactions);

      // Calculate stablecoin flow (simplified)
      const stablecoinFlow = this.calculateStablecoinFlow(whaleTransactions);

      // A+ Grade: Calculate advanced on-chain metrics using FREE data provider
      let sopr: number;
      let mvrv: number;
      let nvt: number;
      let minerRevenue: number;
      let hashRate: number;
      let hashRateTrend: 'rising' | 'falling' | 'stable';
      
      try {
        const freeMetrics = await this.freeDataProvider.getOnChainMetrics(symbol);
        sopr = freeMetrics.sopr;
        mvrv = freeMetrics.mvrv;
        nvt = freeMetrics.nvt;
        minerRevenue = freeMetrics.minerRevenue;
        hashRate = freeMetrics.hashRate;
        hashRateTrend = freeMetrics.hashRateTrend;
        console.log(`[${this.config.name}] Using REAL on-chain data: SOPR=${sopr.toFixed(3)}, MVRV=${mvrv.toFixed(2)}, NVT=${nvt.toFixed(1)}`);
      } catch (error) {
        console.warn(`[${this.config.name}] Free data provider failed, returning neutral on-chain metrics:`, error);
        // Instead of generating fake Math.random() data, use neutral defaults
        // These won't produce false buy/sell signals
        sopr = 1.0;   // Neutral SOPR (breakeven)
        mvrv = 2.0;   // Neutral MVRV (fair value range)
        nvt = 60;      // Neutral NVT (mid-range)
        minerRevenue = 0;
        hashRate = 0;
        hashRateTrend = 'stable';
      }
      
      const valuationZone = this.detectValuationZone(mvrv, sopr);

      const metrics: OnChainMetrics = {
        whaleTransactions,
        exchangeNetFlow,
        walletAccumulation,
        minerBehavior,
        stablecoinFlow,
        // A+ Grade metrics
        sopr,
        mvrv,
        nvt,
        minerRevenue,
        hashRate,
        hashRateTrend,
        valuationZone,
      };

      // Cache metrics
      this.metricsCache.set(symbol, { metrics, timestamp: getActiveClock().now() });

      return metrics;
    } catch (error) {
      console.error(`[${this.config.name}] Whale Alert API failed, falling back to free data:`, error);
      return this.fetchFreeOnChainMetrics(symbol);
    }
  }

  /**
   * Fetch whale transactions from Whale Alert API
   */
  private async fetchWhaleTransactions(symbol: string): Promise<WhaleTransaction[]> {
    // Handle both BTC-USD and BTCUSDT formats
    const currency = symbol.split(/[\-\/]/)[0].replace(/USDT$|USD$/, '').toLowerCase();
    const now = Math.floor(getActiveClock().now() / 1000);
    const start = now - 3600; // Last hour

    const url = `https://api.whale-alert.io/v1/transactions?api_key=${this.WHALE_ALERT_API_KEY}&start=${start}&end=${now}&currency=${currency}&min_value=${this.WHALE_THRESHOLD_USD}`;

    try {
      // Use rate-limited fetch with retry
      const data = await retryWithBackoff('whaleAlert', async () => {
        const response = await rateLimitedFetch('whaleAlert', url);
        if (!response.ok) {
          throw new Error(`Whale Alert API error: ${response.statusText}`);
        }
        return response.json();
      }, 2);

      return (data.transactions || []).map((tx: any) => ({
        id: tx.id,
        blockchain: tx.blockchain,
        symbol: tx.symbol,
        amount: tx.amount,
        amountUsd: tx.amount_usd,
        from: tx.from,
        to: tx.to,
        timestamp: tx.timestamp,
        transactionType: tx.transaction_type,
      }));
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.warn(`[${this.config.name}] Whale Alert API rate limited, using cached/mock data`);
      }
      throw error;
    }
  }

  /**
   * Calculate exchange net flow
   * Positive = inflow (bearish), Negative = outflow (bullish)
   */
  private calculateExchangeNetFlow(transactions: WhaleTransaction[]): number {
    let netFlow = 0;

    for (const tx of transactions) {
      const isToExchange = tx.to.owner_type === 'exchange';
      const isFromExchange = tx.from.owner_type === 'exchange';

      if (isToExchange && !isFromExchange) {
        netFlow += tx.amountUsd; // Inflow (bearish)
      } else if (isFromExchange && !isToExchange) {
        netFlow -= tx.amountUsd; // Outflow (bullish)
      }
    }

    return netFlow;
  }

  /**
   * Calculate wallet accumulation
   * Positive = accumulation (bullish)
   */
  private calculateWalletAccumulation(transactions: WhaleTransaction[]): number {
    let accumulation = 0;

    for (const tx of transactions) {
      const isToWallet = tx.to.owner_type === 'wallet' || tx.to.owner_type === 'unknown';
      const isFromWallet = tx.from.owner_type === 'wallet' || tx.from.owner_type === 'unknown';

      if (isToWallet && !isFromWallet) {
        accumulation += tx.amountUsd; // Accumulation (bullish)
      } else if (isFromWallet && !isToWallet) {
        accumulation -= tx.amountUsd; // Distribution (bearish)
      }
    }

    return accumulation;
  }

  /**
   * Detect miner behavior
   */
  private detectMinerBehavior(transactions: WhaleTransaction[]): 'accumulating' | 'distributing' | 'neutral' {
    let minerSells = 0;
    let minerHolds = 0;

    for (const tx of transactions) {
      if (tx.from.owner_type === 'miner') {
        if (tx.to.owner_type === 'exchange') {
          minerSells++;
        } else {
          minerHolds++;
        }
      }
    }

    if (minerSells > minerHolds * 2) return 'distributing'; // Bearish
    if (minerHolds > minerSells * 2) return 'accumulating'; // Bullish
    return 'neutral';
  }

  /**
   * Calculate stablecoin flow
   * Positive = inflow (bullish), Negative = outflow (bearish)
   */
  private calculateStablecoinFlow(transactions: WhaleTransaction[]): number {
    // Simplified - would need additional API for stablecoin data
    // For now, return 0 (neutral)
    return 0;
  }

  /**
   * Analyze whale activity
   */
  private analyzeWhaleActivity(transactions: WhaleTransaction[]): number {
    if (transactions.length === 0) return 0;

    let score = 0;
    for (const tx of transactions) {
      // Large accumulation by whales = bullish
      if (tx.to.owner_type === 'wallet' && tx.from.owner_type === 'exchange') {
        score += 0.2;
      }
      // Large distribution by whales = bearish
      if (tx.from.owner_type === 'wallet' && tx.to.owner_type === 'exchange') {
        score -= 0.2;
      }
    }

    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Analyze exchange flows
   */
  private analyzeExchangeFlows(netFlow: number): number {
    // Outflow (negative) = bullish, Inflow (positive) = bearish
    if (netFlow < -5000000) return 1; // Strong outflow (very bullish)
    if (netFlow < -1000000) return 0.5; // Moderate outflow (bullish)
    if (netFlow > 5000000) return -1; // Strong inflow (very bearish)
    if (netFlow > 1000000) return -0.5; // Moderate inflow (bearish)
    return 0; // Neutral
  }

  /**
   * Analyze wallet behavior
   */
  private analyzeWalletBehavior(accumulation: number): number {
    // Positive accumulation = bullish, Negative = bearish
    if (accumulation > 5000000) return 1; // Strong accumulation (very bullish)
    if (accumulation > 1000000) return 0.5; // Moderate accumulation (bullish)
    if (accumulation < -5000000) return -1; // Strong distribution (very bearish)
    if (accumulation < -1000000) return -0.5; // Moderate distribution (bearish)
    return 0; // Neutral
  }

  /**
   * Analyze stablecoin flows
   */
  private analyzeStablecoinFlows(flow: number): number {
    // Positive flow = bullish, Negative = bearish
    if (flow > 10000000) return 1; // Strong inflow (very bullish)
    if (flow > 5000000) return 0.5; // Moderate inflow (bullish)
    if (flow < -10000000) return -1; // Strong outflow (very bearish)
    if (flow < -5000000) return -0.5; // Moderate outflow (bearish)
    return 0; // Neutral
  }

  /**
   * Analyze miner behavior
   */
  private analyzeMinerBehavior(behavior: 'accumulating' | 'distributing' | 'neutral'): number {
    if (behavior === 'accumulating') return 0.5; // Bullish
    if (behavior === 'distributing') return -0.5; // Bearish
    return 0; // Neutral
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    metrics: OnChainMetrics,
    whaleSignal: number,
    flowSignal: number,
    walletSignal: number,
    stablecoinSignal: number,
    minerSignal: number,
    valuationSignal: number
  ): string {
    const parts: string[] = [];

    parts.push(`On-chain analysis: ${metrics.whaleTransactions.length} whale transactions detected.`);

    if (flowSignal !== 0) {
      const direction = flowSignal > 0 ? 'outflow' : 'inflow';
      parts.push(`Exchange ${direction}: $${Math.abs(metrics.exchangeNetFlow / 1e6).toFixed(1)}M (${flowSignal > 0 ? 'bullish' : 'bearish'}).`);
    }

    if (walletSignal !== 0) {
      const behavior = walletSignal > 0 ? 'accumulation' : 'distribution';
      parts.push(`Wallet ${behavior}: $${Math.abs(metrics.walletAccumulation / 1e6).toFixed(1)}M (${walletSignal > 0 ? 'bullish' : 'bearish'}).`);
    }

    if (minerSignal !== 0) {
      parts.push(`Miners ${metrics.minerBehavior} (${minerSignal > 0 ? 'bullish' : 'bearish'}).`);
    }

    // A+ Grade: Add valuation metrics to reasoning
    if (metrics.sopr !== undefined && metrics.mvrv !== undefined) {
      parts.push(`SOPR: ${metrics.sopr.toFixed(3)} (${metrics.sopr > 1 ? 'profit-taking' : 'capitulation'}), MVRV: ${metrics.mvrv.toFixed(2)} (${metrics.valuationZone}).`);
    }

    if (metrics.hashRateTrend) {
      parts.push(`Hash rate ${metrics.hashRateTrend}.`);
    }

    return parts.join(' ');
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(metrics: OnChainMetrics): number {
    // Quality based on number of whale transactions and data freshness
    const transactionScore = Math.min(metrics.whaleTransactions.length / 10, 1.0);
    const freshnessScore = 0.8; // 5-minute updates

    return transactionScore * 0.5 + freshnessScore * 0.5;
  }

  /**
   * A++ Grade: Calculate execution score (0-100) for tactical timing quality
   * 
   * Measures how good the current moment is to execute an on-chain driven trade
   * based on 4 institutional factors:
   * 1. Valuation zone (25 points) - Are we in extreme fear/greed?
   * 2. Whale activity (25 points) - How active are whales?
   * 3. Exchange flow strength (25 points) - How strong are exchange flows?
   * 4. Hash rate trend (25 points) - Is network security improving?
   */
  private calculateExecutionScore(metrics: OnChainMetrics, signal: 'bullish' | 'bearish' | 'neutral'): number {
    let score = 0;

    // 1. Valuation Zone (0-25 points)
    // Extreme zones = best execution timing
    if (metrics.valuationZone === 'extreme-fear' && signal === 'bullish') {
      score += 25; // Perfect buy timing at capitulation
    } else if (metrics.valuationZone === 'extreme-greed' && signal === 'bearish') {
      score += 25; // Perfect sell timing at euphoria
    } else if (metrics.valuationZone === 'fear' && signal === 'bullish') {
      score += 18; // Good buy timing
    } else if (metrics.valuationZone === 'greed' && signal === 'bearish') {
      score += 18; // Good sell timing
    } else if (metrics.valuationZone === 'neutral') {
      score += 12.5; // Neutral timing
    } else {
      score += 5; // Poor timing (signal conflicts with valuation)
    }

    // 2. Whale Activity (0-25 points)
    // More whale transactions = higher confidence in signal
    const whaleScore = Math.min((metrics.whaleTransactions.length / 10) * 25, 25);
    score += whaleScore;

    // 3. Exchange Flow Strength (0-25 points)
    // Strong flows = better execution timing
    const flowMagnitude = Math.abs(metrics.exchangeNetFlow) / 10_000_000; // Normalize to $10M
    const flowScore = Math.min(flowMagnitude * 25, 25);
    score += flowScore;

    // 4. Hash Rate Trend (0-25 points)
    // Rising hash rate = network security improving = bullish
    if (metrics.hashRateTrend === 'rising') {
      score += signal === 'bullish' ? 25 : 15; // Bonus for bullish signals
    } else if (metrics.hashRateTrend === 'stable') {
      score += 15; // Neutral
    } else {
      score += signal === 'bearish' ? 25 : 5; // Bonus for bearish signals
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // NOTE: calculateSOPR(), calculateMVRV(), calculateNVT(), calculateMinerMetrics()
  // were removed - they used Math.random() to generate fake signals.
  // Real data now comes from FreeOnChainDataProvider. If that fails, neutral defaults are used.

  /**
   * A+ Grade: Analyze valuation zone signal
   */
  private analyzeValuationZone(
    zone: 'extreme-greed' | 'greed' | 'neutral' | 'fear' | 'extreme-fear' | undefined,
    sopr: number | undefined,
    mvrv: number | undefined
  ): number {
    if (!zone || sopr === undefined || mvrv === undefined) {
      return 0; // Neutral if data unavailable
    }

    // Extreme fear = Strong buy signal (capitulation bottom)
    if (zone === 'extreme-fear') {
      return 1.0; // Strong bullish
    }

    // Fear = Moderate buy signal
    if (zone === 'fear') {
      return 0.5; // Moderate bullish
    }

    // Extreme greed = Strong sell signal (euphoria top)
    if (zone === 'extreme-greed') {
      return -1.0; // Strong bearish
    }

    // Greed = Moderate sell signal
    if (zone === 'greed') {
      return -0.5; // Moderate bearish
    }

    return 0; // Neutral
  }

  /**
   * A+ Grade: Detect valuation zone based on MVRV and SOPR
   */
  private detectValuationZone(
    mvrv: number,
    sopr: number
  ): 'extreme-greed' | 'greed' | 'neutral' | 'fear' | 'extreme-fear' {
    // Extreme greed: High MVRV + High SOPR (profit taking at top)
    if (mvrv > 3.5 && sopr > 1.05) {
      return 'extreme-greed';
    }

    // Greed: Moderate MVRV + Profit taking
    if (mvrv > 2.5 && sopr > 1.02) {
      return 'greed';
    }

    // Extreme fear: Low MVRV + Capitulation (selling at loss)
    if (mvrv < 1.0 && sopr < 0.98) {
      return 'extreme-fear';
    }

    // Fear: Low MVRV or loss realization
    if (mvrv < 1.5 || sopr < 0.99) {
      return 'fear';
    }

    return 'neutral';
  }

  /**
   * Fetch on-chain metrics from FREE data sources (no API key needed).
   * Uses mempool.space, blockchain.info, and CoinGecko free tier.
   * This is the permanent fallback when Whale Alert API key is unavailable.
   */
  private async fetchFreeOnChainMetrics(symbol: string): Promise<OnChainMetrics> {
    try {
      // Fetch all free data in parallel
      const [onChainMetrics, exchangeFlow, whaleTxs, stablecoinData] = await Promise.all([
        this.freeDataProvider.getOnChainMetrics(symbol),
        this.freeDataProvider.getExchangeFlowData(symbol),
        this.freeDataProvider.getWhaleTransactions(symbol, 10), // 10+ BTC transactions
        this.freeDataProvider.getStablecoinMetrics(),
      ]);

      // Convert free whale transactions to the expected WhaleTransaction format
      const whaleTransactions: WhaleTransaction[] = whaleTxs.map((tx, i) => ({
        id: tx.txHash || `free-${i}`,
        blockchain: 'bitcoin',
        symbol: symbol.split(/[\-\/]/)[0].replace(/USDT$|USD$/, '').toLowerCase(),
        amount: tx.amount,
        amountUsd: tx.amountUsd,
        from: {
          owner: tx.fromType === 'exchange' ? 'exchange' : 'whale-wallet',
          owner_type: tx.fromType === 'exchange' ? 'exchange' : 'wallet',
        },
        to: {
          owner: tx.toType === 'exchange' ? 'exchange' : 'whale-wallet',
          owner_type: tx.toType === 'exchange' ? 'exchange' : 'wallet',
        },
        timestamp: tx.timestamp,
        transactionType: 'transfer' as const,
      }));

      // Calculate wallet accumulation from whale transactions
      let walletAccumulation = 0;
      for (const tx of whaleTransactions) {
        if (tx.to.owner_type === 'wallet' && tx.from.owner_type === 'exchange') {
          walletAccumulation += tx.amountUsd;
        } else if (tx.from.owner_type === 'wallet' && tx.to.owner_type === 'exchange') {
          walletAccumulation -= tx.amountUsd;
        }
      }

      // Use stablecoin market cap change as flow signal
      // Positive change = new money entering crypto (bullish)
      const stablecoinFlow = stablecoinData.change24h;

      const valuationZone = this.detectValuationZone(onChainMetrics.mvrv, onChainMetrics.sopr);

      const metrics: OnChainMetrics = {
        whaleTransactions,
        exchangeNetFlow: exchangeFlow.netFlow,
        walletAccumulation,
        minerBehavior: this.detectMinerBehavior(whaleTransactions),
        stablecoinFlow,
        sopr: onChainMetrics.sopr,
        mvrv: onChainMetrics.mvrv,
        nvt: onChainMetrics.nvt,
        minerRevenue: onChainMetrics.minerRevenue,
        hashRate: onChainMetrics.hashRate,
        hashRateTrend: onChainMetrics.hashRateTrend,
        valuationZone,
      };

      // Cache the free metrics
      this.metricsCache.set(symbol, { metrics, timestamp: getActiveClock().now() });

      console.log(`[${this.config.name}] Using FREE on-chain data: SOPR=${onChainMetrics.sopr.toFixed(3)}, MVRV=${onChainMetrics.mvrv.toFixed(2)}, ${whaleTransactions.length} whale txs, stablecoin flow=$${(stablecoinFlow / 1e6).toFixed(1)}M`);

      return metrics;
    } catch (error) {
      console.error(`[${this.config.name}] Free data provider failed completely:`, error);
      // Last resort: return neutral metrics (still no Math.random())
      return {
        whaleTransactions: [],
        exchangeNetFlow: 0,
        walletAccumulation: 0,
        minerBehavior: 'neutral',
        stablecoinFlow: 0,
        sopr: 1.0,
        mvrv: 2.0,
        nvt: 60,
        minerRevenue: 0,
        hashRate: 0,
        hashRateTrend: 'stable',
        valuationZone: 'neutral',
      };
    }
  }
}
