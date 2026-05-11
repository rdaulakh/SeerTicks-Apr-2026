import { ExchangeInterface } from "./ExchangeInterface";
import { BinanceAdapter } from "./BinanceAdapter";
import { BinanceFuturesAdapter } from "./BinanceFuturesAdapter";
import { CoinbaseAdapter } from "./CoinbaseAdapter";

export type SupportedExchange = "binance" | "coinbase" | "binance-futures";

/**
 * Exchange Factory
 * Dynamically creates the appropriate exchange adapter based on configuration
 */
export class ExchangeFactory {
  /**
   * Create an exchange adapter instance
   * @param exchangeName The exchange to connect to
   * @param apiKey API key for the exchange
   * @param apiSecret API secret for the exchange
   */
  static createExchange(
    exchangeName: SupportedExchange,
    apiKey: string,
    apiSecret: string
  ): ExchangeInterface {
    switch (exchangeName) {
      case "binance":
        return new BinanceAdapter(apiKey, apiSecret);
      case "coinbase":
        return new CoinbaseAdapter(apiKey, apiSecret);
      case "binance-futures":
        return new BinanceFuturesAdapter(apiKey, apiSecret);
      default:
        throw new Error(`Unsupported exchange: ${exchangeName}`);
    }
  }

  /**
   * Get list of supported exchanges
   */
  static getSupportedExchanges(): SupportedExchange[] {
    return ["binance", "coinbase", "binance-futures"];
  }

  /**
   * Validate exchange name
   */
  static isValidExchange(exchangeName: string): exchangeName is SupportedExchange {
    return exchangeName === "binance" || exchangeName === "coinbase" || exchangeName === "binance-futures";
  }
}
