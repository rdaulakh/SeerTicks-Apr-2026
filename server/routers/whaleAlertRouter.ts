import { z } from "zod";
import { getActiveClock } from '../_core/clock';
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  fetchWhaleAlerts,
  getWhaleAlertStatus,
  formatWhaleTransaction,
  SUPPORTED_BLOCKCHAINS,
  type WhaleTransaction,
} from "../services/whaleAlertService";
import { getDb } from "../db";
import { whaleAlerts, whaleWatchlist } from "../../drizzle/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

/**
 * Whale Alert Router
 * Provides endpoints for fetching and managing whale alerts
 */
export const whaleAlertRouter = router({
  /**
   * Get API connection status
   */
  getStatus: publicProcedure.query(async () => {
    return await getWhaleAlertStatus();
  }),

  /**
   * Get supported blockchains
   */
  getSupportedBlockchains: publicProcedure.query(() => {
    return SUPPORTED_BLOCKCHAINS;
  }),

  /**
   * Fetch live whale alerts from API
   */
  getLiveAlerts: publicProcedure
    .input(
      z.object({
        minValue: z.number().min(0).optional().default(500000),
        blockchain: z.string().optional(),
        symbol: z.string().optional(),
        limit: z.number().min(1).max(100).optional().default(50),
        hoursBack: z.number().min(1).max(24).optional().default(1),
      })
    )
    .query(async ({ input }) => {
      const now = Math.floor(getActiveClock().now() / 1000);
      const startTime = now - input.hoursBack * 3600;

      try {
        const response = await fetchWhaleAlerts({
          minValue: input.minValue,
          blockchain: input.blockchain,
          symbol: input.symbol,
          startTime,
          limit: input.limit,
        });

        // Format transactions for display
        const formattedAlerts = response.transactions.map(formatWhaleTransaction);

        return {
          success: true,
          count: response.count,
          alerts: formattedAlerts,
          cursor: response.cursor,
        };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error fetching live alerts:", error);
        return {
          success: false,
          count: 0,
          alerts: [],
          error: error instanceof Error ? error.message : "Failed to fetch alerts",
        };
      }
    }),

  /**
   * Fetch and store whale alerts to database
   */
  syncAlerts: protectedProcedure
    .input(
      z.object({
        minValue: z.number().min(0).optional().default(500000),
        blockchain: z.string().optional(),
        hoursBack: z.number().min(1).max(24).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const now = Math.floor(getActiveClock().now() / 1000);
      const startTime = now - input.hoursBack * 3600;

      try {
        const response = await fetchWhaleAlerts({
          minValue: input.minValue,
          blockchain: input.blockchain,
          startTime,
          limit: 100,
        });

        let inserted = 0;
        let skipped = 0;

        for (const tx of response.transactions) {
          try {
            await db.insert(whaleAlerts).values({
              transactionHash: tx.hash,
              blockchain: tx.blockchain,
              symbol: tx.symbol.toUpperCase(),
              transactionType: tx.transaction_type,
              amount: tx.amount.toString(),
              amountUsd: tx.amount_usd.toString(),
              fromAddress: tx.from.address || null,
              toAddress: tx.to.address || null,
              fromOwner: tx.from.owner || "unknown",
              toOwner: tx.to.owner || "unknown",
              fromOwnerType: tx.from.owner_type || "unknown",
              toOwnerType: tx.to.owner_type || "unknown",
              transactionTimestamp: new Date(tx.timestamp * 1000),
            });
            inserted++;
          } catch (err: any) {
            // Skip duplicates (unique constraint violation)
            if (err.code === "ER_DUP_ENTRY") {
              skipped++;
            } else {
              console.error("[WhaleAlertRouter] Error inserting alert:", err);
            }
          }
        }

        return {
          success: true,
          fetched: response.count,
          inserted,
          skipped,
        };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error syncing alerts:", error);
        throw error;
      }
    }),

  /**
   * Get stored whale alerts from database
   */
  getStoredAlerts: publicProcedure
    .input(
      z.object({
        blockchain: z.string().optional(),
        symbol: z.string().optional(),
        minAmountUsd: z.number().optional(),
        limit: z.number().min(1).max(200).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { alerts: [], total: 0 };
      }

      try {
        // Build conditions
        const conditions = [];
        if (input.blockchain) {
          conditions.push(eq(whaleAlerts.blockchain, input.blockchain));
        }
        if (input.symbol) {
          conditions.push(eq(whaleAlerts.symbol, input.symbol.toUpperCase()));
        }
        if (input.minAmountUsd) {
          conditions.push(gte(whaleAlerts.amountUsd, input.minAmountUsd.toString()));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get alerts
        const alerts = await db
          .select()
          .from(whaleAlerts)
          .where(whereClause)
          .orderBy(desc(whaleAlerts.transactionTimestamp))
          .limit(input.limit)
          .offset(input.offset);

        // Get total count
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(whaleAlerts)
          .where(whereClause);

        return {
          alerts,
          total: countResult[0]?.count || 0,
        };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error fetching stored alerts:", error);
        return { alerts: [], total: 0 };
      }
    }),

  /**
   * Get whale alert statistics
   */
  getStats: publicProcedure
    .input(
      z.object({
        hoursBack: z.number().min(1).max(168).optional().default(24),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return null;
      }

      const cutoff = new Date(getActiveClock().now() - input.hoursBack * 3600 * 1000);

      try {
        // Total volume by blockchain
        const volumeByBlockchain = await db
          .select({
            blockchain: whaleAlerts.blockchain,
            totalUsd: sql<string>`SUM(amountUsd)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(whaleAlerts)
          .where(gte(whaleAlerts.transactionTimestamp, cutoff))
          .groupBy(whaleAlerts.blockchain)
          .orderBy(desc(sql`SUM(amountUsd)`));

        // Total volume by symbol
        const volumeBySymbol = await db
          .select({
            symbol: whaleAlerts.symbol,
            totalUsd: sql<string>`SUM(amountUsd)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(whaleAlerts)
          .where(gte(whaleAlerts.transactionTimestamp, cutoff))
          .groupBy(whaleAlerts.symbol)
          .orderBy(desc(sql`SUM(amountUsd)`))
          .limit(10);

        // Transaction type breakdown
        const byType = await db
          .select({
            type: whaleAlerts.transactionType,
            totalUsd: sql<string>`SUM(amountUsd)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(whaleAlerts)
          .where(gte(whaleAlerts.transactionTimestamp, cutoff))
          .groupBy(whaleAlerts.transactionType);

        // Total stats
        const totals = await db
          .select({
            totalUsd: sql<string>`SUM(amountUsd)`,
            count: sql<number>`COUNT(*)`,
            avgUsd: sql<string>`AVG(amountUsd)`,
          })
          .from(whaleAlerts)
          .where(gte(whaleAlerts.transactionTimestamp, cutoff));

        return {
          volumeByBlockchain,
          volumeBySymbol,
          byType,
          totals: totals[0],
          periodHours: input.hoursBack,
        };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error fetching stats:", error);
        return null;
      }
    }),

  /**
   * Get user's watchlist
   */
  getWatchlist: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      const watchlist = await db
        .select()
        .from(whaleWatchlist)
        .where(eq(whaleWatchlist.userId, ctx.user.id))
        .orderBy(desc(whaleWatchlist.createdAt));

      return watchlist;
    } catch (error) {
      console.error("[WhaleAlertRouter] Error fetching watchlist:", error);
      return [];
    }
  }),

  /**
   * Add item to watchlist
   */
  addToWatchlist: protectedProcedure
    .input(
      z.object({
        watchType: z.enum(["wallet", "token", "threshold", "exchange"]),
        walletAddress: z.string().optional(),
        tokenSymbol: z.string().optional(),
        blockchain: z.string().optional(),
        minAmountUsd: z.number().optional(),
        exchangeName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        await db.insert(whaleWatchlist).values({
          userId: ctx.user.id,
          watchType: input.watchType,
          walletAddress: input.walletAddress || null,
          tokenSymbol: input.tokenSymbol?.toUpperCase() || null,
          blockchain: input.blockchain || null,
          minAmountUsd: input.minAmountUsd?.toString() || null,
          exchangeName: input.exchangeName || null,
          notifyOnMatch: true,
          isActive: true,
        });

        return { success: true };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error adding to watchlist:", error);
        throw error;
      }
    }),

  /**
   * Remove item from watchlist
   */
  removeFromWatchlist: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        await db
          .delete(whaleWatchlist)
          .where(
            and(
              eq(whaleWatchlist.id, input.id),
              eq(whaleWatchlist.userId, ctx.user.id)
            )
          );

        return { success: true };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error removing from watchlist:", error);
        throw error;
      }
    }),

  /**
   * Toggle watchlist item active status
   */
  toggleWatchlistItem: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        await db
          .update(whaleWatchlist)
          .set({ isActive: input.isActive })
          .where(
            and(
              eq(whaleWatchlist.id, input.id),
              eq(whaleWatchlist.userId, ctx.user.id)
            )
          );

        return { success: true };
      } catch (error) {
        console.error("[WhaleAlertRouter] Error toggling watchlist item:", error);
        throw error;
      }
    }),
});
