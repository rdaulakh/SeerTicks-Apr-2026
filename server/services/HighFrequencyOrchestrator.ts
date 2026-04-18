import { EventEmitter } from 'events';
import { getHighFrequencyTickProcessor, type Tick } from './HighFrequencyTickProcessor';
import { getScalpingStrategyEngine, type ScalpingSignal, type ScalpingConfig } from './ScalpingStrategyEngine';
import { getBinanceWebSocketManager } from '../exchanges/BinanceWebSocketManager';

/**
 * High-Frequency Trading Orchestrator
 * 
 * Connects WebSocket tick data → Tick Processor → Strategy Engine → Execution
 * Operates in milliseconds for scalping strategies
 */

export interface HFTConfig {
  symbols: string[]; // Trading symbols (e.g., ['BTCUSDT', 'ETHUSDT'])
  scalpingConfig: Partial<ScalpingConfig>;
  enableMomentum: boolean;
  enableVolume: boolean;
  enableOrderBook: boolean;
}

const DEFAULT_CONFIG: HFTConfig = {
  symbols: ['BTCUSDT'],
  scalpingConfig: {},
  enableMomentum: true,
  enableVolume: true,
  enableOrderBook: false, // Order book not yet implemented
};

/**
 * High-Frequency Trading Orchestrator
 */
export class HighFrequencyOrchestrator extends EventEmitter {
  private config: HFTConfig;
  private tickProcessor = getHighFrequencyTickProcessor();
  private strategyEngine = getScalpingStrategyEngine();
  private wsManager = getBinanceWebSocketManager();
  
  private isRunning: boolean = false;
  private currentPrices: Map<string, number> = new Map();
  
  // Performance tracking
  private ticksProcessed: number = 0;
  private signalsGenerated: number = 0;
  private startTime: number = 0;

  constructor(config: Partial<HFTConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Update strategy engine config
    if (this.config.scalpingConfig) {
      this.strategyEngine.updateConfig(this.config.scalpingConfig);
    }

    // Connect tick processor to strategy engine
    this.setupEventHandlers();

    console.log('[HighFrequencyOrchestrator] Initialized with config:', this.config);
  }

  /**
   * Setup event handlers between components
   */
  private setupEventHandlers(): void {
    // Momentum signals → Strategy engine
    this.tickProcessor.on('momentum_signal', (signal) => {
      const currentPrice = this.currentPrices.get(signal.symbol);
      if (currentPrice) {
        this.strategyEngine.processMomentumSignal(signal, currentPrice);
      }
    });

    // Volume signals → Strategy engine
    this.tickProcessor.on('volume_signal', (signal) => {
      const currentPrice = this.currentPrices.get(signal.symbol);
      if (currentPrice) {
        this.strategyEngine.processVolumeSignal(signal, currentPrice);
      }
    });

    // Scalping signals → Emit for execution
    this.strategyEngine.on('scalping_signal', (signal: ScalpingSignal) => {
      this.signalsGenerated++;
      this.emit('trading_signal', signal);
    });

    // Tick processed → Track performance
    this.tickProcessor.on('tick_processed', (data) => {
      this.ticksProcessed++;
      
      // Emit status every 1000 ticks
      if (this.ticksProcessed % 1000 === 0) {
        this.emitStatus();
      }
    });
  }

  /**
   * Start high-frequency trading
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[HighFrequencyOrchestrator] Already running');
      return;
    }

    console.log('[HighFrequencyOrchestrator] Starting HFT for symbols:', this.config.symbols);

    this.isRunning = true;
    this.startTime = Date.now();

    // Subscribe to WebSocket streams for each symbol
    for (const symbol of this.config.symbols) {
      // Subscribe to trade stream for tick data
      this.wsManager.subscribe({
        symbol,
        streams: ['trade', 'ticker'],
      });

      // Handle trade events (individual ticks)
      this.wsManager.on('trade', (tradeEvent) => {
        if (tradeEvent.symbol === symbol) {
          const tick: Tick = {
            symbol: tradeEvent.symbol,
            price: tradeEvent.price,
            quantity: tradeEvent.quantity,
            timestamp: tradeEvent.timestamp,
            isBuyerMaker: tradeEvent.isBuyerMaker,
          };

          // Update current price
          this.currentPrices.set(symbol, tick.price);

          // Process tick
          this.tickProcessor.processTick(tick);
        }
      });

      // Handle ticker events (for current price updates)
      this.wsManager.on('ticker', (tickerEvent) => {
        if (tickerEvent.symbol === symbol) {
          this.currentPrices.set(symbol, tickerEvent.lastPrice);
        }
      });

      console.log(`[HighFrequencyOrchestrator] ✅ Subscribed to ${symbol} tick stream`);
    }

    this.emit('started', {
      symbols: this.config.symbols,
      config: this.config,
    });
  }

  /**
   * Stop high-frequency trading
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('[HighFrequencyOrchestrator] Not running');
      return;
    }

    console.log('[HighFrequencyOrchestrator] Stopping HFT');

    this.isRunning = false;

    // Unsubscribe from all WebSocket streams
    for (const symbol of this.config.symbols) {
      this.wsManager.unsubscribe(symbol);
    }

    // Clear tick processor data
    this.tickProcessor.clearAll();

    this.emit('stopped', {
      ticksProcessed: this.ticksProcessed,
      signalsGenerated: this.signalsGenerated,
      runtime: Date.now() - this.startTime,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HFTConfig>): void {
    const wasRunning = this.isRunning;

    // Stop if running
    if (wasRunning) {
      this.stop();
    }

    // Update config
    this.config = { ...this.config, ...config };

    // Update strategy engine config
    if (config.scalpingConfig) {
      this.strategyEngine.updateConfig(config.scalpingConfig);
    }

    console.log('[HighFrequencyOrchestrator] Config updated:', this.config);

    // Restart if was running
    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
    symbols: string[];
    ticksProcessed: number;
    signalsGenerated: number;
    runtime: number;
    tickProcessorLatency: number;
    strategyEngineStats: any;
  } {
    return {
      isRunning: this.isRunning,
      symbols: this.config.symbols,
      ticksProcessed: this.ticksProcessed,
      signalsGenerated: this.signalsGenerated,
      runtime: this.isRunning ? Date.now() - this.startTime : 0,
      tickProcessorLatency: this.tickProcessor.getAverageLatency(),
      strategyEngineStats: this.strategyEngine.getStats(),
    };
  }

  /**
   * Emit status update
   */
  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  /**
   * Get current price for a symbol
   */
  getCurrentPrice(symbol: string): number | undefined {
    return this.currentPrices.get(symbol);
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.ticksProcessed = 0;
    this.signalsGenerated = 0;
    this.startTime = Date.now();
    this.strategyEngine.resetStats();
  }
}

// Singleton instance
let hftOrchestrator: HighFrequencyOrchestrator | null = null;

export function getHighFrequencyOrchestrator(): HighFrequencyOrchestrator {
  if (!hftOrchestrator) {
    hftOrchestrator = new HighFrequencyOrchestrator();
  }
  return hftOrchestrator;
}
