import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { strategies } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

export const strategyRouter = router({
  /**
   * Get all strategies for the current user
   */
  getUserStrategies: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const userStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.userId, ctx.user.id));

    return userStrategies;
  }),

  /**
   * Create a new trading strategy
   */
  createStrategy: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(["momentum", "mean_reversion", "breakout", "scalping", "swing", "arbitrage"]),
        config: z.any(), // JSON configuration including conditions
        stopLossPercent: z.string(),
        takeProfitPercent: z.string(),
        maxPositionSize: z.string(),
        kellyMultiplier: z.string(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [newStrategy] = await db.insert(strategies).values({
        userId: ctx.user.id,
        name: input.name,
        type: input.type,
        config: input.config,
        stopLossPercent: input.stopLossPercent,
        takeProfitPercent: input.takeProfitPercent,
        maxPositionSize: input.maxPositionSize,
        kellyMultiplier: input.kellyMultiplier,
        description: input.description,
        status: "active",
      });

      return { success: true, id: newStrategy.insertId };
    }),

  /**
   * Update an existing strategy
   */
  updateStrategy: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        type: z.enum(["momentum", "mean_reversion", "breakout", "scalping", "swing", "arbitrage"]).optional(),
        config: z.any().optional(),
        stopLossPercent: z.string().optional(),
        takeProfitPercent: z.string().optional(),
        maxPositionSize: z.string().optional(),
        kellyMultiplier: z.string().optional(),
        status: z.enum(["active", "suspended", "archived"]).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, ...updates } = input;

      await db
        .update(strategies)
        .set(updates)
        .where(and(eq(strategies.id, id), eq(strategies.userId, ctx.user.id)));

      return { success: true };
    }),

  /**
   * Delete a strategy
   */
  deleteStrategy: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .delete(strategies)
        .where(and(eq(strategies.id, input.id), eq(strategies.userId, ctx.user.id)));

      return { success: true };
    }),

  /**
   * Get a specific strategy by ID
   */
  getStrategy: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [strategy] = await db
        .select()
        .from(strategies)
        .where(and(eq(strategies.id, input.id), eq(strategies.userId, ctx.user.id)))
        .limit(1);

      if (!strategy) {
        throw new Error("Strategy not found");
      }

      return strategy;
    }),
});
