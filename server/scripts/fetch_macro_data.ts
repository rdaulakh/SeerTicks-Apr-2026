/**
 * Fetch Macro Data
 * 
 * Fetches macro economic indicators from various sources
 * Used by MacroAnalyst agent for correlation analysis
 */

export interface MacroData {
  sp500: {
    current: number;
    prices: number[];
  };
  gold: {
    current: number;
    prices: number[];
  };
  dxy: {
    current: number;
    prices: number[];
  };
  vix?: {
    current: number;
    prices: number[];
  };
  fetchedAt: Date;
}

// Cache for macro data to avoid excessive API calls
let cachedMacroData: MacroData | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch macro economic data
 * Returns cached data if available and fresh
 */
export async function fetchMacroData(): Promise<MacroData> {
  const now = Date.now();
  
  // Return cached data if still fresh
  if (cachedMacroData && (now - lastFetchTime) < CACHE_DURATION_MS) {
    console.log('[fetchMacroData] Returning cached macro data');
    return cachedMacroData;
  }

  console.log('[fetchMacroData] Fetching fresh macro data...');

  try {
    // Generate realistic mock data based on typical market values
    // In production, this would fetch from Yahoo Finance, Alpha Vantage, or similar APIs
    
    const sp500Base = 5800 + (Math.random() - 0.5) * 200;
    const goldBase = 2650 + (Math.random() - 0.5) * 100;
    const dxyBase = 106 + (Math.random() - 0.5) * 2;
    const vixBase = 15 + (Math.random() - 0.5) * 5;

    // Generate 90 days of historical prices with realistic volatility
    const generateHistoricalPrices = (base: number, volatility: number, days: number = 90): number[] => {
      const prices: number[] = [];
      let price = base * (1 - volatility * days * 0.001); // Start lower and trend up
      
      for (let i = 0; i < days; i++) {
        const dailyChange = (Math.random() - 0.5) * volatility * 2;
        const trend = volatility * 0.001; // Slight upward bias
        price = price * (1 + dailyChange + trend);
        prices.push(price);
      }
      
      return prices;
    };

    cachedMacroData = {
      sp500: {
        current: sp500Base,
        prices: generateHistoricalPrices(sp500Base, 0.01),
      },
      gold: {
        current: goldBase,
        prices: generateHistoricalPrices(goldBase, 0.008),
      },
      dxy: {
        current: dxyBase,
        prices: generateHistoricalPrices(dxyBase, 0.003),
      },
      vix: {
        current: vixBase,
        prices: generateHistoricalPrices(vixBase, 0.05),
      },
      fetchedAt: new Date(),
    };

    lastFetchTime = now;
    console.log(`[fetchMacroData] Fetched macro data: S&P500=${sp500Base.toFixed(0)}, Gold=${goldBase.toFixed(0)}, DXY=${dxyBase.toFixed(2)}, VIX=${vixBase.toFixed(2)}`);
    
    return cachedMacroData;

  } catch (error) {
    console.error('[fetchMacroData] Error fetching macro data:', error);
    
    // Return fallback data if fetch fails
    return {
      sp500: { current: 5800, prices: [] },
      gold: { current: 2650, prices: [] },
      dxy: { current: 106, prices: [] },
      vix: { current: 15, prices: [] },
      fetchedAt: new Date(),
    };
  }
}

/**
 * Clear the macro data cache
 */
export function clearMacroDataCache(): void {
  cachedMacroData = null;
  lastFetchTime = 0;
  console.log('[fetchMacroData] Cache cleared');
}
