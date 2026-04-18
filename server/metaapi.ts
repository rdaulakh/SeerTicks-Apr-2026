import { ENV } from "./_core/env";

export interface Candle {
  time: string; // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Fetch historical candle data from MetaAPI
 * @param symbol Currency pair (e.g., "EURUSD")
 * @param timeframe Timeframe (e.g., "1h", "4h", "1d")
 * @param startTime ISO timestamp for start
 * @param limit Number of candles to fetch
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string = "1h",
  limit: number = 100
): Promise<Candle[]> {
  const token = ENV.metaapiToken;
  
  if (!token) {
    throw new Error("MetaAPI token not configured");
  }

  // MetaAPI endpoint for historical market data
  // Using the market data API endpoint that doesn't require account ID
  const url = `https://mt-market-data-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "auth-token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MetaAPI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // Return the most recent candles up to the limit
  return (data as Candle[]).slice(-limit);
}
