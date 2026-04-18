/**
 * BinanceRestFallback - FREE Price Feed Fallback Service
 * 
 * INFRASTRUCTURE FIX (Feb 6, 2026):
 * Replaces broken CoinCap WebSocket ($65-150/month, 100% dead) and
 * CoinAPI WebSocket ($79-499/month, 100% dead) with FREE Binance REST polling.
 * 
 * Architecture:
 * - PRIMARY: Coinbase WebSocket (FREE, real-time, ~50ms latency)
 * - FALLBACK: Binance REST API (FREE, polling, ~10s latency)
 * 
 * This service:
 * 1. Monitors Coinbase WebSocket health via priceFeedService
 * 2. Activates Binance REST polling when Coinbase goes stale (>15s no data)
 * 3. Deactivates when Coinbase recovers
 * 4. Reports health to wsHealthMonitor
 * 
 * Cost: $0 (Binance public REST API, no API key required)
 * Rate limit: 1200 requests/minute (we use ~18/minute = 1.5% of limit)
 */

import EventEmitter from 'eventemitter3';
import { priceFeedService } from './priceFeedService';
import { wsHealthMonitor } from '../monitoring/WebSocketHealthMonitor';

// Symbol mapping: SEER format -> Binance format
const SYMBOL_MAP: Record<string, string> = {
  'BTC-USD': 'BTCUSDT',
  'ETH-USD': 'ETHUSDT',
  'SOL-USD': 'SOLUSDT',
  'LINK-USD': 'LINKUSDT',
  'AVAX-USD': 'AVAXUSDT',
  'DOGE-USD': 'DOGEUSDT',
  'ADA-USD': 'ADAUSDT',
  'DOT-USD': 'DOTUSDT',
  'MATIC-USD': 'MATICUSDT',
  'UNI-USD': 'UNIUSDT',
};

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';
const POLL_INTERVAL_MS = 10_000; // 10 seconds when active
const HEALTH_CHECK_INTERVAL_MS = 5_000; // Check Coinbase health every 5s
const STALE_THRESHOLD_MS = 15_000; // Activate fallback if no Coinbase data for 15s

interface FallbackStatus {
  isActive: boolean;
  isRunning: boolean;
  lastPollTime: number | null;
  lastCoinbaseMessageTime: number | null;
  totalPolls: number;
  totalErrors: number;
  symbols: string[];
  activatedAt: number | null;
  deactivatedAt: number | null;
}

class BinanceRestFallbackService extends EventEmitter {
  private symbols: string[] = [];
  private isRunning = false;
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastPollTime: number | null = null;
  private lastCoinbaseMessageTime: number | null = null;
  private totalPolls = 0;
  private totalErrors = 0;
  private activatedAt: number | null = null;
  private deactivatedAt: number | null = null;

  /**
   * Start the fallback service in standby mode.
   * It monitors Coinbase health and activates polling only when needed.
   */
  async start(symbols: string[]): Promise<void> {
    if (this.isRunning) {
      console.log('[BinanceRestFallback] Already running');
      return;
    }

    this.symbols = symbols;
    this.isRunning = true;

    console.log(`[BinanceRestFallback] Starting in standby mode for: ${symbols.join(', ')}`);

    // Listen for Coinbase price updates to track health
    priceFeedService.on('price_update', (priceData: any) => {
      if (priceData.source === 'websocket' || priceData.source === 'coinbase') {
        this.lastCoinbaseMessageTime = Date.now();

        // If fallback is active and Coinbase recovered, deactivate
        if (this.isActive) {
          this.deactivate();
        }
      }
    });

    // Start health check loop
    this.healthCheckInterval = setInterval(() => {
      this.checkCoinbaseHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    if (this.healthCheckInterval.unref) {
      this.healthCheckInterval.unref();
    }

    console.log('[BinanceRestFallback] Started successfully (standby mode)');
  }

  /**
   * Check if Coinbase WebSocket is healthy.
   * Activate fallback if stale.
   */
  // Phase 15D: Track startup time for grace period calculation
  private startedAt: number = Date.now();

  private checkCoinbaseHealth(): void {
    if (!this.isRunning) return;

    const now = Date.now();

    // Phase 15D FIX: Don't return early when lastCoinbaseMessageTime is null.
    // Previously this was a permanent early return — Binance fallback NEVER activated on startup.
    // Now: give Coinbase a 10s grace period, then activate Binance if no data received.
    if (!this.lastCoinbaseMessageTime) {
      const timeSinceStart = now - this.startedAt;
      if (timeSinceStart > 10_000 && !this.isActive) {
        console.warn(`[BinanceRestFallback] No Coinbase data received after ${Math.round(timeSinceStart / 1000)}s startup — activating Binance fallback`);
        this.activate();
      }
      return;
    }

    const timeSinceLastCoinbase = now - this.lastCoinbaseMessageTime;

    if (timeSinceLastCoinbase > STALE_THRESHOLD_MS && !this.isActive) {
      console.warn(`[BinanceRestFallback] Coinbase stale for ${Math.round(timeSinceLastCoinbase / 1000)}s, activating fallback`);
      this.activate();
    }
  }

  /**
   * Activate Binance REST polling (Coinbase is down).
   */
  activate(): void {
    if (this.isActive) return;

    console.log('[BinanceRestFallback] 🔄 ACTIVATING Binance REST fallback');
    this.isActive = true;
    this.activatedAt = Date.now();

    try { wsHealthMonitor.updateStatus('BinanceREST', 'connected'); } catch (e) { /* non-critical */ }

    // Start polling
    this.pollInterval = setInterval(() => {
      this.pollPrices();
    }, POLL_INTERVAL_MS);

    // Do an immediate poll
    this.pollPrices();

    this.emit('activated', { timestamp: Date.now() });
  }

  /**
   * Deactivate Binance REST polling (Coinbase recovered).
   */
  deactivate(): void {
    if (!this.isActive) return;

    console.log('[BinanceRestFallback] ✅ DEACTIVATING fallback, Coinbase recovered');
    this.isActive = false;
    this.deactivatedAt = Date.now();

    try { wsHealthMonitor.updateStatus('BinanceREST', 'standby'); } catch (e) { /* non-critical */ }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.emit('deactivated', { timestamp: Date.now() });
  }

  /**
   * Poll Binance REST API for current prices.
   * Uses the public ticker endpoint (no API key needed).
   */
  private async pollPrices(): Promise<void> {
    if (!this.isActive) return;

    const binanceSymbols = this.symbols
      .map(s => SYMBOL_MAP[s])
      .filter(Boolean);

    if (binanceSymbols.length === 0) return;

    try {
      // Use the batch ticker endpoint for efficiency (1 request for all symbols)
      const symbolsParam = JSON.stringify(binanceSymbols);
      const url = `${BINANCE_API_BASE}/ticker/price?symbols=${encodeURIComponent(symbolsParam)}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }

      const data = await response.json() as Array<{ symbol: string; price: string }>;

      this.lastPollTime = Date.now();
      this.totalPolls++;

      try { wsHealthMonitor.recordMessage('BinanceREST'); } catch (e) { /* non-critical */ }

      // Convert Binance format back to SEER format and feed into priceFeedService
      const reverseMap = Object.fromEntries(
        Object.entries(SYMBOL_MAP).map(([k, v]) => [v, k])
      );

      for (const ticker of data) {
        const seerSymbol = reverseMap[ticker.symbol];
        if (seerSymbol) {
          const price = parseFloat(ticker.price);
          if (price > 0) {
            priceFeedService.updatePrice(seerSymbol, price, 'rest', {
              volume24h: 0,
            });
          }
        }
      }

      this.emit('poll_complete', { count: data.length, timestamp: Date.now() });
    } catch (error: any) {
      this.totalErrors++;
      // Don't spam logs - only log every 6th error (once per minute at 10s intervals)
      if (this.totalErrors % 6 === 1) {
        console.error(`[BinanceRestFallback] Poll error (${this.totalErrors} total):`, error.message);
      }
      try { wsHealthMonitor.updateStatus('BinanceREST', 'error'); } catch (e) { /* non-critical */ }
    }
  }

  /**
   * Get current status for health dashboard.
   */
  getStatus(): FallbackStatus {
    return {
      isActive: this.isActive,
      isRunning: this.isRunning,
      lastPollTime: this.lastPollTime,
      lastCoinbaseMessageTime: this.lastCoinbaseMessageTime,
      totalPolls: this.totalPolls,
      totalErrors: this.totalErrors,
      symbols: this.symbols,
      activatedAt: this.activatedAt,
      deactivatedAt: this.deactivatedAt,
    };
  }

  /**
   * Stop the fallback service entirely.
   */
  stop(): void {
    console.log('[BinanceRestFallback] Stopping...');
    this.isRunning = false;
    this.isActive = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    console.log('[BinanceRestFallback] Stopped');
  }
}

// Singleton instance
export const binanceRestFallback = new BinanceRestFallbackService();
