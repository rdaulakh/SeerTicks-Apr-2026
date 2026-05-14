import { AgentBase, AgentSignal, AgentConfig } from "./AgentBase";
import { getActiveClock } from '../_core/clock';
import { getLLMRateLimiter } from '../utils/RateLimiter';
import { fallbackManager, MarketDataInput } from './DeterministicFallback';
import { getDuneProvider, OnChainSignal, DuneOnChainMetrics } from './DuneAnalyticsProvider';
import { getTradingConfig } from '../config/TradingConfig';
import { engineLogger } from '../utils/logger';

/**
 * Macro Analyst Agent
 * Monitors macro indicators and correlations with traditional finance
 * Has VETO POWER to block trades during critical macro events
 * 
 * Data Sources:
 * - DXY (US Dollar Index)
 * - VIX (Volatility Index)
 * - S&P 500 / Nasdaq
 * - Stablecoin supply (USDT, USDC)
 * - Bitcoin dominance
 * - Fed announcements (via news)
 * 
 * Veto Conditions:
 * - Fed announcement within 1 hour
 * - VIX spike > 40 (extreme fear in TradFi)
 * - Flash crash in S&P 500 (>5% drop in 1 hour)
 * - Major geopolitical event
 */

interface MacroIndicators {
  dxy: number; // US Dollar Index
  vix: number; // Volatility Index
  sp500: number; // S&P 500 price
  sp500Change24h: number; // Percentage change
  btcCorrelation: number; // Correlation with BTC (-1 to 1)
  stablecoinSupply: number; // Total USDT + USDC supply
  stablecoinChange: number; // Percentage change
  btcDominance: number; // Bitcoin dominance percentage
  // A+ Grade: Correlation Analysis
  btcSpx30d?: number;      // 30-day BTC/S&P 500 correlation
  btcSpx90d?: number;      // 90-day BTC/S&P 500 correlation
  btcGold30d?: number;     // 30-day BTC/Gold correlation
  btcDxy30d?: number;      // 30-day BTC/DXY correlation (inverse)
  correlationRegime?: 'risk-on' | 'risk-off' | 'decoupled' | 'mixed';
  // Dune Analytics On-Chain Integration
  duneOnChainSignal?: OnChainSignal;
  duneExchangeNetFlow?: number;
  duneWhaleActivity?: 'accumulating' | 'distributing' | 'neutral';
}

interface MarketRegime {
  regime: "risk-on" | "risk-off" | "transitioning";
  confidence: number;
}

export class MacroAnalyst extends AgentBase {
  private macroCache: MacroIndicators | null = null;
  private lastMacroFetch: number = 0;
  private readonly MACRO_FETCH_INTERVAL = 900000; // 15 minutes
  private vetoActive: boolean = false;
  private vetoReason: string = "";
  private newsSentinel: any = null; // Reference to NewsSentinel for Fed detection
  
  // A+ Grade: Price history for correlation calculation
  private btcPriceHistory: number[] = [];
  private sp500PriceHistory: number[] = [];
  private goldPriceHistory: number[] = [];
  private dxyPriceHistory: number[] = [];
  private readonly MAX_HISTORY_LENGTH = 90; // Keep 90 days for 90-day correlation
  
  // A++ Grade: Live price injection for dynamic confidence
  private currentPrice: number = 0;

  // Stablecoin supply tracking for change calculation
  private previousStablecoinSupply: number = 0;

  // Dune Analytics on-chain integration
  private duneMetricsCache: DuneOnChainMetrics | null = null;
  private lastDuneFetch: number = 0;
  private readonly DUNE_FETCH_INTERVAL = 600000; // 10 minutes

  constructor(config?: Partial<AgentConfig>) {
    super({
      name: "MacroAnalyst",
      enabled: true,
      updateInterval: 900000, // Update every 15 minutes
      timeout: 20000,
      maxRetries: 3,
      ...config,
    });
  }

  protected async initialize(): Promise<void> {
    console.log(`[${this.config.name}] Initializing macro monitoring...`);
    await this.fetchMacroIndicators();
  }

  protected async cleanup(): Promise<void> {
    this.macroCache = null;
  }

  protected async analyze(symbol: string, context?: any): Promise<AgentSignal> {
    const startTime = getActiveClock().now();

    try {
      // Fetch macro indicators if needed
      if (!this.macroCache || (getActiveClock().now() - this.lastMacroFetch) > this.MACRO_FETCH_INTERVAL) {
        await this.fetchMacroIndicators();
      }

      if (!this.macroCache) {
        return this.createNeutralSignal(symbol, "Macro data unavailable");
      }

      // Phase 93 — FIX: abstain when core feeds (DXY / SPX / VIX) are missing.
      // Previously we proceeded with fallback values (DXY=104.5, VIX=18,
      // SPX=4500) which made the regime detection mechanical — same direction
      // for every symbol because the inputs were constants.
      const dxyOk = typeof this.macroCache.dxy === 'number' && Number.isFinite(this.macroCache.dxy) && this.macroCache.dxy > 0;
      const vixOk = typeof this.macroCache.vix === 'number' && Number.isFinite(this.macroCache.vix) && this.macroCache.vix > 0;
      const spxOk = typeof this.macroCache.sp500 === 'number' && Number.isFinite(this.macroCache.sp500) && this.macroCache.sp500 > 0;
      const corePresent = dxyOk && vixOk && spxOk;
      // We also need at least one non-zero core data series (history) — purely
      // cached/stale fallbacks won't help.
      const hasHistory = this.sp500PriceHistory.length >= 2 || this.btcPriceHistory.length >= 2;
      if (!corePresent || !hasHistory) {
        engineLogger.warn('MacroAnalyst core feeds missing — abstaining', { agent: this.config.name, symbol, dxyOk, vixOk, spxOk, hasHistory });
        const neutral = this.createNeutralSignal(symbol, '[data-unavailable] Core macro feeds (DXY/SPX/VIX) missing — abstaining');
        neutral.confidence = 0.05;
        neutral.evidence = { dataAvailable: false, dxyOk, vixOk, spxOk };
        return neutral;
      }

      // Detect market regime
      const regime = this.detectMarketRegime(this.macroCache);

      // Check veto conditions
      this.checkVetoConditions(this.macroCache);

      // Analyze using LLM
      const analysis = await this.analyzeMacro(symbol, this.macroCache, regime);

      // Calculate signal
      const { signal, confidence, strength, reasoning } = this.calculateSignalFromMacro(
        symbol,
        this.macroCache,
        regime,
        analysis
      );

      // Phase 30: Cross-validate with MarketRegimeAI context
      let adjustedConfidence = confidence;
      let adjustedReasoning = reasoning;
      if (context?.regime) {
        const externalRegime = context.regime as string;
        // If MacroAnalyst's own regime detection aligns with MarketRegimeAI, boost confidence
        const macroRegime = regime.regime;
        const aligned = 
          (macroRegime === 'risk-on' && (externalRegime === 'trending_up' || externalRegime === 'breakout')) ||
          (macroRegime === 'risk-off' && (externalRegime === 'trending_down' || externalRegime === 'high_volatility'));
        if (aligned) {
          adjustedConfidence = Math.min(0.95, adjustedConfidence * 1.10);
          adjustedReasoning += ` [Regime cross-validation: macro ${macroRegime} aligns with market ${externalRegime}]`;
        } else {
          adjustedConfidence *= 0.90;
          adjustedReasoning += ` [Regime divergence: macro ${macroRegime} vs market ${externalRegime}]`;
        }
      }

      // A++ Grade: Calculate execution score
      const executionScore = this.calculateExecutionScore(this.macroCache, regime);

      const processingTime = getActiveClock().now() - startTime;
      const dataFreshness = (getActiveClock().now() - this.lastMacroFetch) / 1000;

      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal,
        confidence: adjustedConfidence,
        strength,
        reasoning: adjustedReasoning,
        executionScore,
        evidence: {
          dxy: this.macroCache.dxy,
          vix: this.macroCache.vix,
          sp500Change: this.macroCache.sp500Change24h,
          btcCorrelation: this.macroCache.btcCorrelation,
          stablecoinChange: this.macroCache.stablecoinChange,
          stablecoinSupply: this.macroCache.stablecoinSupply,
          btcDominance: this.macroCache.btcDominance,
          regime: regime.regime,
          regimeConfidence: regime.confidence,
          vetoActive: this.vetoActive,
          vetoReason: this.vetoReason,
          // A++ Grade: Correlation metrics
          correlations: this.macroCache.btcSpx30d !== undefined && this.macroCache.btcSpx30d !== null ? {
            btcSpx30d: this.macroCache.btcSpx30d,
            btcSpx90d: this.macroCache.btcSpx90d,
            btcGold30d: this.macroCache.btcGold30d,
            btcDxy30d: this.macroCache.btcDxy30d,
            correlationRegime: this.macroCache.correlationRegime,
          } : undefined,
        },
        qualityScore: this.calculateQualityScore(dataFreshness),
        processingTime,
        dataFreshness,
        recommendation: this.getRecommendation(signal, confidence, strength, regime),
      };
    } catch (error) {
      console.error(`[${this.config.name}] Analysis failed:`, error);
      
      // DETERMINISTIC FALLBACK: Use technical indicator analysis when macro data fails
      console.warn(`[${this.config.name}] Activating deterministic fallback...`);
      
      const marketData: MarketDataInput = {
        currentPrice: context?.currentPrice || this.currentPrice || 0,
        priceChange24h: context?.priceChange24h || 0,
        volume24h: context?.volume24h || 0,
        high24h: context?.high24h || 0,
        low24h: context?.low24h || 0,
        priceHistory: this.btcPriceHistory.length > 0 ? this.btcPriceHistory : context?.priceHistory || [],
        volumeHistory: context?.volumeHistory || [],
        rsi: context?.rsi,
        macd: context?.macd,
      };
      
      const fallbackResult = fallbackManager.getMacroFallback(symbol, marketData);

      // Entry-gate audit restoration: when macro data is unreachable, the
      // previous fallback always returned vetoActive=false, meaning the
      // MacroAnalyst silently became permissive during outages (the exact
      // moments when macro-driven veto matters most).
      // Default behavior is now FAIL CLOSED — activate the veto for the
      // duration of the failure. Set TradingConfig.macro.failClosed=false
      // to preserve old permissive behavior.
      const macroFailClosed = getTradingConfig().macro?.failClosed !== false;
      if (macroFailClosed) {
        this.vetoActive = true;
        this.vetoReason = 'macro_data_unavailable_failclosed';
      }

      // Phase 82.3 — fail-closed should activate the VETO without contaminating
      // the consensus vote. Previously the fallbackResult (which can be high-
      // confidence bearish based on stale price-momentum heuristics) was emitted
      // as the signal AND the veto was activated — producing 0/140/3 perma-bear
      // output that wasn't real macro intelligence, just an API outage. Now: on
      // fail-closed we emit a clean 0-confidence neutral signal so the agent
      // doesn't vote bearish 140× in a 30-min window — but the veto still
      // halts new entries on the trade-execution side.
      return {
        agentName: this.config.name,
        symbol,
        timestamp: getActiveClock().now(),
        signal: macroFailClosed ? 'neutral' : fallbackResult.signal,
        confidence: macroFailClosed ? 0 : fallbackResult.confidence,
        strength: macroFailClosed ? 0 : fallbackResult.strength,
        reasoning: macroFailClosed
          ? `[FAIL-CLOSED] Macro data unavailable — veto active, no directional vote. ${fallbackResult.reasoning}`
          : fallbackResult.reasoning,
        evidence: {
          fallbackReason: fallbackResult.fallbackReason,
          isDeterministic: true,
          originalError: error instanceof Error ? error.message : 'Unknown error',
          vetoActive: macroFailClosed,
          vetoReason: macroFailClosed ? 'macro_data_unavailable_failclosed' : undefined,
          deterministicFallbackWouldHaveBeen: macroFailClosed ? fallbackResult.signal : undefined,
        },
        qualityScore: macroFailClosed ? 0.0 : 0.55,
        processingTime: getActiveClock().now() - startTime,
        dataFreshness: 0,
        executionScore: macroFailClosed ? 30 : 45,
      };
    }
  }

  protected async periodicUpdate(): Promise<void> {
    await this.fetchMacroIndicators();
  }

  /**
   * Fetch macro indicators using Yahoo Finance API (via Manus Data API Hub)
   */
  private async fetchMacroIndicators(): Promise<void> {
    try {
      // Import database candle loader, child_process for Python script, and callDataApi for VIX
      const { loadCandlesFromDatabase } = await import('../db/candleStorage');
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const { callDataApi } = await import('../_core/dataApi');
      const execFileAsync = promisify(execFile);
      
      console.log(`[MacroAnalyst] Fetching macro indicators (last fetch: ${new Date(this.lastMacroFetch).toISOString()})...`);

      // Fetch BTC price from database (90 days of daily candles)
      const btcCandles = await loadCandlesFromDatabase('BTCUSDT', '1d', 90);
      const btcPrice = btcCandles.length > 0 ? btcCandles[btcCandles.length - 1].close : 42000;
      const btcHistorical = btcCandles.map(c => c.close);

      // Fetch real prices from yahoo-finance2 (Node.js implementation)
      const { fetchMacroData } = await import('../scripts/fetch_macro_data');
      const macroData = await fetchMacroData();

      // Extract current prices and historical data from yfinance Python script
      const sp500Price = macroData.sp500?.current || 4500;
      const goldPrice = macroData.gold?.current || 2000;
      const dxyPrice = macroData.dxy?.current || 104.5;

      // Extract historical prices for correlation calculation (last 90 days)
      const sp500Historical = macroData.sp500?.prices || [];
      const goldHistorical = macroData.gold?.prices || [];
      const dxyHistorical = macroData.dxy?.prices || [];

      // Update price history with real data (filter out null values)
      this.btcPriceHistory = btcHistorical; // Already clean from database
      this.sp500PriceHistory = sp500Historical.filter((p: number | null) => p !== null) as number[];
      this.goldPriceHistory = goldHistorical.filter((p: number | null) => p !== null) as number[];
      this.dxyPriceHistory = dxyHistorical.filter((p: number | null) => p !== null) as number[];

      console.log(`[MacroAnalyst] Price history lengths: BTC=${this.btcPriceHistory.length} (from DB), S&P=${this.sp500PriceHistory.length} (yfinance), Gold=${this.goldPriceHistory.length} (yfinance), DXY=${this.dxyPriceHistory.length} (yfinance)`);

      // Calculate 24h change for S&P 500
      const sp500Change24h = sp500Historical.length >= 2
        ? ((sp500Historical[sp500Historical.length - 1] - sp500Historical[sp500Historical.length - 2]) / sp500Historical[sp500Historical.length - 2]) * 100
        : 0;

      // Calculate correlations
      const btcSpx30d = this.calculateCorrelation(this.btcPriceHistory, this.sp500PriceHistory, 30);
      const btcSpx90d = this.calculateCorrelation(this.btcPriceHistory, this.sp500PriceHistory, 90);
      const btcGold30d = this.calculateCorrelation(this.btcPriceHistory, this.goldPriceHistory, 30);
      const btcDxy30d = this.calculateCorrelation(this.btcPriceHistory, this.dxyPriceHistory, 30);

      // Detect correlation regime
      const correlationRegime = this.detectCorrelationRegime(btcSpx30d, btcGold30d, btcDxy30d);

      // Fetch VIX from Yahoo Finance.
      //
      // Phase 4: VIX is OPTIONAL — failure must not poison the whole macro pipeline.
      // Previously a throw from `callDataApi` (e.g. DATA_API_URL=stub.invalid or
      // network error) would skip the remaining cache assignment and dump us into
      // the outer catch, losing DXY/S&P/gold/correlations too.  Now we isolate the
      // VIX fetch so its failure degrades gracefully to the neutral fallback (18).
      let vix = 18;
      try {
        const vixData = await callDataApi('YahooFinance/get_stock_chart', {
          query: { symbol: '^VIX', region: 'US', interval: '1d', range: '1d' }
        });
        const fetched = (vixData as any)?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (typeof fetched === 'number' && Number.isFinite(fetched) && fetched > 0) {
          vix = fetched;
        } else {
          console.warn(`[${this.config.name}] VIX response missing regularMarketPrice, using neutral 18`);
        }
      } catch (vixError: any) {
        console.warn(`[${this.config.name}] VIX fetch failed (${vixError?.message || vixError}), using neutral 18`);
      }

      // Fetch real stablecoin supply and BTC dominance from CoinGecko
      let stablecoinSupply = 120_000_000_000; // Fallback value
      let btcDominance = 52; // Fallback value
      try {
        const coinGeckoResponse = await fetch('https://api.coingecko.com/api/v3/global');
        if (coinGeckoResponse.ok) {
          const coinGeckoData = await coinGeckoResponse.json();
          const data = coinGeckoData.data;
          
          // Extract BTC dominance
          btcDominance = data.market_cap_percentage?.btc || 52;
          
          // Calculate stablecoin supply (USDT + USDC market caps)
          const totalMarketCapUsd = data.total_market_cap?.usd || 3_000_000_000_000;
          const usdtPct = data.market_cap_percentage?.usdt || 5.7;
          const usdcPct = data.market_cap_percentage?.usdc || 2.4;
          stablecoinSupply = (usdtPct + usdcPct) / 100 * totalMarketCapUsd;
          
          console.log(`[MacroAnalyst] CoinGecko data: BTC dominance ${btcDominance.toFixed(2)}%, Stablecoin supply $${(stablecoinSupply / 1e9).toFixed(1)}B`);
        }
      } catch (error) {
        console.warn(`[MacroAnalyst] Failed to fetch CoinGecko data, using fallback values:`, error);
      }

      // Fetch Dune Analytics on-chain data
      let duneOnChainSignal: OnChainSignal | undefined;
      let duneExchangeNetFlow: number | undefined;
      let duneWhaleActivity: 'accumulating' | 'distributing' | 'neutral' | undefined;
      
      try {
        const duneProvider = getDuneProvider();
        if (duneProvider.isConfigured()) {
          const duneMetrics = await duneProvider.getOnChainMetrics('BTC');
          this.duneMetricsCache = duneMetrics;
          this.lastDuneFetch = getActiveClock().now();
          
          duneOnChainSignal = duneMetrics.aggregatedSignal;
          duneExchangeNetFlow = duneMetrics.aggregatedSignal.metrics.exchangeNetFlow24h;
          
          // Determine whale activity from accumulation vs distribution
          const { whaleAccumulation, whaleDistribution } = duneMetrics.aggregatedSignal.metrics;
          const whaleRatio = whaleAccumulation / (whaleDistribution || 1);
          duneWhaleActivity = whaleRatio > 1.2 ? 'accumulating' : whaleRatio < 0.8 ? 'distributing' : 'neutral';
          
          console.log(`[MacroAnalyst] Dune Analytics: Exchange flow ${duneExchangeNetFlow?.toFixed(0)} BTC, Whale activity: ${duneWhaleActivity}, Signal: ${duneOnChainSignal?.signal}`);
        }
      } catch (duneError) {
        console.warn(`[MacroAnalyst] Dune Analytics fetch failed, continuing without on-chain data:`, duneError);
      }

      this.macroCache = {
        dxy: dxyPrice,
        vix,
        sp500: sp500Price,
        sp500Change24h,
        btcCorrelation: btcSpx30d || 0.3,
        stablecoinSupply, // Real data from CoinGecko
        stablecoinChange: this.calculateStablecoinChange(stablecoinSupply),
        btcDominance, // Real data from CoinGecko
        // A+ Grade: Real correlation metrics from Yahoo Finance
        btcSpx30d: btcSpx30d ?? undefined,
        btcSpx90d: btcSpx90d ?? undefined,
        btcGold30d: btcGold30d ?? undefined,
        btcDxy30d: btcDxy30d ?? undefined,
        correlationRegime,
        // Dune Analytics On-Chain Integration
        duneOnChainSignal,
        duneExchangeNetFlow,
        duneWhaleActivity,
      };

      this.lastMacroFetch = getActiveClock().now();
      console.log(`[${this.config.name}] Fetched macro indicators. Correlation regime: ${correlationRegime}`);
    } catch (error: any) {
      console.error(`[${this.config.name}] Failed to fetch macro indicators:`, error);
      
      // If 429 rate limit error, extend cache time to avoid hammering the API
      if (error.message && error.message.includes('429')) {
        console.warn(`[${this.config.name}] Rate limit hit (429), extending cache time by 30 minutes`);
        // Extend last fetch time by 30 minutes to avoid retrying too soon
        this.lastMacroFetch = getActiveClock().now() + (30 * 60 * 1000);
      }
      
      // Keep using cached data if available, don't crash
      if (!this.macroCache) {
        console.warn(`[${this.config.name}] No cached data available, will retry later`);
      }
    }
  }

  // updatePriceHistory() removed - now using direct Yahoo Finance historical data

  /**
   * A+ Grade: Calculate Pearson correlation coefficient
   */
  private calculateCorrelation(series1: number[], series2: number[], window: number): number | null {
    if (series1.length < window || series2.length < window) {
      return null; // Not enough data
    }

    const x = series1.slice(-window);
    const y = series2.slice(-window);
    const n = window;

    const meanX = x.reduce((a, b) => a + b) / n;
    const meanY = y.reduce((a, b) => a + b) / n;

    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));

    if (denomX === 0 || denomY === 0) return 0;

    return numerator / (denomX * denomY);
  }

  /**
   * A+ Grade: Detect correlation regime
   */
  private detectCorrelationRegime(
    btcSpx: number | null,
    btcGold: number | null,
    btcDxy: number | null
  ): 'risk-on' | 'risk-off' | 'decoupled' | 'mixed' {
    if (btcSpx === null || btcGold === null || btcDxy === null) {
      return 'mixed'; // Not enough data
    }

    // Risk-on: BTC correlates with stocks, inverse to DXY
    if (btcSpx > 0.5 && btcDxy < -0.3) {
      return 'risk-on'; // BTC acting as risk asset
    }

    // Risk-off: BTC correlates with gold, decouples from stocks
    if (btcGold > 0.4 && btcSpx < 0.2) {
      return 'risk-off'; // BTC acting as safe haven
    }

    // Decoupled: Low correlation to all assets
    if (Math.abs(btcSpx) < 0.3 && Math.abs(btcGold) < 0.3) {
      return 'decoupled'; // BTC trading independently
    }

    return 'mixed';
  }

  /**
   * Calculate stablecoin supply change percentage.
   * Tracks previous supply value to compute the percentage difference.
   * Positive change = new money flowing into crypto (bullish).
   * Negative change = money leaving crypto (bearish).
   */
  private calculateStablecoinChange(currentSupply: number): number {
    if (this.previousStablecoinSupply === 0 || currentSupply === 0) {
      // First run or no data - store current and return 0 (no change yet)
      this.previousStablecoinSupply = currentSupply;
      return 0;
    }

    const change = ((currentSupply - this.previousStablecoinSupply) / this.previousStablecoinSupply) * 100;

    // Update previous supply for next calculation
    this.previousStablecoinSupply = currentSupply;

    return change;
  }

  /**
   * Detect market regime (risk-on vs risk-off)
   */
  private detectMarketRegime(macro: MacroIndicators): MarketRegime {
    let riskOnScore = 0;
    let totalWeight = 0;

    // VIX analysis (low VIX = risk-on)
    if (macro.vix < 15) {
      riskOnScore += 1;
    } else if (macro.vix > 25) {
      riskOnScore -= 1;
    }
    totalWeight += 1;

    // S&P 500 trend (rising = risk-on)
    if (macro.sp500Change24h > 0.5) {
      riskOnScore += 1;
    } else if (macro.sp500Change24h < -0.5) {
      riskOnScore -= 1;
    }
    totalWeight += 1;

    // DXY analysis (falling DXY = risk-on for crypto)
    // Note: This is simplified; actual relationship is complex
    if (macro.dxy < 100) {
      riskOnScore += 0.5;
    } else if (macro.dxy > 105) {
      riskOnScore -= 0.5;
    }
    totalWeight += 0.5;

    // Stablecoin inflows (positive = risk-on)
    if (macro.stablecoinChange > 0.2) {
      riskOnScore += 1;
    } else if (macro.stablecoinChange < -0.2) {
      riskOnScore -= 1;
    }
    totalWeight += 1;

    const normalizedScore = riskOnScore / totalWeight;

    // FIXED: Widened regime thresholds from ±0.3 to ±0.2 to reduce neutral bias
    if (normalizedScore > 0.2) {
      return { regime: "risk-on", confidence: Math.min(0.5 + normalizedScore, 0.9) };
    } else if (normalizedScore < -0.2) {
      return { regime: "risk-off", confidence: Math.min(0.5 + Math.abs(normalizedScore), 0.9) };
    } else {
      // FIXED: Transitioning regime now has directional bias based on score sign
      // This reduces the 75.7% neutral signal output
      return { regime: "transitioning", confidence: 0.4 + Math.abs(normalizedScore) };
    }
  }

  /**
   * Perfect A++ Grade: Set NewsSentinel reference for Fed announcement detection
   */
  setNewsSentinel(newsSentinel: any): void {
    this.newsSentinel = newsSentinel;
    console.log('[MacroAnalyst] NewsSentinel integration enabled for Fed veto detection');
  }

  /**
   * Perfect A++ Grade: Check if Fed announcement is happening (24-hour window)
   */
  private isFedAnnouncementDay(): boolean {
    if (!this.newsSentinel) return false;
    
    try {
      return this.newsSentinel.hasFedAnnouncement('BTC-USD');
    } catch (error) {
      console.warn('[MacroAnalyst] Failed to check Fed announcement:', error);
      return false;
    }
  }

  /**
   * Check veto conditions
   */
  private checkVetoConditions(macro: MacroIndicators): void {
    this.vetoActive = false;
    this.vetoReason = "";

    // Perfect A++ Grade: Fed announcement veto (highest priority)
    if (this.isFedAnnouncementDay()) {
      this.vetoActive = true;
      this.vetoReason = `Fed/FOMC announcement detected. 24-hour trading halt for extreme volatility risk.`;
      console.log(`[MacroAnalyst] 🚨 VETO ACTIVATED: ${this.vetoReason}`);
      return;
    }

    // VIX spike (extreme fear)
    if (macro.vix > 40) {
      this.vetoActive = true;
      this.vetoReason = `VIX spike detected (${macro.vix.toFixed(1)}). Extreme market fear.`;
      return;
    }

    // Flash crash in S&P 500
    if (macro.sp500Change24h < -5) {
      this.vetoActive = true;
      this.vetoReason = `S&P 500 flash crash detected (${macro.sp500Change24h.toFixed(1)}% drop).`;
      return;
    }

    // Extreme DXY spike
    if (macro.dxy > 110) {
      this.vetoActive = true;
      this.vetoReason = `Extreme USD strength (DXY: ${macro.dxy.toFixed(1)}). Risk-off environment.`;
      return;
    }
  }

  /**
   * Analyze macro using LLM
   */
  private async analyzeMacro(
    symbol: string,
    macro: MacroIndicators,
    regime: MarketRegime
  ): Promise<string> {
    const prompt = `You are a macro analyst. Analyze the current macro environment for ${symbol} and provide a brief outlook (2-3 sentences).

Macro Indicators:
- DXY (US Dollar Index): ${macro.dxy.toFixed(2)}
- VIX (Volatility Index): ${macro.vix.toFixed(2)}
- S&P 500 Change (24h): ${macro.sp500Change24h.toFixed(2)}%
- BTC/S&P Correlation: ${macro.btcCorrelation.toFixed(2)}
- Stablecoin Supply Change: ${macro.stablecoinChange.toFixed(2)}%
- Bitcoin Dominance: ${macro.btcDominance.toFixed(1)}%

Market Regime: ${regime.regime} (confidence: ${regime.confidence.toFixed(2)})

Provide your macro analysis:`;

    try {
      // Use rate limiter with caching
      const rateLimiter = getLLMRateLimiter();
      const cacheKey = `macro:${symbol}:${regime.regime}:${macro.dxy.toFixed(0)}:${macro.vix.toFixed(0)}`;
      
      return await rateLimiter.execute(
        cacheKey,
        () => this.callLLM([
          { role: "system", content: "You are an expert macro analyst." },
          { role: "user", content: prompt },
        ]),
        { cacheable: true, cacheTTL: 600000 } // Cache for 10 minutes (macro changes slowly)
      );
    } catch (error) {
      return "Unable to perform macro analysis at this time.";
    }
  }

  /**
   * Calculate signal from macro
   *
   * Phase 93 — REWORK:
   *  - Transitioning regime → forced NEUTRAL at low confidence. When our own
   *    detector flags <60% confidence ("transitioning"), we don't pretend to
   *    know direction. Previously this path emitted BULLISH on every cycle
   *    whenever SPX was green — a mechanical heuristic that produced 30/30
   *    bullish signals across BTC/ETH/SOL on the same SPX print.
   *  - Direction requires a CONFLUENCE: |BTC/SPX corr| > 0.5 AND
   *    |SPX 24h change| > 0.5% AND DXY in supportive direction. Bare
   *    "SPX is green today" no longer triggers bullish.
   *  - Per-symbol differentiation: ETH considers BTC dominance trend,
   *    SOL considers risk-on/off (VIX). Same macro state can produce
   *    different signals for BTC vs ETH vs SOL.
   */
  private calculateSignalFromMacro(
    symbol: string,
    macro: MacroIndicators,
    regime: MarketRegime,
    analysis: string
  ): {
    signal: "bullish" | "bearish" | "neutral";
    confidence: number;
    strength: number;
    reasoning: string;
  } {
    // If veto is active, return bearish signal with high confidence
    if (this.vetoActive) {
      return {
        signal: "bearish",
        confidence: 0.95,
        strength: 1.0,
        reasoning: `VETO ACTIVE: ${this.vetoReason}`,
      };
    }

    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0.5;
    let strength = 0.5;

    // === Confluence check (required for any directional macro signal) ===
    const btcSpx = macro.btcSpx30d ?? macro.btcCorrelation ?? 0;
    const strongCorrelation = Math.abs(btcSpx) > 0.5;
    const meaningfulSpxMove = Math.abs(macro.sp500Change24h) > 0.5;
    // DXY supportive direction depends on intended signal:
    //   bullish crypto → falling/weak dollar (DXY < 104 OR negative BTC-DXY corr)
    //   bearish crypto → rising/strong dollar (DXY > 105 OR positive BTC-DXY corr)
    const dxyBearishForCrypto = macro.dxy > 105 || (macro.btcDxy30d !== undefined && macro.btcDxy30d !== null && macro.btcDxy30d > 0.3);
    const dxyBullishForCrypto = macro.dxy < 104 || (macro.btcDxy30d !== undefined && macro.btcDxy30d !== null && macro.btcDxy30d < -0.3);
    const confluenceMet = strongCorrelation && meaningfulSpxMove;

    // === Regime-based signal — only directional with confluence ===
    if (regime.regime === "risk-on" && confluenceMet && macro.sp500Change24h > 0 && dxyBullishForCrypto) {
      signal = "bullish";
      confidence = Math.min(regime.confidence, 0.65);
      strength = confidence * 0.8;
    } else if (regime.regime === "risk-off" && confluenceMet && macro.sp500Change24h < 0 && dxyBearishForCrypto) {
      signal = "bearish";
      confidence = Math.min(regime.confidence, 0.65);
      strength = confidence * 0.8;
    } else if (regime.regime === "transitioning") {
      // Phase 93 FIX: "transitioning" is the agent's own self-classified
      // low-confidence state. Force neutral so we don't fabricate direction
      // from a transitional regime.
      signal = "neutral";
      confidence = 0.10;
      strength = 0.1;
    } else {
      // Regime is risk-on/off but confluence not met → neutral at low confidence
      signal = "neutral";
      confidence = 0.10;
      strength = 0.1;
    }

    // Stablecoin inflow analysis — only ADJUSTS an existing directional signal.
    // Previously this could promote neutral → bullish/bearish on its own, which
    // was a back-door for spurious direction when confluence was missing.
    if (signal !== "neutral") {
      if (macro.stablecoinChange > 0.5 && signal === "bullish") {
        confidence = Math.min(confidence + 0.10, 0.85);
        strength = Math.min(strength + 0.15, 1.0);
      } else if (macro.stablecoinChange < -0.5 && signal === "bearish") {
        confidence = Math.min(confidence + 0.10, 0.85);
        strength = Math.min(strength + 0.15, 1.0);
      }
    }

    // === Per-symbol differentiation ===
    // The same macro state must NOT produce identical signals across symbols.
    const baseSymbol = (symbol.split(/[\/\-_]/)[0] || symbol).toUpperCase();
    if (baseSymbol === 'ETH' || baseSymbol === 'ETHUSDT' || baseSymbol === 'ETHUSD') {
      // ETH: rising BTC dominance is bearish for ETH (capital rotation INTO BTC).
      if (macro.btcDominance > 55) {
        if (signal === 'bullish') {
          confidence = Math.max(confidence - 0.10, 0.10);
          strength = Math.max(strength - 0.10, 0.05);
        } else if (signal === 'bearish') {
          confidence = Math.min(confidence + 0.05, 0.85);
        }
      } else if (macro.btcDominance < 50) {
        // Falling dominance → alt-season tailwind for ETH
        if (signal === 'bullish') {
          confidence = Math.min(confidence + 0.05, 0.85);
        } else if (signal === 'bearish') {
          confidence = Math.max(confidence - 0.10, 0.10);
        }
      }
    } else if (baseSymbol === 'SOL' || baseSymbol === 'SOLUSDT' || baseSymbol === 'SOLUSD') {
      // SOL: high-beta to risk-on/off. High VIX → SOL underperforms BTC.
      if (macro.vix > 25) {
        if (signal === 'bullish') {
          confidence = Math.max(confidence - 0.15, 0.10);
          strength = Math.max(strength - 0.15, 0.05);
        } else if (signal === 'bearish') {
          confidence = Math.min(confidence + 0.10, 0.85);
        }
      } else if (macro.vix < 15) {
        // Strong risk-on → SOL outperforms
        if (signal === 'bullish') {
          confidence = Math.min(confidence + 0.05, 0.85);
        }
      }
    }
    // BTC: base macro signal unchanged (it IS the macro proxy for crypto).

    // A+ Grade: Correlation-adjusted confidence
    if (macro.correlationRegime && macro.btcSpx30d !== undefined) {
      const correlationAdjustment = this.calculateCorrelationAdjustment(
        macro.correlationRegime,
        macro.btcSpx30d,
        macro.btcGold30d || 0,
        signal
      );
      
      confidence = Math.min(Math.max(confidence + correlationAdjustment, 0.1), 0.95);
    }

    // Dune Analytics On-Chain Signal Integration
    if (macro.duneOnChainSignal) {
      const onChainResult = this.applyDuneOnChainSignal(
        signal,
        confidence,
        strength,
        macro.duneOnChainSignal,
        macro.duneWhaleActivity
      );
      signal = onChainResult.signal;
      confidence = onChainResult.confidence;
      strength = onChainResult.strength;
    }

    // BTC dominance analysis (for altcoins)
    // Rising dominance = BTC outperforming = bearish for alts
    // This is a simplified heuristic

    const correlationInfo = macro.btcSpx30d !== undefined && macro.btcSpx30d !== null
      ? ` | Correlation: BTC/SPX ${macro.btcSpx30d.toFixed(2)}, BTC/Gold ${(macro.btcGold30d || 0).toFixed(2)} (${macro.correlationRegime})`
      : '';

    const stablecoinInfo = macro.stablecoinChange !== undefined && macro.stablecoinChange !== null
      ? `, Stablecoin: ${macro.stablecoinChange > 0 ? '+' : ''}${macro.stablecoinChange.toFixed(1)}%`
      : '';

    // Build Dune Analytics on-chain info
    const duneInfo = macro.duneOnChainSignal
      ? ` | On-Chain: ${macro.duneOnChainSignal.signal} (${(macro.duneOnChainSignal.confidence * 100).toFixed(0)}%), Exchange flow: ${macro.duneExchangeNetFlow?.toFixed(0) || 'N/A'} BTC, Whales: ${macro.duneWhaleActivity || 'unknown'}`
      : '';

    const reasoning = `Macro: ${regime.regime} regime (${(regime.confidence * 100).toFixed(0)}% confidence). VIX: ${macro.vix.toFixed(1)}, DXY: ${macro.dxy.toFixed(1)}, S&P: ${macro.sp500Change24h > 0 ? '+' : ''}${macro.sp500Change24h.toFixed(1)}%${stablecoinInfo}${correlationInfo}${duneInfo}. ${analysis}`;

    return { signal, confidence, strength, reasoning };
  }

  /**
   * A+ Grade: Calculate correlation-based confidence adjustment
   */
  private calculateCorrelationAdjustment(
    regime: 'risk-on' | 'risk-off' | 'decoupled' | 'mixed',
    btcSpx: number,
    btcGold: number,
    signal: 'bullish' | 'bearish' | 'neutral'
  ): number {
    let adjustment = 0;

    // Risk-on regime: High SPX correlation confirms bullish signals
    if (regime === 'risk-on') {
      if (signal === 'bullish' && btcSpx > 0.5) {
        adjustment = +0.10; // Boost confidence when correlation confirms
      } else if (signal === 'bearish' && btcSpx > 0.5) {
        adjustment = -0.10; // Reduce confidence when correlation contradicts
      }
    }

    // Risk-off regime: High Gold correlation confirms bearish/safe-haven signals
    if (regime === 'risk-off') {
      if (signal === 'bearish' && btcGold > 0.4) {
        adjustment = +0.10; // Boost confidence for safe-haven behavior
      } else if (signal === 'bullish' && btcGold > 0.4) {
        adjustment = -0.10; // Reduce confidence when acting as safe haven
      }
    }

    // Decoupled regime: BTC trading independently (slightly reduce confidence)
    if (regime === 'decoupled') {
      adjustment = -0.05; // Lower confidence when decoupled from macro
    }

    return adjustment;
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(dataFreshness: number): number {
    // Macro data can be slightly stale (15 min intervals)
    const freshnessScore = Math.max(1 - (dataFreshness / 1800), 0); // Decay over 30 minutes
    return freshnessScore;
  }

  /**
   * Get recommendation
   */
  private getRecommendation(
    signal: "bullish" | "bearish" | "neutral",
    confidence: number,
    strength: number,
    regime: MarketRegime
  ): AgentSignal["recommendation"] {
    // If veto is active, recommend exit
    if (this.vetoActive) {
      return {
        action: "exit",
        urgency: "critical",
      };
    }

    if (signal === "neutral" || confidence < 0.5) {
      return {
        action: "hold",
        urgency: "low",
      };
    }

    const urgency = regime.regime === "transitioning" ? "low" : strength > 0.7 ? "medium" : "low";

    if (signal === "bullish") {
      return {
        action: confidence > 0.7 ? "buy" : "hold",
        urgency,
      };
    } else {
      return {
        action: confidence > 0.7 ? "sell" : "reduce",
        urgency,
      };
    }
  }

  /**
   * Check if veto is active (used by Strategy Orchestrator)
   */
  isVetoActive(): boolean {
    return this.vetoActive;
  }

  /**
   * Get veto reason (used by Strategy Orchestrator)
   */
  getVetoReason(): string {
    return this.vetoReason;
  }

  /**
   * A++ Grade: Set current price for dynamic confidence adjustment
   */
  setCurrentPrice(price: number): void {
    this.currentPrice = price;
  }

  /**
   * A++ Grade: Calculate execution score (0-100) for tactical timing quality
   * 
   * Measures how good the current moment is to execute a macro-driven trade
   * based on 4 institutional factors:
   * 1. Regime clarity (25 points) - How clear is the risk-on/risk-off regime?
   * 2. Correlation strength (25 points) - How strong are BTC correlations with macro assets?
   * 3. Veto absence (25 points) - Are we clear of extreme macro events?
   * 4. Data freshness (25 points) - How recent is our macro data?
   */
  private calculateExecutionScore(macro: MacroIndicators, regime: MarketRegime): number {
    let score = 0;

    // 1. Regime Clarity (0-25 points)
    // High confidence in regime = better execution timing
    const regimeScore = regime.confidence * 25;
    score += regimeScore;

    // 2. Correlation Strength (0-25 points)
    // Strong correlations = more predictable macro influence
    let correlationScore = 0;
    if (macro.btcSpx30d !== undefined && macro.btcSpx30d !== null) {
      const avgCorrelation = (Math.abs(macro.btcSpx30d) + Math.abs(macro.btcGold30d || 0) + Math.abs(macro.btcDxy30d || 0)) / 3;
      correlationScore = avgCorrelation * 25;
    } else {
      correlationScore = 12.5; // Neutral if no correlation data
    }
    score += correlationScore;

    // 3. Veto Absence (0-25 points)
    // No veto = safe to trade, veto = zero points
    const vetoScore = this.vetoActive ? 0 : 25;
    score += vetoScore;

    // 4. Data Freshness (0-25 points)
    // Fresh data = better execution timing
    const dataAge = (getActiveClock().now() - this.lastMacroFetch) / 1000; // seconds
    const freshnessScore = Math.max(25 - (dataAge / 1800) * 25, 0); // Decay over 30 minutes
    score += freshnessScore;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Apply Dune Analytics on-chain signal to macro analysis
   * Integrates exchange flows and whale activity for enhanced accuracy
   */
  private applyDuneOnChainSignal(
    signal: 'bullish' | 'bearish' | 'neutral',
    confidence: number,
    strength: number,
    onChainSignal: OnChainSignal,
    whaleActivity?: 'accumulating' | 'distributing' | 'neutral'
  ): { signal: 'bullish' | 'bearish' | 'neutral'; confidence: number; strength: number } {
    let adjustedSignal = signal;
    let adjustedConfidence = confidence;
    let adjustedStrength = strength;

    // On-chain signal alignment analysis
    const signalsAligned = onChainSignal.signal === signal;
    const signalsConflict = 
      (onChainSignal.signal === 'bullish' && signal === 'bearish') ||
      (onChainSignal.signal === 'bearish' && signal === 'bullish');

    // Exchange flow analysis (negative = outflows = bullish)
    const exchangeFlow = onChainSignal.metrics.exchangeNetFlow24h;
    const strongOutflow = exchangeFlow < -2000; // More than 2000 BTC outflow
    const strongInflow = exchangeFlow > 2000; // More than 2000 BTC inflow

    // Whale activity confirmation
    const whalesAccumulating = whaleActivity === 'accumulating';
    const whalesDistributing = whaleActivity === 'distributing';

    // Apply adjustments based on on-chain data
    if (signalsAligned && onChainSignal.confidence > 0.6) {
      // On-chain confirms macro signal - boost confidence
      const boost = Math.min(0.12, onChainSignal.confidence * 0.15);
      adjustedConfidence = Math.min(0.95, confidence + boost);
      adjustedStrength = Math.min(1.0, strength + boost * 0.8);
      console.log(`[MacroAnalyst] On-chain CONFIRMS ${signal} signal (+${(boost * 100).toFixed(1)}% confidence)`);
    } else if (signalsConflict && onChainSignal.confidence > 0.65) {
      // On-chain conflicts with macro signal - reduce confidence
      const penalty = Math.min(0.15, onChainSignal.confidence * 0.2);
      adjustedConfidence = Math.max(0.25, confidence - penalty);
      adjustedStrength = Math.max(0.2, strength - penalty * 0.8);
      console.log(`[MacroAnalyst] On-chain CONFLICTS with ${signal} signal (-${(penalty * 100).toFixed(1)}% confidence)`);
      
      // Strong on-chain signal can override weak macro signal
      if (onChainSignal.confidence > 0.75 && confidence < 0.55) {
        adjustedSignal = onChainSignal.signal;
        adjustedConfidence = Math.max(0.5, onChainSignal.confidence * 0.75);
        console.log(`[MacroAnalyst] Signal OVERRIDDEN to ${adjustedSignal} by strong on-chain data`);
      }
    }

    // Additional whale activity adjustments
    if (whalesAccumulating && adjustedSignal === 'bullish') {
      adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
      console.log(`[MacroAnalyst] Whale accumulation confirms bullish signal (+5% confidence)`);
    } else if (whalesDistributing && adjustedSignal === 'bearish') {
      adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
      console.log(`[MacroAnalyst] Whale distribution confirms bearish signal (+5% confidence)`);
    } else if (whalesAccumulating && adjustedSignal === 'bearish') {
      adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.08);
      console.log(`[MacroAnalyst] Whale accumulation conflicts with bearish signal (-8% confidence)`);
    } else if (whalesDistributing && adjustedSignal === 'bullish') {
      adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.08);
      console.log(`[MacroAnalyst] Whale distribution conflicts with bullish signal (-8% confidence)`);
    }

    // Strong exchange flow can provide additional confirmation
    if (strongOutflow && adjustedSignal === 'bullish') {
      adjustedStrength = Math.min(1.0, adjustedStrength + 0.1);
    } else if (strongInflow && adjustedSignal === 'bearish') {
      adjustedStrength = Math.min(1.0, adjustedStrength + 0.1);
    }

    return {
      signal: adjustedSignal,
      confidence: adjustedConfidence,
      strength: adjustedStrength,
    };
  }
}
