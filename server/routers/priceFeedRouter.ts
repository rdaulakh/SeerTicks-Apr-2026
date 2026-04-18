/**
 * Price Feed Router
 * INFRASTRUCTURE FIX (Feb 6, 2026): Removed CoinAPI dependency.
 * Now reports Coinbase WebSocket + Binance REST fallback status.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { priceFeedService } from "../services/priceFeedService";
import { wsHealthMonitor } from "../monitoring/WebSocketHealthMonitor";

export const priceFeedRouter = router({
  getPrice: protectedProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => {
      const price = priceFeedService.getLatestPrice(input.symbol);
      
      if (!price) {
        return { success: false, error: "Price not available" } as const;
      }

      return { success: true, data: price } as const;
    }),

  getPrices: protectedProcedure
    .input(z.object({ symbols: z.array(z.string()) }))
    .query(({ input }) => {
      const prices = input.symbols
        .map((symbol) => priceFeedService.getLatestPrice(symbol))
        .filter((price) => price !== undefined);

      return { success: true, data: prices } as const;
    }),

  getAllPrices: protectedProcedure.query(() => {
    const prices = priceFeedService.getAllPrices();
    return { success: true, data: prices } as const;
  }),

  // Get price feed status - Coinbase WebSocket + Binance REST fallback
  getStatus: protectedProcedure.query(async () => {
    try {
      const allPrices = priceFeedService.getAllPrices();
      const priceCount = Object.keys(allPrices).length;
      const wsStatus = wsHealthMonitor.getStatus();

      let binanceFallbackStatus: any = null;
      try {
        const { binanceRestFallback } = await import('../services/BinanceRestFallback');
        binanceFallbackStatus = binanceRestFallback.getStatus();
      } catch (e) { /* not started yet */ }

      return {
        success: true,
        data: {
          coinbase: {
            connected: wsStatus['CoinbaseWS']?.connectionStatus === 'connected',
            messagesReceived: wsStatus['CoinbaseWS']?.totalMessages || 0,
            lastMessageTime: wsStatus['CoinbaseWS']?.lastMessageTime || null,
            reconnectAttempts: wsStatus['CoinbaseWS']?.reconnectionAttempts || 0,
            minutesSinceLastMessage: wsStatus['CoinbaseWS']?.minutesSinceLastMessage || null,
          },
          binanceFallback: binanceFallbackStatus,
          priceFeed: {
            priceCount,
            isRunning: priceFeedService.getStatus().isRunning,
          }
        }
      } as const;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: {
          coinbase: { connected: false, error: error.message },
          binanceFallback: null,
          priceFeed: { priceCount: 0, isRunning: false }
        }
      } as const;
    }
  }),
});
