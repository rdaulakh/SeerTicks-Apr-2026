import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import {
  getClosedPaperPositions,
  getClosedLivePositions,
  getPaperOrderAnalytics,
  getLiveOrderAnalytics,
  getClosedPositionSymbols,
} from "../orderHistoryDb";

export const orderHistoryRouter = router({
  /**
   * Get closed positions (order history) with optional filters
   */
  getClosedPositions: protectedProcedure
    .input(
      z.object({
        isPaper: z.boolean().default(true),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        symbol: z.string().optional(),
        exitReason: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = {
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        symbol: input.symbol,
        exitReason: input.exitReason,
      };

      if (input.isPaper) {
        return await getClosedPaperPositions(ctx.user.id, filters);
      } else {
        return await getClosedLivePositions(ctx.user.id, filters);
      }
    }),

  /**
   * Get order history analytics (total trades, win rate, P&L, etc.)
   */
  getAnalytics: protectedProcedure
    .input(
      z.object({
        isPaper: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.isPaper) {
        return await getPaperOrderAnalytics(ctx.user.id);
      } else {
        return await getLiveOrderAnalytics(ctx.user.id);
      }
    }),

  /**
   * Get list of unique symbols from closed positions
   */
  getSymbols: protectedProcedure
    .input(
      z.object({
        isPaper: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      return await getClosedPositionSymbols(ctx.user.id, input.isPaper);
    }),
});
