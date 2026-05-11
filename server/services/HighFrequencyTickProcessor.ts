import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

/**
 * High-Frequency Tick Processor
 * 
 * Processes individual trade ticks in milliseconds for scalping strategies
 * Maintains rolling windows for momentum, volume, and order book analysis
 */

export interface Tick {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
}

export interface TickWindow {
  symbol: string;
  ticks: Tick[];
  startTime: number;
  endTime: number;
  windowSizeMs: number;
}

export interface MomentumSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strength: number; // 0-1
  priceVelocity: number; // $/ms
  volumeVelocity: number; // qty/ms
  timestamp: number;
}

export interface VolumeSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strength: number;
  volumeSpike: number; // ratio vs average
  buyPressure: number; // 0-1 (1 = all buys)
  timestamp: number;
}

export interface OrderBookSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  strength: number;
  bidAskImbalance: number; // positive = more bids
  spread: number;
  timestamp: number;
}

/**
 * High-Frequency Tick Processor
 * Maintains multiple time windows (1s, 5s, 15s) for multi-timeframe analysis
 */
export class HighFrequencyTickProcessor extends EventEmitter {
  // Tick storage by symbol
  private tickWindows: Map<string, {
    window1s: Tick[];
    window5s: Tick[];
    window15s: Tick[];
  }> = new Map();

  // Window sizes in milliseconds
  private readonly WINDOW_1S = 1000;
  private readonly WINDOW_5S = 5000;
  private readonly WINDOW_15S = 15000;

  // Performance tracking
  private processingLatency: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 1000;

  constructor() {
    super();
    console.log('[HighFrequencyTickProcessor] Initialized with 1s, 5s, 15s windows');
  }

  /**
   * Process a new tick and update all windows
   */
  processTick(tick: Tick): void {
    const startTime = getActiveClock().now();

    // Initialize windows for symbol if not exists
    if (!this.tickWindows.has(tick.symbol)) {
      this.tickWindows.set(tick.symbol, {
        window1s: [],
        window5s: [],
        window15s: [],
      });
    }

    const windows = this.tickWindows.get(tick.symbol)!;

    // Add tick to all windows
    windows.window1s.push(tick);
    windows.window5s.push(tick);
    windows.window15s.push(tick);

    // Clean old ticks from windows
    const now = tick.timestamp;
    windows.window1s = windows.window1s.filter(t => now - t.timestamp <= this.WINDOW_1S);
    windows.window5s = windows.window5s.filter(t => now - t.timestamp <= this.WINDOW_5S);
    windows.window15s = windows.window15s.filter(t => now - t.timestamp <= this.WINDOW_15S);

    // Generate signals if we have enough data
    if (windows.window1s.length >= 2) {
      this.generateMomentumSignals(tick.symbol, windows);
      this.generateVolumeSignals(tick.symbol, windows);
    }

    // Track processing latency
    const latency = getActiveClock().now() - startTime;
    this.trackLatency(latency);

    // Emit tick processed event
    this.emit('tick_processed', {
      symbol: tick.symbol,
      price: tick.price,
      latency,
    });
  }

  /**
   * Generate momentum signals from price velocity
   */
  private generateMomentumSignals(symbol: string, windows: any): void {
    const ticks1s = windows.window1s;
    const ticks5s = windows.window5s;
    const ticks15s = windows.window15s;

    if (ticks1s.length < 2) return;

    // Calculate price velocity ($/ms) for each window
    const velocity1s = this.calculatePriceVelocity(ticks1s);
    const velocity5s = this.calculatePriceVelocity(ticks5s);
    const velocity15s = this.calculatePriceVelocity(ticks15s);

    // Calculate volume velocity
    const volumeVelocity1s = this.calculateVolumeVelocity(ticks1s);

    // Multi-timeframe confirmation
    const allPositive = velocity1s > 0 && velocity5s > 0 && velocity15s > 0;
    const allNegative = velocity1s < 0 && velocity5s < 0 && velocity15s < 0;

    if (!allPositive && !allNegative) return;

    // Calculate signal strength (0-1)
    const avgVelocity = (Math.abs(velocity1s) + Math.abs(velocity5s) + Math.abs(velocity15s)) / 3;
    const strength = Math.min(avgVelocity * 1000, 1); // Normalize to 0-1

    // Only emit strong signals (> 0.3)
    if (strength > 0.3) {
      const signal: MomentumSignal = {
        symbol,
        direction: allPositive ? 'LONG' : 'SHORT',
        strength,
        priceVelocity: velocity1s,
        volumeVelocity: volumeVelocity1s,
        timestamp: getActiveClock().now(),
      };

      this.emit('momentum_signal', signal);
    }
  }

  /**
   * Generate volume signals from buy/sell pressure
   */
  private generateVolumeSignals(symbol: string, windows: any): void {
    const ticks1s = windows.window1s;

    if (ticks1s.length < 5) return;

    // Calculate buy vs sell volume
    let buyVolume = 0;
    let sellVolume = 0;

    for (const tick of ticks1s) {
      if (tick.isBuyerMaker) {
        sellVolume += tick.quantity; // Buyer maker = sell order filled
      } else {
        buyVolume += tick.quantity; // Taker buy = buy order filled
      }
    }

    const totalVolume = buyVolume + sellVolume;
    if (totalVolume === 0) return;

    const buyPressure = buyVolume / totalVolume;

    // Calculate volume spike (compare to 5s average)
    const ticks5s = windows.window5s;
    const avgVolume5s = ticks5s.reduce((sum: number, t: Tick) => sum + t.quantity, 0) / Math.max(ticks5s.length, 1);
    const currentVolume1s = totalVolume / ticks1s.length;
    const volumeSpike = avgVolume5s > 0 ? currentVolume1s / avgVolume5s : 1;

    // Detect strong buy or sell pressure with volume spike
    const strongBuy = buyPressure > 0.65 && volumeSpike > 1.5;
    const strongSell = buyPressure < 0.35 && volumeSpike > 1.5;

    if (strongBuy || strongSell) {
      const strength = Math.min(volumeSpike / 3, 1); // Normalize to 0-1

      const signal: VolumeSignal = {
        symbol,
        direction: strongBuy ? 'LONG' : 'SHORT',
        strength,
        volumeSpike,
        buyPressure,
        timestamp: getActiveClock().now(),
      };

      this.emit('volume_signal', signal);
    }
  }

  /**
   * Calculate price velocity (change per millisecond)
   */
  private calculatePriceVelocity(ticks: Tick[]): number {
    if (ticks.length < 2) return 0;

    const firstTick = ticks[0];
    const lastTick = ticks[ticks.length - 1];

    const priceChange = lastTick.price - firstTick.price;
    const timeChange = lastTick.timestamp - firstTick.timestamp;

    if (timeChange === 0) return 0;

    return priceChange / timeChange; // $/ms
  }

  /**
   * Calculate volume velocity (quantity per millisecond)
   */
  private calculateVolumeVelocity(ticks: Tick[]): number {
    if (ticks.length < 2) return 0;

    const totalVolume = ticks.reduce((sum, t) => sum + t.quantity, 0);
    const timeSpan = ticks[ticks.length - 1].timestamp - ticks[0].timestamp;

    if (timeSpan === 0) return 0;

    return totalVolume / timeSpan; // qty/ms
  }

  /**
   * Track processing latency
   */
  private trackLatency(latency: number): void {
    this.processingLatency.push(latency);

    if (this.processingLatency.length > this.MAX_LATENCY_SAMPLES) {
      this.processingLatency.shift();
    }
  }

  /**
   * Get average processing latency
   */
  getAverageLatency(): number {
    if (this.processingLatency.length === 0) return 0;

    const sum = this.processingLatency.reduce((a, b) => a + b, 0);
    return sum / this.processingLatency.length;
  }

  /**
   * Get current tick count for a symbol
   */
  getTickCount(symbol: string): { window1s: number; window5s: number; window15s: number } {
    const windows = this.tickWindows.get(symbol);
    
    if (!windows) {
      return { window1s: 0, window5s: 0, window15s: 0 };
    }

    return {
      window1s: windows.window1s.length,
      window5s: windows.window5s.length,
      window15s: windows.window15s.length,
    };
  }

  /**
   * Clear all tick data for a symbol
   */
  clearSymbol(symbol: string): void {
    this.tickWindows.delete(symbol);
  }

  /**
   * Clear all tick data
   */
  clearAll(): void {
    this.tickWindows.clear();
    this.processingLatency = [];
  }
}

// Singleton instance
let tickProcessor: HighFrequencyTickProcessor | null = null;

export function getHighFrequencyTickProcessor(): HighFrequencyTickProcessor {
  if (!tickProcessor) {
    tickProcessor = new HighFrequencyTickProcessor();
  }
  return tickProcessor;
}
