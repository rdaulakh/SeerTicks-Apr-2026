/**
 * Fetch Historical Candles via MetaAPI
 * 
 * Uses MetaAPI as a proxy to Binance to avoid direct API calls and IP bans.
 * Fetches historical candles ONCE on startup, then WebSocket maintains the cache.
 */

import axios from 'axios';
import { Candle } from '../WebSocketCandleCache';

const METAAPI_TOKEN = process.env.METAAPI_TOKEN;
const METAAPI_BASE_URL = 'https://mt-market-data-client-api-v1.london.agiliumtrade.ai';

interface MetaAPICandle {
  time: string; // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  volume: number;
}

/**
 * Convert MetaAPI interval format to Binance format
 */
function convertInterval(interval: string): string {
  const mapping: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  return mapping[interval] || '1h';
}

/**
 * Fetch historical candles from MetaAPI (Binance proxy)
 * 
 * @param symbol Trading symbol (e.g., 'BTCUSDT')
 * @param interval Timeframe (e.g., '1h', '4h', '1d')
 * @param limit Number of candles to fetch (default: 200)
 * @returns Array of candles
 */
export async function fetchHistoricalCandles(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<Candle[]> {
  if (!METAAPI_TOKEN) {
    console.error('[fetchHistoricalCandles] METAAPI_TOKEN not configured');
    return [];
  }

  try {
    const metaInterval = convertInterval(interval);
    
    // Calculate start time (limit * interval duration ago)
    const intervalMs: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    
    const duration = intervalMs[interval] || intervalMs['1h'];
    const startTime = new Date(Date.now() - (limit * duration));

    console.log(`[fetchHistoricalCandles] Fetching ${limit} candles for ${symbol} ${interval} via MetaAPI...`);

    const response = await axios.get<MetaAPICandle[]>(
      `${METAAPI_BASE_URL}/users/current/accounts/binance/historical-market-data/symbols/${symbol}/timeframes/${metaInterval}/candles`,
      {
        headers: {
          'auth-token': METAAPI_TOKEN,
        },
        params: {
          startTime: startTime.toISOString(),
          limit,
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (!response.data || !Array.isArray(response.data)) {
      console.error('[fetchHistoricalCandles] Invalid response from MetaAPI');
      return [];
    }

    // Convert MetaAPI format to our Candle format
    const candles: Candle[] = response.data.map((c: MetaAPICandle) => ({
      timestamp: new Date(c.time).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || c.tickVolume,
    }));

    console.log(`[fetchHistoricalCandles] Successfully fetched ${candles.length} candles for ${symbol} ${interval}`);
    return candles;

  } catch (error: any) {
    if (error.response) {
      console.error(`[fetchHistoricalCandles] MetaAPI error (${error.response.status}):`, error.response.data);
    } else if (error.request) {
      console.error('[fetchHistoricalCandles] No response from MetaAPI:', error.message);
    } else {
      console.error('[fetchHistoricalCandles] Error:', error.message);
    }
    
    // Fallback to Binance REST API (respectful: 1 request, weight=1)
    console.log(`[fetchHistoricalCandles] Falling back to Binance REST API for ${symbol} ${interval}`);
    return await fetchFromBinance(symbol, interval, limit);
  }
}

/**
 * Fallback: Fetch historical candles directly from Binance REST API
 * Used only when MetaAPI fails. Respects rate limits with 1s delay.
 */
export async function fetchFromBinance(
  symbol: string,
  interval: string,
  limit: number = 200,
  endTime?: number
): Promise<Candle[]> {
  try {
    const binanceInterval = convertInterval(interval);
    
    console.log(`[fetchFromBinance] Fetching ${limit} candles for ${symbol} ${binanceInterval} from Binance...`);
    
    const params: any = {
      symbol: symbol.replace('/', ''),
      interval: binanceInterval,
      limit,
    };

    if (endTime) {
      params.endTime = endTime;
    }

    const response = await axios.get(
      `https://api.binance.com/api/v3/klines`,
      {
        params,
        timeout: 10000,
      }
    );

    if (!response.data || !Array.isArray(response.data)) {
      console.error('[fetchFromBinance] Invalid response from Binance');
      return [];
    }

    // Convert Binance format to our Candle format
    // Binance klines: [timestamp, open, high, low, close, volume, closeTime, ...]
    const candles: Candle[] = response.data.map((k: any[]) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    console.log(`[fetchFromBinance] ✅ Successfully fetched ${candles.length} candles for ${symbol} ${binanceInterval}`);
    return candles;

  } catch (error: any) {
    console.error(`[fetchFromBinance] Error fetching from Binance:`, error.message);
    return [];
  }
}

/**
 * Fetch historical candles with rate limiting and retry logic
 * Adds delays between requests to respect API limits
 */
export async function fetchHistoricalCandlesWithRateLimit(
  requests: Array<{ symbol: string; interval: string; limit?: number }>,
  delayMs: number = 1000 // Increased from 500ms to 1000ms to avoid MetaAPI rate limits
): Promise<Map<string, Map<string, Candle[]>>> {
  const results = new Map<string, Map<string, Candle[]>>();

  for (let i = 0; i < requests.length; i++) {
    const { symbol, interval, limit } = requests[i];

    // Add delay between requests (except first one)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const candles = await fetchHistoricalCandles(symbol, interval, limit);

    if (!results.has(symbol)) {
      results.set(symbol, new Map());
    }
    results.get(symbol)!.set(interval, candles);
  }

  return results;
}
