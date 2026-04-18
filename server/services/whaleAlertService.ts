import { ENV } from "../_core/env";
import { rateLimitedFetch, retryWithBackoff, RateLimitError } from "./ExternalAPIRateLimiter";

/**
 * Whale Alert API Service
 * Fetches large cryptocurrency transactions from Whale Alert API
 * API Documentation: https://docs.whale-alert.io/
 * 
 * Rate Limits:
 * - Free tier: 10 requests/minute
 * - Using conservative limit of 5 req/min with exponential backoff
 */

const WHALE_ALERT_BASE_URL = "https://api.whale-alert.io/v1";
const API_NAME = "whaleAlert";

// Cache for whale alerts to reduce API calls
const alertCache: Map<string, { data: WhaleAlertResponse; timestamp: number }> = new Map();
const CACHE_TTL = 300000; // 5 minutes cache

export interface WhaleTransaction {
  id: string;
  blockchain: string;
  symbol: string;
  transaction_type: "transfer" | "mint" | "burn" | "lock" | "unlock";
  hash: string;
  timestamp: number;
  amount: number;
  amount_usd: number;
  from: {
    address: string;
    owner: string;
    owner_type: string;
  };
  to: {
    address: string;
    owner: string;
    owner_type: string;
  };
}

export interface WhaleAlertResponse {
  result: string;
  cursor?: string;
  count: number;
  transactions: WhaleTransaction[];
}

export interface WhaleAlertFilters {
  minValue?: number; // Minimum USD value
  blockchain?: string; // bitcoin, ethereum, tron, etc.
  symbol?: string; // BTC, ETH, USDT, etc.
  startTime?: number; // Unix timestamp
  endTime?: number; // Unix timestamp
  cursor?: string; // For pagination
  limit?: number; // Max 100
}

/**
 * Generate cache key from filters
 */
function getCacheKey(filters: WhaleAlertFilters): string {
  return `${filters.symbol || 'all'}_${filters.minValue || 500000}_${filters.blockchain || 'all'}`;
}

/**
 * Fetch recent whale transactions from Whale Alert API
 * Uses rate limiting and caching to prevent 429 errors
 */
export async function fetchWhaleAlerts(
  filters: WhaleAlertFilters = {}
): Promise<WhaleAlertResponse> {
  const apiKey = ENV.whaleAlertApiKey;
  
  if (!apiKey) {
    console.warn("[WhaleAlertService] API key not configured, returning empty response");
    return { result: "error", count: 0, transactions: [] };
  }

  // Check cache first
  const cacheKey = getCacheKey(filters);
  const cached = alertCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[WhaleAlertService] Returning cached data for ${cacheKey}`);
    return cached.data;
  }

  // Build query parameters
  const params = new URLSearchParams();
  params.append("api_key", apiKey);
  
  // Default to last hour if no time range specified
  const now = Math.floor(Date.now() / 1000);
  const startTime = filters.startTime || now - 3600; // 1 hour ago
  params.append("start", startTime.toString());
  
  if (filters.endTime) {
    params.append("end", filters.endTime.toString());
  }
  
  // Minimum value filter (default 500k USD for significant transactions)
  const minValue = filters.minValue || 500000;
  params.append("min_value", minValue.toString());
  
  // Blockchain filter
  if (filters.blockchain) {
    params.append("blockchain", filters.blockchain);
  }
  
  // Symbol filter
  if (filters.symbol) {
    params.append("currency", filters.symbol.toLowerCase());
  }
  
  // Pagination
  if (filters.cursor) {
    params.append("cursor", filters.cursor);
  }
  
  // Limit (max 100)
  const limit = Math.min(filters.limit || 100, 100);
  params.append("limit", limit.toString());

  const url = `${WHALE_ALERT_BASE_URL}/transactions?${params.toString()}`;
  
  try {
    // Use retry with backoff for resilience
    const data = await retryWithBackoff(API_NAME, async () => {
      const response = await rateLimitedFetch(API_NAME, url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whale Alert API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    }, 1);

    const result = data as WhaleAlertResponse;
    
    // Cache successful response
    alertCache.set(cacheKey, { data: result, timestamp: Date.now() });
    console.log(`[WhaleAlertService] Fetched ${result.count} transactions, cached for ${CACHE_TTL / 1000}s`);
    
    return result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      console.warn(`[WhaleAlertService] Rate limited, returning cached/empty data`);
      // Return cached data if available, even if stale
      const staleCache = alertCache.get(cacheKey);
      if (staleCache) {
        console.log(`[WhaleAlertService] Returning stale cached data`);
        return staleCache.data;
      }
    }
    console.error("[WhaleAlertService] Error fetching alerts:", error);
    return { result: "error", count: 0, transactions: [] };
  }
}

/**
 * Get status of Whale Alert API
 */
export async function getWhaleAlertStatus(): Promise<{
  connected: boolean;
  message: string;
}> {
  const apiKey = ENV.whaleAlertApiKey;
  
  if (!apiKey) {
    return {
      connected: false,
      message: "API key not configured",
    };
  }

  try {
    // Use a minimal request to check API status
    const params = new URLSearchParams();
    params.append("api_key", apiKey);
    params.append("start", (Math.floor(Date.now() / 1000) - 60).toString());
    params.append("min_value", "100000000"); // Very high to get minimal results
    params.append("limit", "1");

    const response = await rateLimitedFetch(
      API_NAME,
      `${WHALE_ALERT_BASE_URL}/transactions?${params.toString()}`
    );

    if (response.ok) {
      return {
        connected: true,
        message: "Connected to Whale Alert API",
      };
    } else {
      return {
        connected: false,
        message: `API returned status ${response.status}`,
      };
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        connected: true, // API is working, just rate limited
        message: `Rate limited, will retry in ${Math.ceil(error.waitMs / 1000)}s`,
      };
    }
    return {
      connected: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Supported blockchains by Whale Alert
 */
export const SUPPORTED_BLOCKCHAINS = [
  "bitcoin",
  "ethereum",
  "tron",
  "ripple",
  "binancechain",
  "solana",
  "polygon",
  "avalanche",
  "arbitrum",
  "optimism",
] as const;

/**
 * Format whale transaction for display
 */
export function formatWhaleTransaction(tx: WhaleTransaction): {
  id: string;
  blockchain: string;
  symbol: string;
  type: string;
  amount: string;
  amountUsd: string;
  from: string;
  to: string;
  fromOwner: string;
  toOwner: string;
  timestamp: Date;
  hash: string;
} {
  return {
    id: tx.id,
    blockchain: tx.blockchain,
    symbol: tx.symbol.toUpperCase(),
    type: tx.transaction_type,
    amount: formatAmount(tx.amount),
    amountUsd: formatUsd(tx.amount_usd),
    from: truncateAddress(tx.from.address),
    to: truncateAddress(tx.to.address),
    fromOwner: tx.from.owner || "unknown",
    toOwner: tx.to.owner || "unknown",
    timestamp: new Date(tx.timestamp * 1000),
    hash: tx.hash,
  };
}

function formatAmount(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K`;
  }
  return amount.toFixed(4);
}

function formatUsd(amount: number): string {
  if (amount >= 1000000000) {
    return `$${(amount / 1000000000).toFixed(2)}B`;
  } else if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(2)}M`;
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(2)}K`;
  }
  return `$${amount.toFixed(2)}`;
}

function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address || "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Clear cache (for testing)
 */
export function clearWhaleAlertCache(): void {
  alertCache.clear();
}
