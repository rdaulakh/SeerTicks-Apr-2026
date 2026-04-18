/**
 * Symbol Normalization Utility
 * 
 * Handles conversion between different exchange symbol formats:
 * - Coinbase: BTC-USD, ETH-USD (with hyphen)
 * - Binance: BTCUSDT, ETHUSDT (no separator)
 * - Generic: BTC/USD, ETH/USD (with slash)
 */

/**
 * Convert Coinbase format (BTC-USD) to Binance format (BTCUSDT)
 */
export function coinbaseToBinance(symbol: string): string {
  // BTC-USD → BTCUSDT
  return symbol.replace('-', '') + 'T';
}

/**
 * Convert Binance format (BTCUSDT) to Coinbase format (BTC-USD)
 */
export function binanceToCoinbase(symbol: string): string {
  // BTCUSDT → BTC-USD
  // Remove trailing T and add hyphen before USD
  const withoutT = symbol.replace(/T$/, '');
  const match = withoutT.match(/^(.+)(USD)$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return symbol;
}

/**
 * Normalize symbol to a standard format (remove separators, uppercase)
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.replace(/[-/]/g, '').toUpperCase();
}

/**
 * Get all possible symbol format variations
 * Used when querying database to find historical data regardless of format
 */
export function getSymbolVariations(symbol: string): string[] {
  const normalized = normalizeSymbol(symbol);
  const variations = new Set<string>();
  
  // Add original symbol
  variations.add(symbol);
  
  // Add normalized version
  variations.add(normalized);
  
  // Try common patterns
  // BTC-USD, BTC/USD, BTCUSD
  if (symbol.includes('-')) {
    const parts = symbol.split('-');
    variations.add(parts.join(''));
    variations.add(parts.join('/'));
    variations.add(parts.join('') + 'T'); // Binance format
  } else if (symbol.includes('/')) {
    const parts = symbol.split('/');
    variations.add(parts.join(''));
    variations.add(parts.join('-'));
    variations.add(parts.join('') + 'T'); // Binance format
  } else {
    // No separator - try adding them
    // BTCUSD → BTC-USD, BTC/USD
    // BTCUSDT → BTC-USDT, BTC/USDT
    const match = normalized.match(/^(.+?)(USDT?|EUR|GBP|JPY)$/);
    if (match) {
      const base = match[1];
      const quote = match[2];
      variations.add(`${base}-${quote}`);
      variations.add(`${base}/${quote}`);
      variations.add(`${base}${quote}`);
      
      // Handle USDT vs USD
      if (quote === 'USDT') {
        variations.add(`${base}-USD`);
        variations.add(`${base}/USD`);
        variations.add(`${base}USD`);
      } else if (quote === 'USD') {
        variations.add(`${base}-USDT`);
        variations.add(`${base}/USDT`);
        variations.add(`${base}USDT`);
      }
    }
  }
  
  return Array.from(variations);
}

/**
 * Convert symbol to database storage format (Binance format)
 */
export function toStorageFormat(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  
  // If it ends with USD (not USDT), add T
  if (normalized.endsWith('USD') && !normalized.endsWith('USDT')) {
    return normalized + 'T';
  }
  
  return normalized;
}

/**
 * Convert symbol from database format to exchange-specific format
 */
export function fromStorageFormat(symbol: string, exchange: 'binance' | 'coinbase'): string {
  if (exchange === 'coinbase') {
    return binanceToCoinbase(symbol);
  }
  return symbol; // Binance uses storage format directly
}
