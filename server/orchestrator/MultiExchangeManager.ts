import { ExchangeInterface } from "../exchanges";
import { ExchangeFactory } from "../exchanges";

/**
 * Exchange configuration for multi-exchange trading
 */
export interface ExchangeConfig {
  exchangeId: number;
  exchangeName: "binance" | "coinbase";
  apiKey: string;
  apiSecret: string;
  isActive: boolean;
  capitalAllocation: number; // Percentage of total capital (0-100)
}

/**
 * Symbol configuration for multi-symbol trading
 */
export interface SymbolConfig {
  symbol: string;
  capitalAllocation: number; // Percentage of exchange capital (0-100)
  isActive: boolean;
}

/**
 * Trading pair: combination of exchange and symbol
 */
export interface TradingPair {
  exchangeId: number;
  exchangeName: string;
  symbol: string;
  adapter: ExchangeInterface;
  allocatedCapital: number;
}

/**
 * Capital allocation strategy
 */
export type AllocationStrategy = "equal" | "market_cap" | "performance";

/**
 * MultiExchangeManager
 * Manages multiple exchange connections and distributes capital across symbols
 */
export class MultiExchangeManager {
  private adapters: Map<number, ExchangeInterface> = new Map();;
  private tradingPairs: TradingPair[] = [];
  private totalCapital: number = 0;
  private allocationStrategy: AllocationStrategy = "equal";

  constructor(totalCapital: number, strategy: AllocationStrategy = "equal") {
    this.totalCapital = totalCapital;
    this.allocationStrategy = strategy;
  }

  /**
   * Add an exchange connection
   */
  async addExchange(config: ExchangeConfig): Promise<void> {
    try {
      const adapter = ExchangeFactory.createExchange(
        config.exchangeName,
        config.apiKey,
        config.apiSecret
      );

      // Test connection
      const isValid = await adapter.testConnection();
      if (!isValid) {
        throw new Error(`Failed to connect to ${config.exchangeName}`);
      }

      this.adapters.set(config.exchangeId, adapter);
      console.log(`[MultiExchangeManager] Added exchange: ${config.exchangeName} (ID: ${config.exchangeId})`);
    } catch (error: any) {
      console.error(`[MultiExchangeManager] Failed to add exchange ${config.exchangeName}:`, error.message);
      throw error;
    }
  }

  /**
   * Remove an exchange connection
   */
  removeExchange(exchangeId: number): void {
    this.adapters.delete(exchangeId);
    // Remove all trading pairs for this exchange
    this.tradingPairs = this.tradingPairs.filter(pair => pair.exchangeId !== exchangeId);
    console.log(`[MultiExchangeManager] Removed exchange ID: ${exchangeId}`);
  }

  /**
   * Configure trading pairs (exchange + symbol combinations)
   */
  configureTradingPairs(
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[]
  ): void {
    this.tradingPairs = [];

    for (const exchangeConfig of exchangeConfigs) {
      if (!exchangeConfig.isActive) continue;

      const adapter = this.adapters.get(exchangeConfig.exchangeId);
      if (!adapter) {
        console.warn(`[MultiExchangeManager] Exchange ${exchangeConfig.exchangeId} not found, skipping`);
        continue;
      }

      // Calculate exchange capital
      const exchangeCapital = this.totalCapital * (exchangeConfig.capitalAllocation / 100);

      for (const symbolConfig of symbolConfigs) {
        if (!symbolConfig.isActive) continue;

        // Calculate symbol capital within exchange
        const symbolCapital = exchangeCapital * (symbolConfig.capitalAllocation / 100);

        this.tradingPairs.push({
          exchangeId: exchangeConfig.exchangeId,
          exchangeName: exchangeConfig.exchangeName,
          symbol: symbolConfig.symbol,
          adapter,
          allocatedCapital: symbolCapital,
        });

        console.log(
          `[MultiExchangeManager] Trading pair: ${exchangeConfig.exchangeName}/${symbolConfig.symbol} ` +
          `(Capital: $${symbolCapital.toFixed(2)})`
        );
      }
    }

    console.log(`[MultiExchangeManager] Configured ${this.tradingPairs.length} trading pairs`);
  }

  /**
   * Allocate capital using equal weight strategy
   */
  private allocateEqualWeight(
    exchangeConfigs: ExchangeConfig[],
    symbolConfigs: SymbolConfig[]
  ): void {
    const activeExchanges = exchangeConfigs.filter(e => e.isActive);
    const activeSymbols = symbolConfigs.filter(s => s.isActive);

    if (activeExchanges.length === 0 || activeSymbols.length === 0) {
      console.warn("[MultiExchangeManager] No active exchanges or symbols");
      return;
    }

    // Equal allocation per exchange
    const capitalPerExchange = this.totalCapital / activeExchanges.length;

    // Equal allocation per symbol within exchange
    const capitalPerSymbol = capitalPerExchange / activeSymbols.length;

    for (const exchangeConfig of activeExchanges) {
      const adapter = this.adapters.get(exchangeConfig.exchangeId);
      if (!adapter) continue;

      for (const symbolConfig of activeSymbols) {
        this.tradingPairs.push({
          exchangeId: exchangeConfig.exchangeId,
          exchangeName: exchangeConfig.exchangeName,
          symbol: symbolConfig.symbol,
          adapter,
          allocatedCapital: capitalPerSymbol,
        });
      }
    }
  }

  /**
   * Get all trading pairs
   */
  getTradingPairs(): TradingPair[] {
    return this.tradingPairs;
  }

  /**
   * Get trading pairs for a specific exchange
   */
  getTradingPairsByExchange(exchangeId: number): TradingPair[] {
    return this.tradingPairs.filter(pair => pair.exchangeId === exchangeId);
  }

  /**
   * Get trading pairs for a specific symbol
   */
  getTradingPairsBySymbol(symbol: string): TradingPair[] {
    return this.tradingPairs.filter(pair => pair.symbol === symbol);
  }

  /**
   * Get a specific trading pair
   */
  getTradingPair(exchangeId: number, symbol: string): TradingPair | undefined {
    return this.tradingPairs.find(
      pair => pair.exchangeId === exchangeId && pair.symbol === symbol
    );
  }

  /**
   * Get total allocated capital
   */
  getTotalAllocatedCapital(): number {
    return this.tradingPairs.reduce((sum, pair) => sum + pair.allocatedCapital, 0);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalCapital: this.totalCapital,
      allocatedCapital: this.getTotalAllocatedCapital(),
      exchangeCount: this.adapters.size,
      tradingPairCount: this.tradingPairs.length,
      allocationStrategy: this.allocationStrategy,
      exchanges: Array.from(this.adapters.keys()),
      tradingPairs: this.tradingPairs.map(pair => ({
        exchange: pair.exchangeName,
        symbol: pair.symbol,
        capital: pair.allocatedCapital,
      })),
    };
  }

  /**
   * Update total capital
   */
  updateTotalCapital(newCapital: number): void {
    const ratio = newCapital / this.totalCapital;
    this.totalCapital = newCapital;

    // Adjust all trading pair allocations proportionally
    for (const pair of this.tradingPairs) {
      pair.allocatedCapital *= ratio;
    }

    console.log(`[MultiExchangeManager] Updated total capital to $${newCapital.toFixed(2)}`);
  }

  /**
   * Rebalance capital across trading pairs
   */
  rebalance(exchangeConfigs: ExchangeConfig[], symbolConfigs: SymbolConfig[]): void {
    console.log("[MultiExchangeManager] Rebalancing capital allocation...");
    this.configureTradingPairs(exchangeConfigs, symbolConfigs);
  }
}
