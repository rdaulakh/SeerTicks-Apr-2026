import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { 
  onchainAgents, 
  agentActivities, 
  agentWatchedWallets, 
  onchainAgentSignals,
  InsertOnchainAgent,
  InsertAgentActivity,
  InsertAgentWatchedWallet,
  InsertOnchainAgentSignal
} from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

// Agent type enum
const agentTypeEnum = z.enum([
  "whale_tracker",
  "market_analyzer", 
  "trading_strategist",
  "risk_manager",
  "sentiment_analyst",
  "arbitrage_hunter",
  "custom"
]);

// Agent status enum
const agentStatusEnum = z.enum(["active", "paused", "stopped", "error"]);

// Chain enum for wallets
const chainEnum = z.enum([
  "ethereum", "bitcoin", "solana", "polygon", 
  "arbitrum", "optimism", "base", "avalanche"
]);

// Signal enum
const signalEnum = z.enum(["strong_buy", "buy", "hold", "sell", "strong_sell"]);

// Activity type enum
const activityTypeEnum = z.enum([
  "analysis", "signal", "alert", "trade_executed",
  "whale_detected", "risk_warning", "insight", "error"
]);

// Importance enum
const importanceEnum = z.enum(["low", "medium", "high", "critical"]);

export const onchainAgentsRouter = router({
  // Get all agents for the current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const agents = await db
      .select()
      .from(onchainAgents)
      .where(eq(onchainAgents.userId, ctx.user.id))
      .orderBy(desc(onchainAgents.createdAt));
    
    return agents;
  }),

  // Get a single agent by ID
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const [agent] = await db
        .select()
        .from(onchainAgents)
        .where(and(
          eq(onchainAgents.id, input.id),
          eq(onchainAgents.userId, ctx.user.id)
        ))
        .limit(1);
      
      return agent || null;
    }),

  // Create a new agent
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      avatar: z.string().optional(),
      agentType: agentTypeEnum,
      config: z.record(z.string(), z.any()).optional(),
      canExecuteTrades: z.boolean().default(false),
      canSendAlerts: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const agentData: InsertOnchainAgent = {
        userId: ctx.user.id,
        name: input.name,
        description: input.description || null,
        avatar: input.avatar || null,
        agentType: input.agentType,
        config: input.config || null,
        status: "stopped",
        canExecuteTrades: input.canExecuteTrades,
        canSendAlerts: input.canSendAlerts,
      };
      
      const result = await db.insert(onchainAgents).values(agentData).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      const insertId = Number(result[0].insertId);
      
      // Log the creation activity
      await db.insert(agentActivities).values({
        agentId: insertId,
        userId: ctx.user.id,
        activityType: "insight",
        title: `Agent "${input.name}" created`,
        summary: `New ${input.agentType.replace("_", " ")} agent has been created`,
        importance: "medium",
      }).onDuplicateKeyUpdate({ set: { isRead: false } });
      
      return { id: insertId, ...agentData };
    }),

  // Update an agent
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      avatar: z.string().optional(),
      config: z.record(z.string(), z.any()).optional(),
      canExecuteTrades: z.boolean().optional(),
      canSendAlerts: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const updateData: Partial<InsertOnchainAgent> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.avatar !== undefined) updateData.avatar = input.avatar;
      if (input.config !== undefined) updateData.config = input.config;
      if (input.canExecuteTrades !== undefined) updateData.canExecuteTrades = input.canExecuteTrades;
      if (input.canSendAlerts !== undefined) updateData.canSendAlerts = input.canSendAlerts;
      
      await db
        .update(onchainAgents)
        .set(updateData)
        .where(and(
          eq(onchainAgents.id, input.id),
          eq(onchainAgents.userId, ctx.user.id)
        ));
      
      return { success: true };
    }),

  // Delete an agent
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      // Delete related data first
      await db.delete(agentActivities).where(eq(agentActivities.agentId, input.id));
      await db.delete(agentWatchedWallets).where(eq(agentWatchedWallets.agentId, input.id));
      await db.delete(onchainAgentSignals).where(eq(onchainAgentSignals.agentId, input.id));
      
      // Delete the agent
      await db
        .delete(onchainAgents)
        .where(and(
          eq(onchainAgents.id, input.id),
          eq(onchainAgents.userId, ctx.user.id)
        ));
      
      return { success: true };
    }),

  // Start an agent
  start: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const now = new Date();
      await db
        .update(onchainAgents)
        .set({ 
          status: "active",
          lastRunAt: now,
          errorMessage: null,
        })
        .where(and(
          eq(onchainAgents.id, input.id),
          eq(onchainAgents.userId, ctx.user.id)
        ));
      
      // Log the start activity
      await db.insert(agentActivities).values({
        agentId: input.id,
        userId: ctx.user.id,
        activityType: "insight",
        title: "Agent started",
        summary: "Agent has been activated and is now running",
        importance: "medium",
      }).onDuplicateKeyUpdate({ set: { isRead: false } });
      
      return { success: true };
    }),

  // Stop an agent
  stop: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      await db
        .update(onchainAgents)
        .set({ status: "stopped" })
        .where(and(
          eq(onchainAgents.id, input.id),
          eq(onchainAgents.userId, ctx.user.id)
        ));
      
      // Log the stop activity
      await db.insert(agentActivities).values({
        agentId: input.id,
        userId: ctx.user.id,
        activityType: "insight",
        title: "Agent stopped",
        summary: "Agent has been deactivated",
        importance: "low",
      }).onDuplicateKeyUpdate({ set: { isRead: false } });
      
      return { success: true };
    }),

  // Get agent activities
  getActivities: protectedProcedure
    .input(z.object({
      agentId: z.number().optional(),
      limit: z.number().default(50),
      activityType: activityTypeEnum.optional(),
      importance: importanceEnum.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      let query = db
        .select()
        .from(agentActivities)
        .where(eq(agentActivities.userId, ctx.user.id))
        .orderBy(desc(agentActivities.createdAt))
        .limit(input.limit);
      
      const activities = await query;
      
      // Filter in memory for optional params (drizzle limitation with dynamic where)
      let filtered = activities;
      if (input.agentId) {
        filtered = filtered.filter(a => a.agentId === input.agentId);
      }
      if (input.activityType) {
        filtered = filtered.filter(a => a.activityType === input.activityType);
      }
      if (input.importance) {
        filtered = filtered.filter(a => a.importance === input.importance);
      }
      
      return filtered;
    }),

  // Mark activity as read
  markActivityRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      await db
        .update(agentActivities)
        .set({ isRead: true })
        .where(and(
          eq(agentActivities.id, input.id),
          eq(agentActivities.userId, ctx.user.id)
        ));
      
      return { success: true };
    }),

  // Get agent signals
  getSignals: protectedProcedure
    .input(z.object({
      agentId: z.number().optional(),
      symbol: z.string().optional(),
      status: z.enum(["pending", "executed", "expired", "cancelled"]).optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const signals = await db
        .select()
        .from(onchainAgentSignals)
        .where(eq(onchainAgentSignals.userId, ctx.user.id))
        .orderBy(desc(onchainAgentSignals.createdAt))
        .limit(input.limit);
      
      // Filter in memory for optional params
      let filtered = signals;
      if (input.agentId) {
        filtered = filtered.filter(s => s.agentId === input.agentId);
      }
      if (input.symbol) {
        filtered = filtered.filter(s => s.symbol === input.symbol);
      }
      if (input.status) {
        filtered = filtered.filter(s => s.status === input.status);
      }
      
      return filtered;
    }),

  // Get watched wallets for an agent
  getWatchedWallets: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const wallets = await db
        .select()
        .from(agentWatchedWallets)
        .where(and(
          eq(agentWatchedWallets.agentId, input.agentId),
          eq(agentWatchedWallets.userId, ctx.user.id)
        ))
        .orderBy(desc(agentWatchedWallets.createdAt));
      
      return wallets;
    }),

  // Add a watched wallet
  addWatchedWallet: protectedProcedure
    .input(z.object({
      agentId: z.number(),
      address: z.string().min(1).max(100),
      chain: chainEnum,
      label: z.string().optional(),
      minTransactionValue: z.number().default(100000),
      trackIncoming: z.boolean().default(true),
      trackOutgoing: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      const walletData: InsertAgentWatchedWallet = {
        agentId: input.agentId,
        userId: ctx.user.id,
        address: input.address,
        chain: input.chain,
        label: input.label || null,
        minTransactionValue: String(input.minTransactionValue),
        trackIncoming: input.trackIncoming,
        trackOutgoing: input.trackOutgoing,
      };
      
      const result = await db.insert(agentWatchedWallets).values(walletData).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      
      return { id: Number(result[0].insertId), ...walletData };
    }),

  // Remove a watched wallet
  removeWatchedWallet: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      await db
        .delete(agentWatchedWallets)
        .where(and(
          eq(agentWatchedWallets.id, input.id),
          eq(agentWatchedWallets.userId, ctx.user.id)
        ));
      
      return { success: true };
    }),

  // Get agent statistics
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    // Get all agents for user
    const agents = await db
      .select()
      .from(onchainAgents)
      .where(eq(onchainAgents.userId, ctx.user.id));
    
    // Get recent activities count
    const recentActivities = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentActivities)
      .where(and(
        eq(agentActivities.userId, ctx.user.id),
        sql`${agentActivities.createdAt} > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ));
    
    // Get pending signals count
    const pendingSignals = await db
      .select({ count: sql<number>`count(*)` })
      .from(onchainAgentSignals)
      .where(and(
        eq(onchainAgentSignals.userId, ctx.user.id),
        eq(onchainAgentSignals.status, "pending")
      ));
    
    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === "active").length;
    const totalRuns = agents.reduce((sum, a) => sum + (a.totalRuns || 0), 0);
    const totalSignals = agents.reduce((sum, a) => sum + (a.totalSignals || 0), 0);
    const accurateSignals = agents.reduce((sum, a) => sum + (a.accurateSignals || 0), 0);
    const accuracy = totalSignals > 0 ? (accurateSignals / totalSignals) * 100 : 0;
    
    return {
      totalAgents,
      activeAgents,
      totalRuns,
      totalSignals,
      accurateSignals,
      accuracy: Math.round(accuracy * 100) / 100,
      recentActivities: Number(recentActivities[0]?.count || 0),
      pendingSignals: Number(pendingSignals[0]?.count || 0),
    };
  }),

  // Initialize default agents for a new user
  initializeDefaultAgents: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    // Check if user already has agents
    const existingAgents = await db
      .select()
      .from(onchainAgents)
      .where(eq(onchainAgents.userId, ctx.user.id))
      .limit(1);
    
    if (existingAgents.length > 0) {
      return { message: "Agents already initialized", created: 0 };
    }
    
    // Create default agents
    const defaultAgents: InsertOnchainAgent[] = [
      {
        userId: ctx.user.id,
        name: "Whale Tracker",
        description: "Monitors large wallet movements and whale transactions across major blockchains. Alerts on significant accumulation or distribution patterns.",
        avatar: "🐋",
        agentType: "whale_tracker",
        config: {
          symbols: ["BTC-USD", "ETH-USD", "SOL-USD"],
          updateInterval: 5,
          minTransactionValue: 1000000,
          confidenceThreshold: 70,
        },
        status: "active",
        canExecuteTrades: false,
        canSendAlerts: true,
      },
      {
        userId: ctx.user.id,
        name: "Market Analyzer",
        description: "Analyzes market conditions using technical indicators, volume patterns, and price action. Identifies trend changes and market regimes.",
        avatar: "📊",
        agentType: "market_analyzer",
        config: {
          symbols: ["BTC-USD", "ETH-USD"],
          updateInterval: 10,
          indicators: ["RSI", "MACD", "EMA", "Volume"],
          timeframes: ["1h", "4h", "1d"],
          confidenceThreshold: 65,
        },
        status: "active",
        canExecuteTrades: false,
        canSendAlerts: true,
      },
      {
        userId: ctx.user.id,
        name: "Trading Strategist",
        description: "Generates trading signals based on multi-factor analysis combining technical, on-chain, and sentiment data. Provides entry/exit recommendations.",
        avatar: "🎯",
        agentType: "trading_strategist",
        config: {
          symbols: ["BTC-USD", "ETH-USD"],
          updateInterval: 15,
          strategies: ["momentum", "mean_reversion", "breakout"],
          maxPositionSize: 10,
          riskRewardRatio: 2.5,
          confidenceThreshold: 75,
        },
        status: "active",
        canExecuteTrades: true,
        canSendAlerts: true,
      },
    ];
    
    for (const agent of defaultAgents) {
      await db.insert(onchainAgents).values(agent);
    }
    
    return { message: "Default agents created", created: defaultAgents.length };
  }),
});

export type OnchainAgentsRouter = typeof onchainAgentsRouter;
