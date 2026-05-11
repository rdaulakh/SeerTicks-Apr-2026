/**
 * Multi-Provider Price Feed with Automatic Fallback
 * 
 * Provides reliable real-time cryptocurrency price data by managing multiple
 * WebSocket providers with automatic failover and reconnection logic.
 * 
 * Provider Priority:
 * 1. Coinbase (Primary) - Direct exchange data, requires auth
 * 2. CoinCap (Fallback #1) - Simple, no auth required
 * (Kraken removed - user doesn't have account)
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Health monitoring with heartbeat detection
 * - Automatic failover to backup providers
 * - Price normalization across providers
 * - Connection status tracking
 */

import WebSocket from 'ws';
import { getActiveClock } from '../_core/clock';
import EventEmitter from 'eventemitter3';
import { priceFeedService } from './priceFeedService';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  provider: string;
  volume24h?: number;
}

export interface ProviderStatus {
  name: string;
  connected: boolean;
  lastMessage: number | null;
  reconnectAttempts: number;
  error?: string;
}

interface ProviderConfig {
  name: string;
  url: string;
  priority: number;
  requiresAuth: boolean;
  symbolMapping: Map<string, string>;
  reverseSymbolMapping: Map<string, string>;
}

export class MultiProviderPriceFeed extends EventEmitter {
  private providers: Map<string, ProviderConfig> = new Map();
  private connections: Map<string, WebSocket | null> = new Map();
  private providerStatus: Map<string, ProviderStatus> = new Map();
  private activeProvider: string | null = null;
  private symbols: string[] = [];
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private healthCheckIntervalMs = 10000; // 10 seconds
  private staleThresholdMs = 30000; // 30 seconds without message = stale
  private isShuttingDown = false;

  constructor() {
    super();
    this.initializeProviders();
  }

  /**
   * Initialize provider configurations
   * 
   * Note: This is a FALLBACK price feed. The primary price feed is Coinbase WebSocket.
   * CoinCap WebSocket v3 requires Growth tier ($65/mo) or higher.
   */
  private initializeProviders(): void {
    console.log('[MultiProviderPriceFeed] Note: This is a fallback feed. Primary is Coinbase WebSocket.');

    // CoinCap v3 WebSocket - requires Growth tier or higher
    // Endpoint: wss://wss.coincap.io/prices?assets=bitcoin,ethereum&apiKey=XXX
    const coincapSymbolMap = new Map<string, string>([
      ['BTC-USD', 'bitcoin'],
      ['ETH-USD', 'ethereum'],
      ['SOL-USD', 'solana'],
      ['DOGE-USD', 'dogecoin'],
      ['XRP-USD', 'ripple'],
      ['ADA-USD', 'cardano'],
      ['AVAX-USD', 'avalanche-2'],
      ['DOT-USD', 'polkadot'],
      ['MATIC-USD', 'matic-network'],
      ['LINK-USD', 'chainlink'],
    ]);

    const coincapReverseMap = new Map<string, string>();
    coincapSymbolMap.forEach((v, k) => coincapReverseMap.set(v, k));

    // Only add CoinCap if API key is configured (indicates paid tier)
    if (process.env.COINCAP_API_KEY) {
      this.providers.set('coincap', {
        name: 'CoinCap',
        url: 'wss://wss.coincap.io/prices', // v3 WebSocket endpoint
        priority: 1,
        requiresAuth: true,
        symbolMapping: coincapSymbolMap,
        reverseSymbolMapping: coincapReverseMap,
      });
      console.log('[MultiProviderPriceFeed] CoinCap v3 WebSocket enabled (paid tier detected)');
    } else {
      console.log('[MultiProviderPriceFeed] CoinCap WebSocket skipped - no API key (requires Growth tier $65/mo)');
    }

    // Kraken REMOVED - user doesn't have Kraken account
    // Only CoinCap is used as fallback (CoinAPI is primary)

    // Initialize status for each provider
    this.providers.forEach((config, name) => {
      this.providerStatus.set(name, {
        name: config.name,
        connected: false,
        lastMessage: null,
        reconnectAttempts: 0,
      });
      this.connections.set(name, null);
    });
  }

  /**
   * Start the multi-provider price feed
   * Note: This is a fallback feed. Primary is CoinAPI WebSocket.
   */
  async start(symbols: string[]): Promise<void> {
    this.symbols = symbols;
    this.isShuttingDown = false;
    
    console.log(`[MultiProviderPriceFeed] Starting fallback feed with symbols: ${symbols.join(', ')}`);

    // Start health check interval
    this.startHealthCheck();

    // Connect to CoinCap (only fallback provider)
    // Primary is CoinAPI WebSocket, this is just a backup
    if (this.providers.has('coincap')) {
      await this.connectToProvider('coincap');
    } else {
      console.log('[MultiProviderPriceFeed] No fallback providers available - CoinAPI WebSocket is primary');
    }
  }

  /**
   * Connect to a specific provider
   */
  private async connectToProvider(providerName: string): Promise<boolean> {
    const config = this.providers.get(providerName);
    if (!config) {
      console.error(`[MultiProviderPriceFeed] Unknown provider: ${providerName}`);
      return false;
    }

    const status = this.providerStatus.get(providerName)!;
    
    // Clear any existing reconnect timer
    const existingTimer = this.reconnectTimers.get(providerName);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(providerName);
    }

    // Close existing connection if any
    const existingWs = this.connections.get(providerName);
    if (existingWs) {
      existingWs.terminate();
    }

    try {
      // Suppress CoinCap connection logs - known service unavailability
      if (providerName !== 'coincap') {
        console.log(`[MultiProviderPriceFeed] Connecting to ${config.name}...`);
      }

      let ws: WebSocket;
      
      if (providerName === 'coincap') {
        // CoinCap v3 WebSocket uses query parameters for symbols and API key
        // Note: CoinCap WebSocket is currently unavailable (503) - user contacting support
        const coincapSymbols = this.symbols
          .map(s => config.symbolMapping.get(s))
          .filter(Boolean)
          .join(',');
        const apiKey = process.env.COINCAP_API_KEY;
        const wsUrl = `${config.url}?assets=${coincapSymbols}&apiKey=${apiKey}`;
        // Silently attempt connection - don't log URL
        ws = new WebSocket(wsUrl);
      } else {
        ws = new WebSocket(config.url);
      }

      return new Promise((resolve) => {
        const connectionTimeout = setTimeout(() => {
          // Suppress CoinCap timeout errors - known service unavailability
          if (providerName !== 'coincap') {
            console.error(`[MultiProviderPriceFeed] Connection timeout for ${config.name}`);
          }
          ws.terminate();
          resolve(false);
        }, 10000);

        ws.on('open', () => {
          clearTimeout(connectionTimeout);
          console.log(`[MultiProviderPriceFeed] ✅ Connected to ${config.name}`);
          
          status.connected = true;
          status.reconnectAttempts = 0;
          status.lastMessage = getActiveClock().now();
          status.error = undefined;
          
          this.connections.set(providerName, ws);
          this.activeProvider = providerName;

          // No additional subscription needed for CoinCap (symbols in URL)

          this.emit('connected', { provider: config.name });
          resolve(true);
        });

        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(providerName, data);
        });

        ws.on('error', (error: Error) => {
          clearTimeout(connectionTimeout);
          // Completely suppress ALL CoinCap connection errors - known regional/service issue
          // User is contacting CoinCap team about WebSocket availability
          const isCoinCapError = providerName === 'coincap' && (
            error.message.includes('503') || 
            error.message.includes('502') ||
            error.message.includes('Unexpected server response') ||
            error.message.includes('WebSocket was closed before') ||
            error.message.includes('TLS connection') ||
            error.message.includes('network socket disconnected')
          );
          
          if (isCoinCapError) {
            // Silent handling - CoinCap WebSocket is known to be unavailable
            // Don't spam logs or emit errors for expected failures
            status.error = 'CoinCap WebSocket unavailable (regional/service issue)';
            // CRITICAL: Resolve the Promise so server startup doesn't hang!
            resolve(false);
          } else if (!status.error || status.error !== error.message) {
            console.error(`[MultiProviderPriceFeed] Error from ${config.name}:`, error.message);
            status.error = error.message;
            this.emit('error', { provider: config.name, error });
            // Resolve the Promise on error to prevent hanging
            resolve(false);
          }
        });

        ws.on('close', (code: number, reason: Buffer) => {
          clearTimeout(connectionTimeout);
          // Suppress CoinCap disconnect logs - known service unavailability
          if (providerName !== 'coincap') {
            console.log(`[MultiProviderPriceFeed] ${config.name} disconnected: ${code} - ${reason.toString()}`);
          }
          
          status.connected = false;
          this.connections.set(providerName, null);

          if (!this.isShuttingDown) {
            this.handleDisconnection(providerName);
          }
          
          this.emit('disconnected', { provider: config.name, code, reason: reason.toString() });
        });
      });
    } catch (error) {
      console.error(`[MultiProviderPriceFeed] Failed to connect to ${config.name}:`, error);
      status.error = error instanceof Error ? error.message : 'Unknown error';
      return false;
    }
  }

  // Kraken methods removed - user doesn't have Kraken account

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(providerName: string, data: WebSocket.Data): void {
    const status = this.providerStatus.get(providerName)!;
    status.lastMessage = getActiveClock().now();

    try {
      const message = JSON.parse(data.toString());

      if (providerName === 'coincap') {
        this.handleCoinCapMessage(message);
      }
    } catch (error) {
      console.error(`[MultiProviderPriceFeed] Error parsing message from ${providerName}:`, error);
    }
  }

  /**
   * Handle CoinCap v3 price messages
   * Format: { "bitcoin": "95696.45", "ethereum": "3313.22" }
   */
  private handleCoinCapMessage(message: Record<string, string>): void {
    const config = this.providers.get('coincap');
    if (!config) return;
    
    const timestamp = getActiveClock().now();

    for (const [coinCapSymbol, priceStr] of Object.entries(message)) {
      const normalizedSymbol = config.reverseSymbolMapping.get(coinCapSymbol);
      if (normalizedSymbol) {
        const price = parseFloat(priceStr);
        if (!isNaN(price)) {
          this.emitPriceUpdate({
            symbol: normalizedSymbol,
            price,
            timestamp,
            provider: 'CoinCap',
          });
        }
      }
    }
  }

  // handleKrakenMessage removed - user doesn't have Kraken account

  /**
   * Emit price update and update price feed service
   */
  private emitPriceUpdate(update: PriceUpdate): void {
    // Update the central price feed service
    priceFeedService.updatePrice(update.symbol, update.price, 'websocket', {
      volume24h: update.volume24h,
    });

    // Emit for any direct subscribers
    this.emit('price', update);
  }

  /**
   * Handle provider disconnection with failover logic
   */
  private handleDisconnection(providerName: string): void {
    const status = this.providerStatus.get(providerName)!;
    
    // If this was the active provider, try to failover
    if (this.activeProvider === providerName) {
      // Suppress CoinCap disconnect logs - known service unavailability
      if (providerName !== 'coincap') {
        console.log(`[MultiProviderPriceFeed] Active provider ${providerName} disconnected, attempting failover...`);
      }
      this.attemptFailover(providerName);
    }

    // Schedule reconnection with exponential backoff (but silently for CoinCap)
    this.scheduleReconnect(providerName);
  }

  // Track last failover attempt log time to reduce spam
  private lastFailoverLogTime: Map<string, number> = new Map();
  private static readonly FAILOVER_LOG_INTERVAL = 60000; // Log failover attempts at most once per minute

  /**
   * Attempt to failover to another provider
   */
  private async attemptFailover(failedProvider: string): Promise<void> {
    // Get providers sorted by priority
    const sortedProviders = Array.from(this.providers.entries())
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [name, config] of sortedProviders) {
      if (name === failedProvider) continue;

      const status = this.providerStatus.get(name)!;
      if (status.connected) {
        // Suppress CoinCap failover logs - known service unavailability
        if (name !== 'coincap') {
          console.log(`[MultiProviderPriceFeed] Failing over to ${config.name}`);
        }
        this.activeProvider = name;
        return;
      }

      // Rate-limit failover attempt logging to reduce spam
      // Completely skip logging for CoinCap - known service unavailability
      if (name !== 'coincap') {
        const now = getActiveClock().now();
        const lastLog = this.lastFailoverLogTime.get(name) || 0;
        const shouldLog = now - lastLog > MultiProviderPriceFeed.FAILOVER_LOG_INTERVAL;
        
        if (shouldLog) {
          console.log(`[MultiProviderPriceFeed] Attempting to connect to ${config.name} for failover...`);
          this.lastFailoverLogTime.set(name, now);
        }
      }
      
      const success = await this.connectToProvider(name);
      if (success) {
        console.log(`[MultiProviderPriceFeed] ✅ Failover to ${config.name} successful`);
        return;
      }
    }

    // Only log all providers failed if we have non-CoinCap providers
    const hasNonCoinCapProviders = sortedProviders.some(([name]) => name !== 'coincap');
    if (hasNonCoinCapProviders) {
      console.error('[MultiProviderPriceFeed] ❌ All providers failed, no active price feed');
    }
    this.activeProvider = null;
    this.emit('allProvidersFailed');
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(providerName: string): void {
    const status = this.providerStatus.get(providerName)!;
    
    if (status.reconnectAttempts >= this.maxReconnectAttempts) {
      // Suppress CoinCap max reconnect log - known service unavailability
      if (providerName !== 'coincap') {
        console.log(`[MultiProviderPriceFeed] Max reconnect attempts reached for ${providerName}`);
      }
      return;
    }

    status.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, status.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    // Suppress CoinCap reconnect scheduling logs - known service unavailability
    if (providerName !== 'coincap') {
      console.log(`[MultiProviderPriceFeed] Scheduling reconnect for ${providerName} in ${delay}ms (attempt ${status.reconnectAttempts}/${this.maxReconnectAttempts})`);
    }

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(providerName);
      if (!this.isShuttingDown) {
        await this.connectToProvider(providerName);
      }
    }, delay);

    this.reconnectTimers.set(providerName, timer);
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.checkProviderHealth();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Check health of all providers
   */
  private checkProviderHealth(): void {
    const now = getActiveClock().now();

    this.providerStatus.forEach((status, name) => {
      if (status.connected && status.lastMessage) {
        const timeSinceLastMessage = now - status.lastMessage;
        
        if (timeSinceLastMessage > this.staleThresholdMs) {
          console.warn(`[MultiProviderPriceFeed] ${name} appears stale (${timeSinceLastMessage}ms since last message)`);
          
          // Force reconnection
          const ws = this.connections.get(name);
          if (ws) {
            ws.terminate();
          }
        }
      }
    });

    // If no active provider, try to connect to any available
    if (!this.activeProvider) {
      this.attemptFailover('none');
    }
  }

  /**
   * Get status of all providers
   */
  getStatus(): { providers: ProviderStatus[]; activeProvider: string | null } {
    return {
      providers: Array.from(this.providerStatus.values()),
      activeProvider: this.activeProvider,
    };
  }

  /**
   * Get the currently active provider name
   */
  getActiveProvider(): string | null {
    return this.activeProvider;
  }

  /**
   * Check if any provider is connected
   */
  isConnected(): boolean {
    return this.activeProvider !== null;
  }

  /**
   * Stop the multi-provider price feed
   */
  stop(): void {
    console.log('[MultiProviderPriceFeed] Stopping...');
    this.isShuttingDown = true;

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Clear all reconnect timers
    this.reconnectTimers.forEach((timer) => clearTimeout(timer));
    this.reconnectTimers.clear();

    // Close all connections
    this.connections.forEach((ws, name) => {
      if (ws) {
        ws.terminate();
        this.connections.set(name, null);
      }
      const status = this.providerStatus.get(name)!;
      status.connected = false;
    });

    this.activeProvider = null;
    console.log('[MultiProviderPriceFeed] Stopped');
  }

  /**
   * Force reconnect to a specific provider
   */
  async forceReconnect(providerName: string): Promise<boolean> {
    const status = this.providerStatus.get(providerName);
    if (!status) return false;

    status.reconnectAttempts = 0;
    return this.connectToProvider(providerName);
  }

  /**
   * Add a new symbol to track
   */
  addSymbol(symbol: string): void {
    if (!this.symbols.includes(symbol)) {
      this.symbols.push(symbol);
      
      // Reconnect to update subscriptions
      if (this.activeProvider) {
        this.connectToProvider(this.activeProvider);
      }
    }
  }

  /**
   * Remove a symbol from tracking
   */
  removeSymbol(symbol: string): void {
    const index = this.symbols.indexOf(symbol);
    if (index > -1) {
      this.symbols.splice(index, 1);
    }
  }
}

// Singleton instance
export const multiProviderPriceFeed = new MultiProviderPriceFeed();
