/**
 * CoinGecko Price Verifier — Cross-Validation of WebSocket Prices
 *
 * Polls CoinGecko's FREE public API every 30 seconds to verify that
 * the real-time WebSocket prices from Coinbase/Binance are accurate.
 *
 * This catches:
 * - Exchange API bugs returning wrong prices
 * - WebSocket data corruption
 * - Stale/frozen price feeds that look alive but aren't updating
 *
 * CoinGecko is NOT a primary price source — it's a verifier.
 * Ticks from CoinGecko are fed into PriceFabric for divergence detection
 * but are NOT forwarded to priceFeedService or persisted to DB.
 *
 * Cost: $0 (free public API, no key required)
 * Rate limit: 10-30 calls/minute (we use 2/minute = ~7% of limit)
 */

import { getPriceFabric } from './PriceFabric';

// CoinGecko symbol mapping: SEER canonical → CoinGecko ID
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  'BTC-USD': 'bitcoin',
  'ETH-USD': 'ethereum',
  'SOL-USD': 'solana',
  'XRP-USD': 'ripple',
  'ADA-USD': 'cardano',
  'DOGE-USD': 'dogecoin',
  'BNB-USD': 'binancecoin',
  'DOT-USD': 'polkadot',
  'LINK-USD': 'chainlink',
  'AVAX-USD': 'avalanche-2',
};

// Reverse mapping for response parsing
const COINGECKO_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, geckoId] of Object.entries(SYMBOL_TO_COINGECKO)) {
  COINGECKO_TO_SYMBOL[geckoId] = symbol;
}

const POLL_INTERVAL_MS = 30_000;  // Every 30 seconds
const API_URL = 'https://api.coingecko.com/api/v3/simple/price';

class CoinGeckoVerifierService {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  private totalPolls = 0;
  private totalErrors = 0;
  private lastPollTime = 0;

  /**
   * Start the CoinGecko verifier for the given symbols.
   */
  start(symbols: string[]): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.symbols = symbols;

    const geckoIds = symbols
      .map(s => SYMBOL_TO_COINGECKO[s])
      .filter(Boolean);

    if (geckoIds.length === 0) {
      console.warn('[CoinGeckoVerifier] No mappable symbols, verifier disabled');
      return;
    }

    console.log(`[CoinGeckoVerifier] 🔍 Starting price verification for: ${symbols.join(', ')}`);
    console.log(`[CoinGeckoVerifier] Polling every ${POLL_INTERVAL_MS / 1000}s`);

    // First poll after 10s (let WebSocket feeds warm up first)
    setTimeout(() => {
      this.poll().catch(() => {});
    }, 10_000);

    // Then poll on interval
    this.pollTimer = setInterval(() => {
      this.poll().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log(`[CoinGeckoVerifier] Stopped. Total polls: ${this.totalPolls}, errors: ${this.totalErrors}`);
  }

  private async poll(): Promise<void> {
    const geckoIds = this.symbols
      .map(s => SYMBOL_TO_COINGECKO[s])
      .filter(Boolean);

    if (geckoIds.length === 0) return;

    const url = `${API_URL}?ids=${geckoIds.join(',')}&vs_currencies=usd&precision=full`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000), // 10s timeout
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        this.totalErrors++;
        if (response.status === 429) {
          console.warn('[CoinGeckoVerifier] Rate limited — backing off');
        }
        return;
      }

      const data = await response.json() as Record<string, { usd: number }>;
      const now = Date.now();
      this.totalPolls++;
      this.lastPollTime = now;

      const fabric = getPriceFabric();

      for (const [geckoId, priceObj] of Object.entries(data)) {
        const symbol = COINGECKO_TO_SYMBOL[geckoId];
        if (!symbol || !priceObj?.usd) continue;

        fabric.ingestTick({
          symbol,
          price: priceObj.usd,
          volume: 0,
          timestampMs: now,
          receivedAtMs: now,
          source: 'coingecko',
        });
      }

      // Log periodically
      if (this.totalPolls % 10 === 0) {
        console.log(`[CoinGeckoVerifier] ✅ Poll #${this.totalPolls} — verified ${Object.keys(data).length} prices`);
      }
    } catch (err) {
      this.totalErrors++;
      // Non-critical — CoinGecko is just a verifier, not a primary feed
      if (this.totalErrors % 10 === 0) {
        console.warn(`[CoinGeckoVerifier] Poll error (${this.totalErrors} total):`, (err as Error).message);
      }
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      symbols: this.symbols,
      totalPolls: this.totalPolls,
      totalErrors: this.totalErrors,
      lastPollTime: this.lastPollTime,
    };
  }
}

// Singleton
let verifierInstance: CoinGeckoVerifierService | null = null;

export function getCoinGeckoVerifier(): CoinGeckoVerifierService {
  if (!verifierInstance) {
    verifierInstance = new CoinGeckoVerifierService();
  }
  return verifierInstance;
}

export { CoinGeckoVerifierService };
