import EventEmitter from "eventemitter3";
import { getWSManager, WSManagerEvents, TickEvent } from "./WebSocketManager";
import { getDeviationEngine, ExpectedPath, DeviationScore } from "./DeviationEngine";
import { RedisHelpers } from "./redisClient";
import { ExchangeInterface } from "../exchanges";

/**
 * Hot Path Orchestrator
 * Coordinates real-time data ingestion, deviation detection, and event emission
 */

export enum HotPathEvents {
  DEVIATION_ALERT = "deviation_alert",
  STOP_LOSS_HIT = "stop_loss_hit",
  TAKE_PROFIT_HIT = "take_profit_hit",
  PATH_VALIDATED = "path_validated",
  TICK_PROCESSED = "tick_processed",
}

export interface DeviationAlert {
  userId: number;
  symbol: string;
  exchange: string;
  deviationScore: DeviationScore;
  recommendation: "hold" | "exit" | "reduce";
}

export interface ExitSignal {
  userId: number;
  symbol: string;
  exchange: string;
  reason: "stop_loss" | "take_profit" | "deviation";
  currentPrice: number;
  timestamp: number;
}

/**
 * Hot Path Orchestrator
 * Main coordinator for the Hot Path system
 */
export class HotPathOrchestrator extends EventEmitter {
  private wsManager = getWSManager();
  private deviationEngine = getDeviationEngine();
  private activeMonitoring: Map<string, { path: ExpectedPath; side: "long" | "short" }> = new Map();

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for WebSocket Manager
   */
  private setupEventListeners(): void {
    // Listen to tick events from WebSocket Manager
    this.wsManager.on(WSManagerEvents.TICK, (tickEvent: TickEvent) => {
      this.processTick(tickEvent);
    });

    // Listen to connection events
    this.wsManager.on(WSManagerEvents.CONNECTED, (data) => {
      console.log(`[HotPath] Stream connected: ${data.exchange}:${data.symbol}`);
    });

    this.wsManager.on(WSManagerEvents.DISCONNECTED, (data) => {
      console.log(`[HotPath] Stream disconnected: ${data.exchange}:${data.symbol}`);
    });

    this.wsManager.on(WSManagerEvents.ERROR, (data) => {
      console.error(`[HotPath] Stream error: ${data.exchange}:${data.symbol}`, data.error);
    });
  }

  /**
   * Start monitoring a position with expected path
   */
  async startMonitoring(
    userId: number,
    exchange: ExchangeInterface,
    symbol: string,
    expectedPath: ExpectedPath,
    side: "long" | "short"
  ): Promise<void> {
    const monitorKey = this.getMonitorKey(userId, exchange.getExchangeName(), symbol);

    // Store expected path in Redis
    await RedisHelpers.storeExpectedPath(userId, symbol, expectedPath);

    // Store in active monitoring
    this.activeMonitoring.set(monitorKey, { path: expectedPath, side });

    // Subscribe to WebSocket data
    await this.wsManager.subscribe({
      userId,
      exchange,
      symbol,
    });

    console.log(`[HotPath] Started monitoring ${monitorKey}`);
  }

  /**
   * Stop monitoring a position
   */
  async stopMonitoring(userId: number, exchangeName: string, symbol: string): Promise<void> {
    const monitorKey = this.getMonitorKey(userId, exchangeName, symbol);

    // Remove from active monitoring
    this.activeMonitoring.delete(monitorKey);

    // Unsubscribe from WebSocket
    await this.wsManager.unsubscribe(userId, exchangeName, symbol);

    console.log(`[HotPath] Stopped monitoring ${monitorKey}`);
  }

  /**
   * Process incoming tick data
   */
  private async processTick(tickEvent: TickEvent): Promise<void> {
    const { userId, exchange, symbol, tick } = tickEvent;
    const monitorKey = this.getMonitorKey(userId, exchange, symbol);

    // Check if we're monitoring this position
    const monitoring = this.activeMonitoring.get(monitorKey);
    if (!monitoring) {
      return; // Not monitoring this position
    }

    const { path, side } = monitoring;

    try {
      // Calculate deviation score
      const deviationScore = await this.deviationEngine.processAndStoreDeviation(
        exchange,
        tick,
        path
      );

      // Emit tick processed event
      this.emit(HotPathEvents.TICK_PROCESSED, {
        userId,
        symbol,
        exchange,
        tick,
        deviationScore,
      });

      // Check for deviation alerts
      if (deviationScore.isAlert) {
        await this.handleDeviationAlert(userId, exchange, symbol, deviationScore);
      }

      // Check exit conditions (stop loss / take profit)
      const exitCheck = this.deviationEngine.checkExitConditions(
        tick.price,
        path,
        side
      );

      if (exitCheck.shouldExit) {
        await this.handleExitSignal(userId, exchange, symbol, exitCheck.reason!, tick.price);
      }

      // Validate path adherence
      const elapsedMinutes = (tick.timestamp - path.createdAt) / (1000 * 60);
      const isWithinTolerance = this.deviationEngine.isWithinTolerance(
        tick.price,
        path,
        elapsedMinutes
      );

      if (isWithinTolerance) {
        this.emit(HotPathEvents.PATH_VALIDATED, {
          userId,
          symbol,
          exchange,
          currentPrice: tick.price,
          timestamp: tick.timestamp,
        });
      }
    } catch (error) {
      console.error(`[HotPath] Error processing tick for ${monitorKey}:`, error);
    }
  }

  /**
   * Handle deviation alert
   */
  private async handleDeviationAlert(
    userId: number,
    exchange: string,
    symbol: string,
    deviationScore: DeviationScore
  ): Promise<void> {
    // Determine recommendation based on deviation severity
    let recommendation: "hold" | "exit" | "reduce";

    if (deviationScore.deviationScore > 0.9) {
      recommendation = "exit";
    } else if (deviationScore.deviationScore > 0.8) {
      recommendation = "reduce";
    } else {
      recommendation = "hold";
    }

    const alert: DeviationAlert = {
      userId,
      symbol,
      exchange,
      deviationScore,
      recommendation,
    };

    // Emit deviation alert event
    this.emit(HotPathEvents.DEVIATION_ALERT, alert);

    console.log(
      `[HotPath] Deviation alert for ${exchange}:${symbol} - Score: ${deviationScore.deviationScore.toFixed(2)}, Recommendation: ${recommendation}`
    );
  }

  /**
   * Handle exit signal (stop loss / take profit)
   */
  private async handleExitSignal(
    userId: number,
    exchange: string,
    symbol: string,
    reason: "stop_loss" | "take_profit",
    currentPrice: number
  ): Promise<void> {
    const exitSignal: ExitSignal = {
      userId,
      symbol,
      exchange,
      reason,
      currentPrice,
      timestamp: Date.now(),
    };

    // Emit appropriate event
    if (reason === "stop_loss") {
      this.emit(HotPathEvents.STOP_LOSS_HIT, exitSignal);
    } else {
      this.emit(HotPathEvents.TAKE_PROFIT_HIT, exitSignal);
    }

    console.log(
      `[HotPath] Exit signal for ${exchange}:${symbol} - Reason: ${reason}, Price: ${currentPrice}`
    );

    // Stop monitoring this position
    await this.stopMonitoring(userId, exchange, symbol);
  }

  /**
   * Get monitoring key
   */
  private getMonitorKey(userId: number, exchange: string, symbol: string): string {
    return `${userId}:${exchange}:${symbol}`;
  }

  /**
   * Get all active monitoring positions
   */
  getActiveMonitoring(): string[] {
    return Array.from(this.activeMonitoring.keys());
  }

  /**
   * Check if a position is being monitored
   */
  isMonitoring(userId: number, exchange: string, symbol: string): boolean {
    const monitorKey = this.getMonitorKey(userId, exchange, symbol);
    return this.activeMonitoring.has(monitorKey);
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeMonitoring: number;
    activeStreams: number;
    monitoringKeys: string[];
  } {
    const wsStats = this.wsManager.getStats();

    return {
      activeMonitoring: this.activeMonitoring.size,
      activeStreams: wsStats.activeStreams,
      monitoringKeys: Array.from(this.activeMonitoring.keys()),
    };
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    console.log("[HotPath] Shutting down orchestrator");

    // Stop all monitoring
    const keys = Array.from(this.activeMonitoring.keys());
    for (const key of keys) {
      const [userId, exchange, symbol] = key.split(":");
      await this.stopMonitoring(parseInt(userId), exchange, symbol);
    }

    // Remove all listeners
    this.removeAllListeners();

    console.log("[HotPath] Orchestrator shutdown complete");
  }
}

// Singleton instance
let hotPathInstance: HotPathOrchestrator | null = null;

/**
 * Get Hot Path Orchestrator singleton instance
 */
export function getHotPath(): HotPathOrchestrator {
  if (!hotPathInstance) {
    hotPathInstance = new HotPathOrchestrator();
  }
  return hotPathInstance;
}

/**
 * Shutdown Hot Path Orchestrator
 */
export async function shutdownHotPath(): Promise<void> {
  if (hotPathInstance) {
    await hotPathInstance.shutdown();
    hotPathInstance = null;
  }
}
