import { EventEmitter } from "events";
import { AgentManager } from "../agents/AgentBase";
import { getBinanceWebSocketManager } from "../exchanges/BinanceWebSocketManager";
import { CoinbaseWebSocketManager } from "../exchanges/CoinbaseWebSocketManager";
import { coinbasePublicWebSocket } from "../services/CoinbasePublicWebSocket";
import { getCandleCache } from "../WebSocketCandleCache";
import { StrategyOrchestrator } from "./StrategyOrchestrator";
import { TechnicalAnalyst } from "../agents/TechnicalAnalyst";
import { priceFeedService } from "../services/priceFeedService";
// DISABLED (Feb 6, 2026): CoinAPI WebSocket removed — 100% broken, see audit reports
// import { getCoinAPIWebSocket } from "../services/CoinAPIWebSocket";
import { webSocketFallbackManager } from "../services/WebSocketFallbackManager";
import { PatternMatcher } from "../agents/PatternMatcher";
import { OrderFlowAnalyst } from "../agents/OrderFlowAnalyst";
import { SentimentAnalyst } from "../agents/SentimentAnalyst";
import { NewsSentinel } from "../agents/NewsSentinel";
import { MacroAnalyst } from "../agents/MacroAnalyst";
import { OnChainAnalyst } from "../agents/OnChainAnalyst";
import { WhaleTracker } from "../agents/WhaleTracker";
import { FundingRateAnalyst } from "../agents/FundingRateAnalyst";
import { LiquidationHeatmap } from "../agents/LiquidationHeatmap";
import { OnChainFlowAnalyst } from "../agents/OnChainFlowAnalyst";
import { VolumeProfileAnalyzer } from "../agents/VolumeProfileAnalyzer";
import { MLPredictionAgent } from "../agents/MLPredictionAgent";
import { getMLIntegrationService } from "../services/MLIntegrationService";
import type { ExchangeInterface } from "../exchanges/ExchangeInterface";
import type { TradeRecommendation } from "./StrategyOrchestrator";
import { getPerformanceMonitor } from "../services/PerformanceMonitor";

/**
 * Symbol Orchestrator
 * Manages trading for a single symbol on a single exchange
 * Coordinates agents, strategy orchestrator, and position management
 */
export class SymbolOrchestrator extends EventEmitter {
  private symbol: string;
  private exchangeName: string;
  private adapter: ExchangeInterface;
  private userId: number;
  
  private agentManager: AgentManager;
  private strategyOrchestrator: StrategyOrchestrator;
  
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL_MS = 5000; // 5 seconds (for slow agents only)
  private readonly SLOW_AGENT_INTERVAL_MS = 300000; // 5 minutes for slow agents (optimized for API limits)
  // API Rate Limits:
  // - Reddit OAuth: 60 RPM (1 request per second) → 5-min interval = 12 req/hour (well within limit)
  // - Alternative.me F&G: No official limit → 5-min interval = 12 req/hour (conservative)
  // - LLM (GPT-4): Cached for 5 minutes → Effective cost: ~$0.007/hour per symbol
  // Total: 24 API requests/hour (safe for production)
  
  private currentPrice: number = 0;
  private lastRecommendation: TradeRecommendation | null = null;
  private lastUpdate: Date = new Date();
  private lastSlowAgentUpdate: Date = new Date();
  private nextSlowAgentUpdate: Date = new Date();
  // Debounce fast agent updates to batch trades together
  private fastAgentDebounceTimer: NodeJS.Timeout | null = null;
  private readonly FAST_AGENT_DEBOUNCE_MS = 2000; // Phase 11 Fix 4: Was 50ms (20/sec) — caused 67-second signal queue. 2000ms (0.5/sec) is sufficient for crypto entry decisions
  
  // WebSocket integration (exchange-specific)
  private wsManager: any = null; // Will be initialized based on exchange
  private useWebSocket: boolean = true; // Toggle for WebSocket vs REST polling
  private wsHealthy: boolean = false; // Track WebSocket connection health

  constructor(
    symbol: string,
    exchangeName: string,
    adapter: ExchangeInterface,
    userId: number
  ) {
    super();
    this.symbol = symbol;
    this.exchangeName = exchangeName;
    this.adapter = adapter;
    this.userId = userId;
    
    // Initialize agent manager
    this.agentManager = new AgentManager();
    
    // Initialize strategy orchestrator (per-symbol instance)
    // Account balance will be fetched dynamically during initialization
    const accountBalance = 100000; // Initial default, will be updated from wallet
    this.strategyOrchestrator = new StrategyOrchestrator(
      this.symbol,
      this.agentManager,
      this.userId,
      accountBalance
    );
    this.strategyOrchestrator.setExchange(this.adapter);
    
    // Fetch actual account balance asynchronously
    this.fetchAndUpdateAccountBalance().catch(err => {
      console.error(`[SymbolOrchestrator] Failed to fetch account balance:`, err);
    });
  }

  /**
   * Start the symbol orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`[SymbolOrchestrator] ${this.symbol} already running`);
      return;
    }

    console.log(`[SymbolOrchestrator] Starting ${this.exchangeName}:${this.symbol}`);

    try {
      // Initialize agents
      await this.initializeAgents();

      // Start agents
      await this.agentManager.startAll();

      this.isRunning = true;
      
      // Initialize slow agent update timestamps
      const now = new Date();
      this.lastSlowAgentUpdate = now;
      this.nextSlowAgentUpdate = new Date(now.getTime() + this.SLOW_AGENT_INTERVAL_MS);
      
      // Trigger slow agents immediately on first start
      console.log(`[SymbolOrchestrator] ${this.symbol} - Triggering slow agents immediately on first start`);
      setTimeout(async () => {
        try {
          await this.strategyOrchestrator.getSlowRecommendation(this.symbol);
          console.log(`[SymbolOrchestrator] ${this.symbol} - Initial slow agent update complete`);
        } catch (error) {
          console.error(`[SymbolOrchestrator] ${this.symbol} - Initial slow agent update failed:`, error);
        }
      }, 1000); // Wait 1 second after start to let fast agents initialize first

      // Subscribe to WebSocket if enabled
      if (this.useWebSocket) {
        this.setupWebSocket();
      }

      // INFRASTRUCTURE FIX (Feb 6, 2026): CoinAPI WebSocket DISABLED
      // All price data flows through Coinbase WebSocket (FREE, reliable)
      // See: PRICE_FEED_AUDIT_REPORT.md and API_SERVICES_AUDIT_REPORT.md
      console.log(`[SymbolOrchestrator] ${this.symbol} - Using Coinbase WebSocket as primary price feed`);

      // Start periodic updates (for slow agents only when WebSocket is enabled)
      this.startUpdateLoop();

      console.log(`[SymbolOrchestrator] ${this.symbol} started successfully`);
    } catch (error) {
      console.error(`[SymbolOrchestrator] Failed to start ${this.symbol}:`, error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Stop the symbol orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log(`[SymbolOrchestrator] Stopping ${this.symbol}`);

    // Unsubscribe from WebSocket
    if (this.wsManager && this.useWebSocket) {
      try {
        if (this.exchangeName.toLowerCase() === 'binance') {
          this.wsManager.unsubscribe(this.symbol);
        } else if (this.exchangeName.toLowerCase() === 'coinbase') {
          this.wsManager.disconnect();
        }
        console.log(`[SymbolOrchestrator] Unsubscribed from ${this.exchangeName} WebSocket for ${this.symbol}`);
      } catch (error: any) {
        console.error(`[SymbolOrchestrator] Error unsubscribing from WebSocket:`, error.message);
      }
    }

    // Stop update loop
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Stop agents
    await this.agentManager.stopAll();

    this.isRunning = false;

    console.log(`[SymbolOrchestrator] ${this.symbol} stopped`);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      symbol: this.symbol,
      exchange: this.exchangeName,
      running: this.isRunning,
      currentPrice: this.currentPrice,
      lastRecommendation: this.lastRecommendation,
      lastUpdate: this.lastUpdate,
      lastSlowAgentUpdate: this.lastSlowAgentUpdate,
      nextSlowAgentUpdate: this.nextSlowAgentUpdate,
      agentHealth: this.agentManager.getAllHealth(),
      agentsWithSignals: this.agentManager.getAllAgentsWithSignals(), // Include latest signals
      consensusThreshold: (this.strategyOrchestrator as any).config.consensusThreshold, // Expose threshold for frontend
    };
  }

  /**
   * Initialize all trading agents
   */
  private async initializeAgents(): Promise<void> {
    // Create core agents
    const technical = new TechnicalAnalyst();
    const pattern = new PatternMatcher();
    const orderFlow = new OrderFlowAnalyst();
    const sentiment = new SentimentAnalyst();
    const news = new NewsSentinel();
    const macro = new MacroAnalyst();
    const onChain = new OnChainAnalyst();
    
    // Create Phase 2 signal-generating agents
    const whaleTracker = new WhaleTracker();
    const fundingRate = new FundingRateAnalyst();
    const liquidation = new LiquidationHeatmap();
    const onChainFlow = new OnChainFlowAnalyst();
    const volumeProfile = new VolumeProfileAnalyzer();

    // Set exchange for agents that need market data
    technical.setExchange(this.adapter);
    pattern.setExchange(this.adapter);
    orderFlow.setExchange(this.adapter);
    volumeProfile.setExchange(this.adapter);

    // Perfect A++ Integration: Connect MacroAnalyst to NewsSentinel for Fed veto detection
    macro.setNewsSentinel(news);

    // Register core agents
    this.agentManager.registerAgent(technical);
    this.agentManager.registerAgent(pattern);
    this.agentManager.registerAgent(orderFlow);
    this.agentManager.registerAgent(sentiment);
    this.agentManager.registerAgent(news);
    this.agentManager.registerAgent(macro);
    this.agentManager.registerAgent(onChain);
    
    // Register Phase 2 signal-generating agents
    this.agentManager.registerAgent(whaleTracker);
    this.agentManager.registerAgent(fundingRate);
    this.agentManager.registerAgent(liquidation);
    this.agentManager.registerAgent(onChainFlow);
    this.agentManager.registerAgent(volumeProfile);

    // Register ML Prediction Agent (Phase 3 - Neural Network Predictions)
    try {
      const mlService = getMLIntegrationService();
      if (mlService.isMLPredictionEnabled()) {
        const mlPrediction = new MLPredictionAgent();
        this.agentManager.registerAgent(mlPrediction);
        console.log(`[SymbolOrchestrator] ML Prediction Agent registered for ${this.symbol}`);
      } else {
        console.log(`[SymbolOrchestrator] ML Prediction Agent disabled, skipping registration`);
      }
    } catch (error) {
      console.warn(`[SymbolOrchestrator] Failed to register ML Prediction Agent:`, error);
    }

    console.log(`[SymbolOrchestrator] Initialized 13 agents for ${this.symbol}`);
  }

  /**
   * Start the update loop
   */
  private startUpdateLoop(): void {
    // Run immediately
    this.runUpdate().catch(err => {
      console.error(`[SymbolOrchestrator] Update error for ${this.symbol}:`, err);
    });

    // Then run periodically
    this.updateInterval = setInterval(() => {
      this.runUpdate().catch(err => {
        console.error(`[SymbolOrchestrator] Update error for ${this.symbol}:`, err);
      });
    }, this.UPDATE_INTERVAL_MS);

    console.log(`[SymbolOrchestrator] Update loop started for ${this.symbol} (interval: ${this.UPDATE_INTERVAL_MS}ms)`);
  }

  /**
   * Run one update cycle
   */
  private async runUpdate(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Skip REST polling if WebSocket is enabled (WebSocket provides real-time updates)
      if (this.useWebSocket) {
        // Only run slow agents on this interval (5 minutes)
        const now = new Date();
        const timeSinceLastSlowUpdate = now.getTime() - this.lastSlowAgentUpdate.getTime();
        
        if (timeSinceLastSlowUpdate < this.SLOW_AGENT_INTERVAL_MS) {
          return; // Skip this update, not time for slow agents yet
        }
        
        console.log(`[SymbolOrchestrator] ${this.symbol} - Running slow agent update`);
        this.lastSlowAgentUpdate = now;
        this.nextSlowAgentUpdate = new Date(now.getTime() + this.SLOW_AGENT_INTERVAL_MS);
        
        // A++ Grade: Inject live price into SentimentAnalyst before slow agent update
        const sentimentAnalyst = this.agentManager.getAgent('SentimentAnalyst');
        if (sentimentAnalyst && typeof (sentimentAnalyst as any).setCurrentPrice === 'function') {
          (sentimentAnalyst as any).setCurrentPrice(this.currentPrice);
          console.log(`[SymbolOrchestrator] 💰 Injected live price $${this.currentPrice.toFixed(2)} into SentimentAnalyst`);
        }
        
        // Trigger ONLY slow agents (Sentiment, News, Macro, OnChain)
        await this.strategyOrchestrator.getSlowRecommendation(this.symbol);
        
        console.log(`[SymbolOrchestrator] ${this.symbol} - Slow agent update complete, next update at ${this.nextSlowAgentUpdate.toISOString()}`);
        return;
      }

      // REST polling mode (fallback when WebSocket is disabled)
      // ✅ FIX: Try priceFeedService cache first, only fall back to REST if no cached price
      const cachedPrice = priceFeedService.getLatestPrice(this.symbol);
      if (cachedPrice && cachedPrice.price > 0) {
        this.currentPrice = cachedPrice.price;
      } else {
        // Only call REST API if no cached price available
        this.currentPrice = await this.adapter.getCurrentPrice(this.symbol);
      }
      const candles = await this.adapter.getMarketData(this.symbol, '5m', 100);
      const orderBook = await this.adapter.getOrderBook(this.symbol, 20);

      console.log(`[SymbolOrchestrator] ${this.symbol} - Price: $${this.currentPrice.toFixed(2)}, Candles: ${candles.length}`);

      // Get trading recommendation from strategy orchestrator
      const recommendation = await this.strategyOrchestrator.getRecommendation(this.symbol);
      
      if (recommendation) {
        this.lastRecommendation = recommendation;
        console.log(`[SymbolOrchestrator] ${this.symbol} - ${recommendation.action} signal (confidence: ${recommendation.confidence}%)`);
        
        // Emit recommendation event
        this.emit("recommendation", {
          symbol: this.symbol,
          price: this.currentPrice,
          recommendation,
          timestamp: Date.now(),
        });
      }

      this.lastUpdate = new Date();

    } catch (error: any) {
      console.error(`[SymbolOrchestrator] Error updating ${this.symbol}:`, error.message);
      this.emit("error", error);
    }
  }

  /**
   * Setup WebSocket for real-time price updates (exchange-specific)
   */
  private async setupWebSocket(): Promise<void> {
    console.log(`[SymbolOrchestrator] Setting up WebSocket for ${this.exchangeName}:${this.symbol}`);
    console.log(`[SymbolOrchestrator] DEBUG: exchangeName='${this.exchangeName}', toLowerCase()='${this.exchangeName.toLowerCase()}'`);

    try {
      // Initialize exchange-specific WebSocket manager
      if (this.exchangeName.toLowerCase() === 'binance') {
        this.wsManager = getBinanceWebSocketManager();
        
        // Subscribe to Binance streams
        this.wsManager.subscribe({
          symbol: this.symbol,
          streams: ['trade', 'ticker', 'depth@100ms', 'kline_1m', 'kline_5m', 'kline_1h', 'kline_4h', 'kline_1d'],
        });
      } else if (this.exchangeName.toLowerCase() === 'coinbase') {
        console.log('[SymbolOrchestrator] DEBUG: Entering Coinbase WebSocket setup for ' + this.symbol);
        // Get API credentials from adapter
        const apiKey = (this.adapter as any).apiKey;
        const apiSecret = (this.adapter as any).apiSecret;
        const hasApiKeys = !!(apiKey && apiSecret);
        console.log(`[SymbolOrchestrator] DEBUG: API Key exists: ${!!apiKey}, API Secret exists: ${!!apiSecret}, hasApiKeys: ${hasApiKeys}`);
        
        // Determine the symbol format for Coinbase
        // For public WS: BTC-USD format (already our standard)
        // For authenticated WS: may need normalization
        const normalizedSymbol = hasApiKeys 
          ? (this.adapter as any).normalizeSymbol(this.symbol)
          : this.symbol; // Public WS uses BTC-USD format directly
        console.log(`[SymbolOrchestrator] Normalized symbol for Coinbase: ${this.symbol} -> ${normalizedSymbol}`);

        if (hasApiKeys) {
          // AUTHENTICATED PATH: Use Advanced Trade WebSocket (requires API keys)
          console.log(`[SymbolOrchestrator] Using AUTHENTICATED Coinbase WebSocket for ${this.symbol}`);
          
          this.wsManager = new CoinbaseWebSocketManager({
            apiKey,
            apiSecret,
            symbols: [normalizedSymbol],
            channels: ['ticker', 'level2', 'heartbeats'],
          });
          
          // Coinbase Advanced Trade event handlers
          this.wsManager.on('ticker', (event: any) => {
            if (event.product_id === normalizedSymbol) {
              const normalizedEvent = {
                symbol: event.product_id,
                lastPrice: parseFloat(event.price),
                price: parseFloat(event.price),
                volume: parseFloat(event.volume_24_h || '0'),
                high: parseFloat(event.high_24_h || '0'),
                low: parseFloat(event.low_24_h || '0'),
                timestamp: new Date(event.timestamp).getTime(),
              };
              console.log(`[SymbolOrchestrator] ⚡ coinbase TRADE: ${this.symbol} @ $${normalizedEvent.price}`);
              this.handleWebSocketTrade(normalizedEvent);
              this.handleWebSocketTicker(normalizedEvent);
            }
          });

          this.wsManager.on('level2', (event: any) => {
            if (event.product_id === normalizedSymbol) {
              const normalizedEventDepth = {
                symbol: event.product_id,
                bids: event.updates?.filter((u: any) => u.side === 'bid').map((u: any) => ({
                  price: parseFloat(u.price_level),
                  quantity: parseFloat(u.new_quantity),
                })) || [],
                asks: event.updates?.filter((u: any) => u.side === 'offer').map((u: any) => ({
                  price: parseFloat(u.price_level),
                  quantity: parseFloat(u.new_quantity),
                })) || [],
                timestamp: Date.now(),
              };
              this.handleWebSocketDepth(normalizedEventDepth);
            }
          });

          this.wsManager.on('connected', () => {
            console.log(`[SymbolOrchestrator] ✅ Coinbase Authenticated WebSocket connected for ${this.symbol}`);
            this.wsHealthy = true;
            webSocketFallbackManager.reportPrimaryConnected();
          });

          this.wsManager.on('disconnected', () => {
            console.warn(`[SymbolOrchestrator] ⚠️ Coinbase Authenticated WebSocket disconnected for ${this.symbol}`);
            this.wsHealthy = false;
            webSocketFallbackManager.reportPrimaryDisconnected();
          });
          
          this.wsManager.on('error', (error: any) => {
            console.error(`[SymbolOrchestrator] ❌ Coinbase WebSocket error for ${this.symbol}:`, error?.message || 'Unknown error');
            this.wsHealthy = false;
          });

          this.wsManager.on('maxReconnectAttemptsReached', () => {
            console.error(`[SymbolOrchestrator] ❌ Coinbase WebSocket max reconnect attempts reached for ${this.symbol}`);
            webSocketFallbackManager.reportPrimaryDisconnected();
          });
          
          console.log(`[SymbolOrchestrator] ✅ Coinbase authenticated event handlers registered for ${this.symbol}`);
          await this.wsManager.connect();
        } else {
          // PUBLIC PATH: Use FREE Coinbase Exchange WebSocket (no API keys needed)
          // This is the primary path for paper trading mode
          console.log(`[SymbolOrchestrator] 🆓 Using FREE Coinbase Public WebSocket for ${this.symbol} (no API keys required)`);
          
          // Use the singleton public WebSocket service
          // It connects once and serves all symbols
          const publicWs = coinbasePublicWebSocket;
          
          // Register ticker handler for this specific symbol
          publicWs.on('ticker', (event: any) => {
            if (event.product_id === this.symbol) {
              const normalizedEvent = {
                symbol: event.product_id,
                lastPrice: parseFloat(event.price),
                price: parseFloat(event.price),
                volume: parseFloat(event.volume_24_h || '0'),
                high: parseFloat(event.high_24_h || '0'),
                low: parseFloat(event.low_24_h || '0'),
                timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
              };
              this.handleWebSocketTrade(normalizedEvent);
              this.handleWebSocketTicker(normalizedEvent);
            }
          });

          publicWs.on('connected', () => {
            console.log(`[SymbolOrchestrator] ✅ Coinbase Public WebSocket connected for ${this.symbol}`);
            this.wsHealthy = true;
            webSocketFallbackManager.reportPrimaryConnected();
          });

          publicWs.on('disconnected', () => {
            console.warn(`[SymbolOrchestrator] ⚠️ Coinbase Public WebSocket disconnected for ${this.symbol}`);
            this.wsHealthy = false;
            webSocketFallbackManager.reportPrimaryDisconnected();
          });
          
          publicWs.on('error', (error: any) => {
            console.error(`[SymbolOrchestrator] ❌ Coinbase Public WebSocket error for ${this.symbol}:`, error?.message || 'Unknown error');
            this.wsHealthy = false;
          });

          publicWs.on('maxReconnectAttemptsReached', () => {
            console.error(`[SymbolOrchestrator] ❌ Coinbase Public WebSocket max reconnect attempts reached for ${this.symbol}`);
            webSocketFallbackManager.reportPrimaryDisconnected();
          });
          
          // Start the public WebSocket if not already running
          // It's a singleton, so multiple calls to start() are safe
          const allSymbols = ['BTC-USD', 'ETH-USD']; // Default trading symbols
          if (!publicWs.isHealthy()) {
            await publicWs.start(allSymbols);
          }
          
          console.log(`[SymbolOrchestrator] ✅ Coinbase Public WebSocket handlers registered for ${this.symbol}`);
        }
      } else {
        console.warn(`[SymbolOrchestrator] Unknown exchange ${this.exchangeName}, falling back to REST polling`);
        this.useWebSocket = false;
        return;
      }
      
      this.wsHealthy = true;
    } catch (error: any) {
      console.error(`[SymbolOrchestrator] Failed to setup WebSocket for ${this.exchangeName}:${this.symbol}:`, error.message);
      console.log(`[SymbolOrchestrator] Falling back to REST polling for ${this.symbol}`);
      this.useWebSocket = false;
      this.wsHealthy = false;
      return;
    }

    // Initialize candle cache buffers
    const candleCache = getCandleCache();
    candleCache.initializeBuffer(this.symbol, '1m', 500);
    candleCache.initializeBuffer(this.symbol, '5m', 500);
    candleCache.initializeBuffer(this.symbol, '1h', 500);
    candleCache.initializeBuffer(this.symbol, '4h', 500);
    candleCache.initializeBuffer(this.symbol, '1d', 500);

    // Seed historical candles from database (ONCE on startup)
    // This populates the cache so TechnicalAnalyst has data immediately
    console.log(`[SymbolOrchestrator] 📊 Seeding historical candles for ${this.symbol} from database...`);
    try {
      const timeframes = ['1m', '5m', '1h', '4h', '1d'];
      for (const timeframe of timeframes) {
        await candleCache.seedHistoricalCandles(this.symbol, timeframe);
      }
      console.log(`[SymbolOrchestrator] ✅ Historical candles seeded successfully for ${this.symbol}`);
    } catch (error) {
      console.error(`[SymbolOrchestrator] ❌ Failed to seed historical candles for ${this.symbol}:`, error);
      console.log(`[SymbolOrchestrator] Will rely on WebSocket to populate cache gradually`);
    }
    // try {
    //   const { fetchHistoricalCandlesWithRateLimit } = await import('../utils/fetchHistoricalCandles');
    //   const requests = [
    //     { symbol: this.symbol, interval: '1m', limit: 200 },
    //     { symbol: this.symbol, interval: '5m', limit: 200 },
    //     { symbol: this.symbol, interval: '1h', limit: 200 },
    //     { symbol: this.symbol, interval: '4h', limit: 200 },
    //     { symbol: this.symbol, interval: '1d', limit: 200 },
    //   ];
    //   
    //   const historicalData = await fetchHistoricalCandlesWithRateLimit(requests, 500);
    //   
    //   // Seed the cache with historical data
    //   const symbolData = historicalData.get(this.symbol);
    //   if (symbolData) {
    //     for (const [interval, candles] of Array.from(symbolData.entries())) {
    //       if (candles.length > 0) {
    //         await candleCache.seedHistoricalCandles(this.symbol, interval, candles);
    //       }
    //     }
    //   }
    //   
    //   console.log(`[SymbolOrchestrator] ✅ Historical candles seeded for ${this.symbol}`);
    // } catch (error: any) {
    //   console.error(`[SymbolOrchestrator] Failed to seed historical candles:`, error.message);
    //   console.log(`[SymbolOrchestrator] Will rely on WebSocket to populate cache gradually`);
    // }

    // Setup exchange-specific event handlers
    if (this.exchangeName.toLowerCase() === 'binance') {
      // Binance event handlers
      this.wsManager.on('trade', (event: any) => {
        if (event.symbol === this.symbol) {
          this.handleWebSocketTrade(event);
        }
      });

      this.wsManager.on('ticker', (event: any) => {
        if (event.symbol === this.symbol) {
          this.handleWebSocketTicker(event);
        }
      });

      this.wsManager.on('kline', (event: any) => {
        if (event.symbol === this.symbol) {
          this.handleWebSocketKline(event);
        }
      });

      this.wsManager.on('depth', (event: any) => {
        if (event.symbol === this.symbol) {
          this.handleWebSocketDepth(event);
        }
      });

      this.wsManager.on('connected', (event: any) => {
        if (event.symbol === this.symbol) {
          console.log(`[SymbolOrchestrator] ✅ Binance WebSocket connected for ${this.symbol}`);
          this.wsHealthy = true;
        }
      });

      this.wsManager.on('disconnected', (event: any) => {
        if (event.symbol === this.symbol) {
          console.warn(`[SymbolOrchestrator] ⚠️ Binance WebSocket disconnected for ${this.symbol}`);
          this.wsHealthy = false;
        }
      });
      
      this.wsManager.on('error', (errorData: any) => {
        if (errorData.symbol === this.symbol) {
          console.error(`[SymbolOrchestrator] ❌ Binance WebSocket error for ${this.symbol}:`, errorData.error?.message || 'Unknown error');
          this.wsHealthy = false;
        }
      });
    } else if (this.exchangeName.toLowerCase() === 'coinbase') {
      // Coinbase event handlers are registered BEFORE connect() in setupWebSocket()
      // No additional registration needed here
      console.log(`[SymbolOrchestrator] Coinbase handlers already registered for ${this.symbol}`);
    }
    
    console.log(`[SymbolOrchestrator] ✅ WebSocket event handlers registered for ${this.exchangeName}:${this.symbol}`);
  }

  /**
   * Handle WebSocket trade event (real-time price update)
   * Works for both Binance and Coinbase (normalized format)
   */
  private async handleWebSocketTrade(event: any): Promise<void> {
    console.log(`[SymbolOrchestrator] ⚡ ${this.exchangeName} TRADE: ${this.symbol} @ $${event.price}`);
    try {
      // Update current price
      this.currentPrice = event.price;

      // ✅ FIX: Feed price into priceFeedService to eliminate REST API calls
      priceFeedService.updatePrice(this.symbol, event.price, 'websocket', {
        volume24h: event.volume,
      });
      
      // ✅ FIX: Feed tick into TickToCandleAggregator to build OHLCV candles from ticks
      // This is ESSENTIAL for Coinbase which doesn't provide kline/candle streams
      const { getTickToCandleAggregator } = await import('../services/TickToCandleAggregator');
      const aggregator = getTickToCandleAggregator();
      aggregator.processTick(this.symbol, event.price, event.volume || 0, event.timestamp || Date.now());

      // ✅ Update lastTickTime for ALL fast agents immediately on every tick
      // This ensures the UI shows accurate "last tick" time for fast agents
      const tickData = { price: event.price, timestamp: event.timestamp || Date.now(), symbol: this.symbol };
      const fastAgentNames = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst'];
      for (const agentName of fastAgentNames) {
        const agent = this.agentManager.getAgent(agentName);
        if (agent && typeof agent.onTick === 'function') {
          agent.onTick(tickData);
          // Debug: Log tick reception every 100 ticks
          const health = agent.getHealth();
          if (health.ticksReceived % 100 === 0) {
            console.log(`[SymbolOrchestrator] 🎯 ${agentName} received tick #${health.ticksReceived}, lastTickTime: ${health.lastTickTime}`);
          }
        } else {
          console.warn(`[SymbolOrchestrator] ⚠️ Agent ${agentName} not found or missing onTick method`);
        }
      }

      // Phase 11 Fix 4: Debounce fast agent calls at 2000ms (was 50ms = 20x/sec)
      // Crypto markets don't need sub-second entry decisions — 0.5 Hz is sufficient.
      // At 50ms, each cycle was trying 3+ REST API calls (300-2000ms each) = infinite backlog.
      // At 2000ms with cached data (Fix 3), each cycle takes <50ms = no backlog.
      if (this.fastAgentDebounceTimer) {
        clearTimeout(this.fastAgentDebounceTimer);
      }

      this.fastAgentDebounceTimer = setTimeout(async () => {
        const tickStartTime = Date.now();
        const processingStartTime = Date.now();
        try {
          // Inject live WebSocket price into fast agents for tick-level confidence updates
          const patternMatcher = this.agentManager.getAgent('PatternMatcher');
          if (patternMatcher && typeof (patternMatcher as any).setCurrentPrice === 'function') {
            (patternMatcher as any).setCurrentPrice(this.currentPrice);
          }
          
          const orderFlowAnalyst = this.agentManager.getAgent('OrderFlowAnalyst');
          if (orderFlowAnalyst && typeof (orderFlowAnalyst as any).setCurrentPrice === 'function') {
            (orderFlowAnalyst as any).setCurrentPrice(this.currentPrice);
          }
          
          console.log(`[SymbolOrchestrator] 💰 Injected live price $${this.currentPrice.toFixed(2)} into fast agents (PatternMatcher, OrderFlowAnalyst)`);
          
          // Trigger ONLY fast agents (debounced to 50ms for millisecond trading)
          // Fast agents: TechnicalAnalyst, PatternMatcher, OrderFlowAnalyst
          // NO LLM calls - pure math only for sub-100ms response
          // Live price injected into PatternMatcher and OrderFlowAnalyst for A++ dynamic confidence
          const recommendation = await this.strategyOrchestrator.getFastRecommendation(this.symbol);
          
          // Phase 12 Fix: Use cached orchestrator status instead of re-running ALL agents
          // Before: getAllSignals() re-ran all 13 agents (300-2000ms each) on every tick
          // After: Read cached signals from StrategyOrchestrator (0ms, already computed)
          // Use SymbolOrchestrator.getStatus() which has agentsWithSignals from AgentManager
          const cachedAgentSignals = this.agentManager.getAllAgentsWithSignals() || [];
          if (cachedAgentSignals.length > 0) {
            this.emit("agent_signals", {
              symbol: this.symbol,
              signals: cachedAgentSignals.map((a: any) => ({
                agentName: a.agentName,
                signal: a.latestSignal?.signal || 'neutral',
                confidence: a.latestSignal?.confidence || 0,
                strength: a.latestSignal?.strength || 0,
                reasoning: a.latestSignal?.reasoning || '',
                qualityScore: a.latestSignal?.qualityScore || 0,
              })),
              timestamp: Date.now(),
            });
          }
          
          if (recommendation) {
            this.lastRecommendation = recommendation;
            
            // Emit recommendation event
            this.emit("recommendation", {
              symbol: this.symbol,
              price: this.currentPrice,
              recommendation,
              timestamp: Date.now(),
              source: 'websocket',
            });
          }

          this.lastUpdate = new Date();
          
          // Record performance metrics
          const processingTime = Date.now() - processingStartTime;
          // Note: recordTick method doesn't exist in PerformanceMonitor
          // const perfMonitor = getPerformanceMonitor();
          // perfMonitor.recordTick(this.symbol, processingTime);
          
          // Performance monitoring: Log if tick processing exceeds target
          const tickEndTime = Date.now();
          const tickEndTimestamp = new Date().toISOString();
          console.log(`[TICK] End Time: ${tickEndTime}ms`);
          console.log(`[TICK] End Timestamp: ${tickEndTimestamp}`);
          console.log(`[TICK] Total Duration: ${processingTime}ms`);
          if (processingTime > 50) {
            console.warn(`[SymbolOrchestrator] ⚠️ Slow tick processing for ${this.symbol}: ${processingTime}ms (target: <50ms)`);
          } else {
            console.log(`[SymbolOrchestrator] ✅ Fast tick processing for ${this.symbol}: ${processingTime}ms`);
          }
          console.log(`========== TICK END ==========\n`);
        } catch (error: any) {
          console.error(`[SymbolOrchestrator] Error in debounced fast agent update:`, error.message);
        }
      }, this.FAST_AGENT_DEBOUNCE_MS);

    } catch (error: any) {
      console.error(`[SymbolOrchestrator] Error handling WebSocket trade for ${this.symbol}:`, error.message);
    }
  }

  /**
   * Handle WebSocket ticker event (aggregated market data)
   */
  private handleWebSocketTicker(event: any): void {
    // Update current price and volume data
    this.currentPrice = event.lastPrice;
    
    // ✅ FIX: Feed price into priceFeedService
    priceFeedService.updatePrice(this.symbol, event.lastPrice, 'websocket', {
      volume24h: event.volume,
    });
    
    // Log ticker updates (less frequent than trades)
    console.log(`[SymbolOrchestrator] ${this.symbol} - WebSocket Ticker: $${event.lastPrice.toFixed(2)}, Vol: ${event.volume.toFixed(2)}`);
  }

  /**
   * Handle WebSocket kline event (candle update)
   */
  private handleWebSocketKline(event: any): void {
    const candleCache = getCandleCache();
    
    // Add candle to cache
    candleCache.addCandle(
      event.symbol,
      event.interval,
      {
        timestamp: event.openTime,
        open: event.open,
        high: event.high,
        low: event.low,
        close: event.close,
        volume: event.volume,
      },
      event.isClosed
    );

    // Log closed candles only (to avoid spam)
    if (event.isClosed) {
      console.log(`[SymbolOrchestrator] ${this.symbol} - Candle closed: ${event.interval} @ $${event.close.toFixed(2)}`);
    }
  }

  /**
   * Get the strategy orchestrator instance (for connecting PositionManager/RiskManager)
   */
  getStrategyOrchestrator(): StrategyOrchestrator {
    return this.strategyOrchestrator;
  }

  /**
   * Handle WebSocket depth event (order book update)
   */
  private handleWebSocketDepth(event: any): void {
    // BinanceWebSocketManager already parsed the data into {price, quantity} format
    const orderBook = {
      symbol: event.symbol,
      timestamp: event.timestamp || Date.now(),
      bids: event.bids || [], // Already in [{price, quantity}] format
      asks: event.asks || [], // Already in [{price, quantity}] format
    };

    // Pass order book to OrderFlowAnalyst via Hot Path
    // Note: Hot Path integration disabled to prevent module errors
    // OrderFlowAnalyst will use direct order book data instead
    // TODO: Re-enable when Hot Path is properly integrated
    /*
    const { getHotPath, HotPathEvents } = require('../hotpath');
    const hotPath = getHotPath();
    hotPath.emit(HotPathEvents.TICK_PROCESSED, {
      symbol: event.symbol,
      orderBook,
    });
    */
  }

  /**
   * Fetch account balance from paper wallet or exchange and update StrategyOrchestrator
   */
  private async fetchAndUpdateAccountBalance(): Promise<void> {
    try {
      // Import paper wallet functions
      const { getPaperWallet } = await import('../db');
      
      // Try to get paper wallet balance first
      const paperWallet = await getPaperWallet(this.userId);
      
      if (paperWallet && paperWallet.balance) {
        const balance = parseFloat(paperWallet.balance.toString());
        console.log(`[SymbolOrchestrator] Using paper wallet balance: $${balance.toFixed(2)}`);
        this.strategyOrchestrator.updateAccountBalance(balance);
        return;
      }
      
      // If no paper wallet, try to fetch from exchange (for live trading)
      // This would require exchange adapter to have a getAccountBalance() method
      // For now, keep the default $100k
      console.log(`[SymbolOrchestrator] No paper wallet found, using default balance`);
      
    } catch (error) {
      console.error(`[SymbolOrchestrator] Error fetching account balance:`, error);
    }
  }
}
