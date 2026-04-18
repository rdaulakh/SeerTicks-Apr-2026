import { ExchangeInterface } from "./ExchangeInterface";
import { BinanceAdapter } from "./BinanceAdapter";
import { CoinbaseAdapter } from "./CoinbaseAdapter";

/**
 * Exchange Factory
 * Dynamically creates the appropriate exchange adapter based on configuration
 */
export class ExchangeFactory {
  /**
   * Create an exchange adapter instance
   * @param exchangeName The exchange to connect to ("binance" or "coinbase")
   * @param apiKey API key for the exchange
   * @param apiSecret API secret for the exchange
   * @returns An instance of the appropriate exchange adapter
   */
  static createExchange(
    exchangeName: "binance" | "coinbase",
    apiKey: string,
    apiSecret: string
  ): ExchangeInterface {
    switch (exchangeName) {
      case "binance":
        return new BinanceAdapter(apiKey, apiSecret);
      case "coinbase":
        return new CoinbaseAdapter(apiKey, apiSecret);
      default:
        throw new Error(`Unsupported exchange: ${exchangeName}`);
    }
  }

  /**
   * Get list of supported exchanges
   */
  static getSupportedExchanges(): ("binance" | "coinbase")[] {
    return ["binance", "coinbase"];
  }

  /**
   * Validate exchange name
   */
  static isValidExchange(exchangeName: string): exchangeName is "binance" | "coinbase" {
    return exchangeName === "binance" || exchangeName === "coinbase";
  }
}
