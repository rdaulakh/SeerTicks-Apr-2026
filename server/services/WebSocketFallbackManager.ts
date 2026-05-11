/**
 * WebSocket Fallback Manager
 * 
 * Integrates the MultiProviderPriceFeed with the existing SEER trading system.
 * Provides automatic fallback when the primary exchange WebSocket fails.
 * 
 * Integration Points:
 * - CoinbaseWebSocketManager (primary)
 * - MultiProviderPriceFeed (fallback providers)
 * - priceFeedService (central price cache)
 * 
 * Features:
 * - Monitors primary WebSocket health
 * - Activates fallback providers when primary fails
 * - Returns to primary when it recovers
 * - Provides unified status reporting
 */

import EventEmitter from 'eventemitter3';
import { getActiveClock } from '../_core/clock';
import { multiProviderPriceFeed, MultiProviderPriceFeed, PriceUpdate } from './MultiProviderPriceFeed';
import { priceFeedService } from './priceFeedService';

export interface FallbackManagerStatus {
  primaryConnected: boolean;
  primaryProvider: string;
  fallbackActive: boolean;
  fallbackProvider: string | null;
  lastPrimaryMessage: number | null;
  lastFallbackMessage: number | null;
  symbols: string[];
  totalPriceUpdates: number;
}

export class WebSocketFallbackManager extends EventEmitter {
  private symbols: string[] = [];
  private primaryConnected: boolean = false;
  private fallbackActive: boolean = false;
  private lastPrimaryMessage: number | null = null;
  private lastFallbackMessage: number | null = null;
  private primaryHealthCheckInterval: NodeJS.Timeout | null = null;
  private totalPriceUpdates: number = 0;
  private primaryStaleThresholdMs = 30000; // 30 seconds
  private healthCheckIntervalMs = 5000; // 5 seconds
  private isRunning: boolean = false;

  constructor() {
    super();
  }

  /**
   * Start the fallback manager
   */
  async start(symbols: string[]): Promise<void> {
    if (this.isRunning) {
      console.log('[WebSocketFallbackManager] Already running');
      return;
    }

    this.symbols = symbols;
    this.isRunning = true;

    console.log(`[WebSocketFallbackManager] Starting with symbols: ${symbols.join(', ')}`);

    // Listen for price updates from the central price feed service
    // This helps us track when the primary WebSocket is sending data
    priceFeedService.on('price_update', (priceData) => {
      if (priceData.source === 'websocket') {
        this.lastPrimaryMessage = getActiveClock().now();
        this.primaryConnected = true;
        this.totalPriceUpdates++;
      }
    });

    // Set up event listeners for fallback provider
    multiProviderPriceFeed.on('price', (update: PriceUpdate) => {
      this.lastFallbackMessage = getActiveClock().now();
      this.totalPriceUpdates++;
      
      // If fallback is active, emit the price update
      if (this.fallbackActive) {
        this.emit('fallback_price', update);
      }
    });

    multiProviderPriceFeed.on('connected', (data) => {
      // Suppress CoinCap logs - known service unavailability
      if (data.provider !== 'CoinCap') {
        console.log(`[WebSocketFallbackManager] Fallback provider connected: ${data.provider}`);
      }
      this.emit('fallback_connected', data);
    });

    multiProviderPriceFeed.on('disconnected', (data) => {
      // Suppress CoinCap logs - known service unavailability
      if (data.provider !== 'CoinCap') {
        console.log(`[WebSocketFallbackManager] Fallback provider disconnected: ${data.provider}`);
      }
      this.emit('fallback_disconnected', data);
    });

    multiProviderPriceFeed.on('allProvidersFailed', () => {
      // Don't log error if only CoinCap failed (known issue)
      // Primary CoinAPI WebSocket is the main price feed
      this.emit('all_providers_failed');
    });

    // Start health check interval
    this.startHealthCheck();

    // Pre-initialize fallback providers (but don't activate yet)
    // This ensures they're ready to take over quickly if needed
    await multiProviderPriceFeed.start(symbols);

    console.log('[WebSocketFallbackManager] Started successfully');
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    if (this.primaryHealthCheckInterval) {
      clearInterval(this.primaryHealthCheckInterval);
    }

    this.primaryHealthCheckInterval = setInterval(() => {
      this.checkPrimaryHealth();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Check primary WebSocket health and activate/deactivate fallback
   */
  private checkPrimaryHealth(): void {
    const now = getActiveClock().now();

    // Check if primary is stale
    if (this.lastPrimaryMessage) {
      const timeSinceLastPrimary = now - this.lastPrimaryMessage;

      if (timeSinceLastPrimary > this.primaryStaleThresholdMs) {
        // Primary is stale, activate fallback
        if (!this.fallbackActive) {
          console.warn(`[WebSocketFallbackManager] Primary WebSocket stale (${timeSinceLastPrimary}ms), activating fallback`);
          this.activateFallback();
        }
      } else {
        // Primary is healthy, deactivate fallback if active
        if (this.fallbackActive) {
          console.log(`[WebSocketFallbackManager] Primary WebSocket recovered, deactivating fallback`);
          this.deactivateFallback();
        }
        this.primaryConnected = true;
      }
    } else {
      // No primary messages received yet, check if we should activate fallback
      if (!this.fallbackActive && this.isRunning) {
        // Wait a bit before activating fallback on startup
        const startupGracePeriod = 10000; // 10 seconds
        if (!this.lastPrimaryMessage) {
          console.log('[WebSocketFallbackManager] Waiting for primary WebSocket...');
        }
      }
    }
  }

  /**
   * Activate fallback providers
   */
  private activateFallback(): void {
    if (this.fallbackActive) return;

    console.log('[WebSocketFallbackManager] 🔄 Activating fallback providers');
    this.fallbackActive = true;
    this.primaryConnected = false;

    this.emit('fallback_activated', {
      reason: 'Primary WebSocket stale or disconnected',
      timestamp: getActiveClock().now(),
    });
  }

  /**
   * Deactivate fallback providers
   */
  private deactivateFallback(): void {
    if (!this.fallbackActive) return;

    console.log('[WebSocketFallbackManager] ✅ Deactivating fallback, primary recovered');
    this.fallbackActive = false;
    this.primaryConnected = true;

    this.emit('fallback_deactivated', {
      reason: 'Primary WebSocket recovered',
      timestamp: getActiveClock().now(),
    });
  }

  /**
   * Manually trigger fallback activation
   */
  forceActivateFallback(): void {
    console.log('[WebSocketFallbackManager] Force activating fallback');
    this.activateFallback();
  }

  /**
   * Manually trigger fallback deactivation
   */
  forceDeactivateFallback(): void {
    console.log('[WebSocketFallbackManager] Force deactivating fallback');
    this.deactivateFallback();
  }

  /**
   * Report primary WebSocket message received
   * Called by CoinbaseWebSocketManager or SymbolOrchestrator
   */
  reportPrimaryMessage(): void {
    this.lastPrimaryMessage = getActiveClock().now();
    this.primaryConnected = true;
  }

  /**
   * Report primary WebSocket disconnected
   */
  reportPrimaryDisconnected(): void {
    console.log('[WebSocketFallbackManager] Primary WebSocket reported disconnected');
    this.primaryConnected = false;
    
    // Activate fallback immediately on disconnect
    this.activateFallback();
  }

  /**
   * Report primary WebSocket connected
   */
  reportPrimaryConnected(): void {
    console.log('[WebSocketFallbackManager] Primary WebSocket reported connected');
    this.lastPrimaryMessage = getActiveClock().now();
    this.primaryConnected = true;
    
    // Deactivate fallback when primary reconnects
    this.deactivateFallback();
  }

  /**
   * Get current status
   */
  getStatus(): FallbackManagerStatus {
    const fallbackStatus = multiProviderPriceFeed.getStatus();

    return {
      primaryConnected: this.primaryConnected,
      primaryProvider: 'Coinbase',
      fallbackActive: this.fallbackActive,
      fallbackProvider: this.fallbackActive ? fallbackStatus.activeProvider : null,
      lastPrimaryMessage: this.lastPrimaryMessage,
      lastFallbackMessage: this.lastFallbackMessage,
      symbols: this.symbols,
      totalPriceUpdates: this.totalPriceUpdates,
    };
  }

  /**
   * Check if any price feed is active
   */
  isConnected(): boolean {
    return this.primaryConnected || this.fallbackActive;
  }

  /**
   * Stop the fallback manager
   */
  stop(): void {
    console.log('[WebSocketFallbackManager] Stopping...');
    this.isRunning = false;

    if (this.primaryHealthCheckInterval) {
      clearInterval(this.primaryHealthCheckInterval);
      this.primaryHealthCheckInterval = null;
    }

    multiProviderPriceFeed.stop();

    this.fallbackActive = false;
    this.primaryConnected = false;

    console.log('[WebSocketFallbackManager] Stopped');
  }

  /**
   * Add a symbol to track
   */
  addSymbol(symbol: string): void {
    if (!this.symbols.includes(symbol)) {
      this.symbols.push(symbol);
      multiProviderPriceFeed.addSymbol(symbol);
    }
  }

  /**
   * Remove a symbol from tracking
   */
  removeSymbol(symbol: string): void {
    const index = this.symbols.indexOf(symbol);
    if (index > -1) {
      this.symbols.splice(index, 1);
      multiProviderPriceFeed.removeSymbol(symbol);
    }
  }
}

// Singleton instance
export const webSocketFallbackManager = new WebSocketFallbackManager();
