import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getAgentWeights,
  upsertAgentWeights,
  getThresholdConfig,
  upsertThresholdConfig,
  getExternalApiKeys,
  upsertExternalApiKey,
  deleteExternalApiKey,
  getExchangeSettings,
  upsertExchangeSettings,
  exportTradesToJSON,
  exportWinningPatternsToJSON,
  exportMLTrainingDataToJSON,
} from "../db_settings";
import { getUserSettings, upsertSettings, resetSettingsToDefaults, getTradingModeConfig, upsertTradingModeConfig } from "../db";
import { encrypt, decrypt } from "../crypto";
import { getDb } from "../db";
import { apiKeys, exchanges, tradingSymbols, engineState } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

export const settingsRouter = router({
  // ===== User Settings =====
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getUserSettings(ctx.user.id);
    // Return defaults if no settings exist
    return settings || {
      userId: ctx.user.id,
      paperTrading: true,
      maxPositionSize: 20,
      minConfidence: 60,
      stopLoss: 5,
      takeProfit: 10,
      enableFastAgents: true,
      enableSlowAgents: true,
      agentUpdateInterval: 10,
      emailNotifications: true,
      pushNotifications: false,
      tradeAlerts: true,
      signalAlerts: false,
      maxDailyLoss: 1000,
      maxDrawdown: 15,
      riskPerTrade: 2,
      latencyAlertsEnabled: true,
      latencyP50Threshold: 100,
      latencyP95Threshold: 500,
      latencyP99Threshold: 1000,
      latencyEmailAlerts: false,
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        paperTrading: z.boolean().optional(),
        maxPositionSize: z.number().min(1).max(100).optional(),
        minConfidence: z.number().min(50).max(100).optional(),
        stopLoss: z.number().min(1).max(50).optional(),
        takeProfit: z.number().min(1).max(100).optional(),
        enableFastAgents: z.boolean().optional(),
        enableSlowAgents: z.boolean().optional(),
        agentUpdateInterval: z.number().min(5).max(60).optional(),
        emailNotifications: z.boolean().optional(),
        pushNotifications: z.boolean().optional(),
        tradeAlerts: z.boolean().optional(),
        signalAlerts: z.boolean().optional(),
        maxDailyLoss: z.number().min(0).optional(),
        maxDrawdown: z.number().min(1).max(100).optional(),
        riskPerTrade: z.number().min(0.1).max(10).optional(),
        latencyAlertsEnabled: z.boolean().optional(),
        latencyP50Threshold: z.number().min(10).max(5000).optional(),
        latencyP95Threshold: z.number().min(10).max(5000).optional(),
        latencyP99Threshold: z.number().min(10).max(5000).optional(),
        latencyEmailAlerts: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Convert riskPerTrade from decimal to integer for storage
      const settingsData: any = { ...input };
      if (input.riskPerTrade !== undefined) {
        settingsData.riskPerTrade = Math.round(input.riskPerTrade * 10) / 10;
      }
      
      await upsertSettings(ctx.user.id, settingsData);
      return { success: true };
    }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    await resetSettingsToDefaults(ctx.user.id);
    return { success: true };
  }),

  // ===== Agent Weights =====
  getAgentWeights: protectedProcedure.query(async ({ ctx }) => {
    const weights = await getAgentWeights(ctx.user.id);
    return weights || {
      userId: ctx.user.id,
      technicalWeight: "40.00",
      patternWeight: "35.00",
      orderFlowWeight: "25.00",
      sentimentWeight: "33.33",
      newsWeight: "33.33",
      macroWeight: "33.34",
      onChainWeight: "0.00",
      timeframeBonus: "10.00",
      isActive: true,
    };
  }),

  updateAgentWeights: protectedProcedure
    .input(
      z.object({
        technicalWeight: z.string(),
        patternWeight: z.string(),
        orderFlowWeight: z.string(),
        sentimentWeight: z.string(),
        newsWeight: z.string(),
        macroWeight: z.string(),
        onChainWeight: z.string().optional(),
        timeframeBonus: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await upsertAgentWeights({
        userId: ctx.user.id,
        ...input,
        isActive: true,
      });
      return { success: true };
    }),

  // ===== Threshold Config =====
  getThresholdConfig: protectedProcedure.query(async ({ ctx }) => {
    const config = await getThresholdConfig(ctx.user.id);
    return config || {
      userId: ctx.user.id,
      highVolatilityAtrMin: "5.00",
      mediumVolatilityAtrMin: "2.00",
      lowVolatilityAtrMax: "2.00",
      highVolatilityThreshold: "50.00",
      mediumVolatilityThreshold: "60.00",
      lowVolatilityThreshold: "70.00",
      scoutTier: "3.00",
      standardTier: "5.00",
      highTier: "7.00",
      veryHighTier: "10.00",
      extremeTier: "15.00",
      maxTier: "20.00",
      isActive: true,
    };
  }),

  updateThresholdConfig: protectedProcedure
    .input(
      z.object({
        highVolatilityAtrMin: z.string(),
        mediumVolatilityAtrMin: z.string(),
        lowVolatilityAtrMax: z.string(),
        highVolatilityThreshold: z.string(),
        mediumVolatilityThreshold: z.string(),
        lowVolatilityThreshold: z.string(),
        scoutTier: z.string(),
        standardTier: z.string(),
        highTier: z.string(),
        veryHighTier: z.string(),
        extremeTier: z.string(),
        maxTier: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await upsertThresholdConfig({
        userId: ctx.user.id,
        ...input,
        isActive: true,
      });
      return { success: true };
    }),

  // ===== External API Keys =====
  getExternalApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await getExternalApiKeys(ctx.user.id);
    // Return without decrypted keys (for security)
    return keys.map((k) => ({
      id: k.id,
      provider: k.provider,
      isValid: k.isValid,
      lastTested: k.lastTested,
      rateLimit: k.rateLimit,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }));
  }),

  addExternalApiKey: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        apiKey: z.string(),
        rateLimit: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { encrypted, iv } = encrypt(input.apiKey);
      
      await upsertExternalApiKey({
        userId: ctx.user.id,
        provider: input.provider,
        encryptedKey: encrypted,
        encryptionIv: iv,
        isValid: false, // Will be validated separately
        rateLimit: input.rateLimit,
      });
      
      return { success: true };
    }),

  deleteExternalApiKey: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteExternalApiKey(input.id, ctx.user.id);
      return { success: true };
    }),

  // ===== Exchange Management =====
  getExchanges: protectedProcedure.query(async ({ ctx }) => {
    console.log('[settingsRouter] getExchanges called for userId:', ctx.user.id);
    const db = await getDb();
    if (!db) {
      console.log('[settingsRouter] getExchanges: Database not available');
      return [];
    }
    
    const result = await db
      .select()
      .from(exchanges)
      .where(eq(exchanges.userId, ctx.user.id));
    console.log('[settingsRouter] getExchanges result:', result.length, 'exchanges found');
    
    // If no database exchanges found, check if engine has virtual adapters (paper trading)
    if (result.length === 0) {
      try {
        const { getEngineAdapter, getExistingAdapter } = await import('../services/EngineAdapter');
        let adapter = getExistingAdapter(ctx.user.id);
        
        // If no adapter exists, try to create one
        if (!adapter) {
          try {
            console.log('[settingsRouter] getExchanges: No existing adapter, creating...');
            adapter = await getEngineAdapter(ctx.user.id);
          } catch (startError) {
            console.log('[settingsRouter] getExchanges: Failed to create adapter:', startError);
          }
        }
        
        if (adapter) {
          // Get virtual exchanges from running adapter
          const status = adapter.getStatus();
          if (status.isRunning && status.exchangeCount > 0) {
            // Return virtual exchange info for paper trading
            console.log('[settingsRouter] getExchanges: Returning virtual exchanges from engine');
            return [{
              id: -1, // Virtual ID
              userId: ctx.user.id,
              exchangeName: 'coinbase',
              isActive: true,
              connectionStatus: 'connected',
              lastConnected: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
              isPaperTrading: true,
            }];
          }
        }
      } catch (error) {
        console.log('[settingsRouter] getExchanges: Error checking engine:', error);
      }
    }
    
    return result;
  }),

  addExchange: protectedProcedure
    .input(
      z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
        apiKey: z.string(),
        apiSecret: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validate API keys
      if (!input.apiKey || !input.apiSecret) {
        throw new Error("API key and secret are required");
      }

      // Phase 56 — actually probe the exchange BEFORE persisting. Pre-Phase-56
      // addExchange always wrote `connectionStatus='disconnected'` and `apiKeys.isValid=false`,
      // and no code path ever updated those fields. Result: every newly-added
      // exchange showed "Disconnected" + "Active" in the Settings UI even when
      // the wizard's testConnection had passed.
      const trimmedKey = input.apiKey.trim();
      const trimmedSecret = input.apiSecret.trim();
      let probeOk = false;
      let probeMessage = '';
      try {
        let adapter: any;
        if (input.exchangeName === 'binance') {
          const { BinanceAdapter } = await import('../exchanges/BinanceAdapter');
          adapter = new BinanceAdapter(trimmedKey, trimmedSecret);
        } else {
          const { CoinbaseAdapter } = await import('../exchanges/CoinbaseAdapter');
          adapter = new CoinbaseAdapter(trimmedKey, trimmedSecret);
        }
        probeOk = await adapter.testConnection();
        if (!probeOk) probeMessage = 'Exchange rejected the API credentials.';
      } catch (probeErr: any) {
        probeOk = false;
        probeMessage = probeErr?.message || 'Connection probe threw an error.';
      }

      const now = new Date();

      const result = await db.insert(exchanges).values({
        userId: ctx.user.id,
        exchangeName: input.exchangeName,
        isActive: true,
        connectionStatus: probeOk ? 'connected' : 'error',
        lastConnected: probeOk ? now : null,
      } as any);

      const exchangeId = Number(result[0].insertId);

      const { encrypted: encryptedKey, iv: keyIv } = encrypt(trimmedKey);
      const { encrypted: encryptedSecret, iv: secretIv } = encrypt(trimmedSecret);

      await db.insert(apiKeys).values({
        userId: ctx.user.id,
        exchangeId,
        encryptedApiKey: encryptedKey,
        encryptedApiSecret: encryptedSecret,
        apiKeyIv: keyIv,
        apiSecretIv: secretIv,
        isValid: probeOk,
        lastTested: now,
      } as any);

      if (!probeOk) {
        // Persist a row so the user can refresh/retry without losing the
        // wizard state, but surface the error to the toast so they know.
        return { success: false, exchangeId, message: probeMessage || 'Connection failed' };
      }
      return { success: true, exchangeId, message: 'Connected' };
    }),

  // Phase 56 — re-probe a stored exchange's keys and update connectionStatus.
  // Powers the UI's "Refresh" button and lets a row recover from a transient
  // network error without re-entering the API keys.
  refreshExchangeConnection: protectedProcedure
    .input(z.object({ exchangeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const exRows = await db
        .select()
        .from(exchanges)
        .where(and(eq(exchanges.id, input.exchangeId), eq(exchanges.userId, ctx.user.id)))
        .limit(1);
      if (exRows.length === 0) throw new Error('Exchange not found');
      const ex = exRows[0];

      const keyRows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.exchangeId, input.exchangeId), eq(apiKeys.userId, ctx.user.id)))
        .limit(1);
      if (keyRows.length === 0) throw new Error('No API keys stored for this exchange');
      const k = keyRows[0];

      let probeOk = false;
      let probeMessage = '';
      try {
        const apiKey = decrypt(k.encryptedApiKey, k.apiKeyIv);
        const apiSecret = decrypt(k.encryptedApiSecret, k.apiSecretIv);
        let adapter: any;
        if (ex.exchangeName === 'binance') {
          const { BinanceAdapter } = await import('../exchanges/BinanceAdapter');
          adapter = new BinanceAdapter(apiKey, apiSecret);
        } else {
          const { CoinbaseAdapter } = await import('../exchanges/CoinbaseAdapter');
          adapter = new CoinbaseAdapter(apiKey, apiSecret);
        }
        probeOk = await adapter.testConnection();
        if (!probeOk) probeMessage = 'Exchange rejected the stored API credentials.';
      } catch (probeErr: any) {
        probeOk = false;
        probeMessage = probeErr?.message || 'Connection probe threw an error.';
      }

      const now = new Date();
      await db
        .update(exchanges)
        .set({
          connectionStatus: probeOk ? 'connected' : 'error',
          lastConnected: probeOk ? now : ex.lastConnected,
        } as any)
        .where(eq(exchanges.id, input.exchangeId));
      await db
        .update(apiKeys)
        .set({ isValid: probeOk, lastTested: now } as any)
        .where(eq(apiKeys.id, k.id));

      return { success: probeOk, message: probeOk ? 'Connected' : probeMessage };
    }),

  deleteExchange: protectedProcedure
    .input(z.object({ exchangeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      // Delete API keys first
      await db
        .delete(apiKeys)
        .where(eq(apiKeys.exchangeId, input.exchangeId));
      
      // Delete exchange
      await db
        .delete(exchanges)
        .where(eq(exchanges.id, input.exchangeId));
      
      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(
      z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
        apiKey: z.string(),
        apiSecret: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Dynamically import the appropriate adapter
        let adapter;
        if (input.exchangeName === "binance") {
          const { BinanceAdapter } = await import("../exchanges/BinanceAdapter");
          adapter = new BinanceAdapter(input.apiKey, input.apiSecret);
        } else {
          const { CoinbaseAdapter } = await import("../exchanges/CoinbaseAdapter");
          adapter = new CoinbaseAdapter(input.apiKey, input.apiSecret);
        }

        // Test the connection
        const isValid = await adapter.testConnection();
        
        if (isValid) {
          return { 
            success: true, 
            message: `Successfully connected to ${input.exchangeName}` 
          };
        } else {
          return { 
            success: false, 
            message: `Failed to connect to ${input.exchangeName}. Please check your API credentials.` 
          };
        }
      } catch (error: any) {
        console.error(`[testConnection] Error testing ${input.exchangeName}:`, error);
        console.error(`[testConnection] Error stack:`, error.stack);
        console.error(`[testConnection] API Key (first 20 chars):`, input.apiKey.substring(0, 20));
        console.error(`[testConnection] API Secret (first 50 chars):`, input.apiSecret.substring(0, 50));
        return { 
          success: false, 
          message: `Connection failed: ${error.message || 'Unknown error'}. Check server logs for details.` 
        };
      }
    }),

  // ===== Exchange Settings =====
  getExchangeSettings: protectedProcedure
    .input(z.object({ exchangeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const settings = await getExchangeSettings(ctx.user.id, input.exchangeId);
      return settings || {
        userId: ctx.user.id,
        exchangeId: input.exchangeId,
        useTestnet: false,
        maxOrdersPerMinute: 10,
        maxPositionSize: "20.00",
        maxTotalExposure: "50.00",
        enableStopLoss: true,
        enableTakeProfit: true,
        enablePartialExits: true,
        defaultLeverage: 1,
      };
    }),

  updateExchangeSettings: protectedProcedure
    .input(
      z.object({
        exchangeId: z.number(),
        useTestnet: z.boolean(),
        maxOrdersPerMinute: z.number(),
        maxPositionSize: z.string(),
        maxTotalExposure: z.string(),
        enableStopLoss: z.boolean(),
        enableTakeProfit: z.boolean(),
        enablePartialExits: z.boolean(),
        defaultLeverage: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await upsertExchangeSettings({
        userId: ctx.user.id,
        ...input,
      });
      return { success: true };
    }),

  // ===== Database Export =====
  exportTrades: protectedProcedure.query(async ({ ctx }) => {
    const trades = await exportTradesToJSON(ctx.user.id);
    return trades;
  }),

  exportWinningPatterns: protectedProcedure.query(async ({ ctx }) => {
    const patterns = await exportWinningPatternsToJSON(ctx.user.id);
    return patterns;
  }),

  exportMLData: protectedProcedure.query(async ({ ctx }) => {
    const data = await exportMLTrainingDataToJSON(ctx.user.id);
    return data;
  }),

  // ===== Trading Symbols =====
  getSymbols: protectedProcedure.query(async ({ ctx }) => {
    console.log('[settingsRouter] getSymbols called for userId:', ctx.user.id);
    const db = await getDb();
    if (!db) {
      console.log('[settingsRouter] getSymbols: Database not available');
      throw new Error("Database not available");
    }
    
    const symbols = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, ctx.user.id));
    
    console.log('[settingsRouter] getSymbols result:', symbols.length, 'symbols found');
    
    // If no database symbols found, check if engine has virtual symbols (paper trading)
    if (symbols.length === 0) {
      try {
        const { getEngineAdapter, getExistingAdapter } = await import('../services/EngineAdapter');
        let adapter = getExistingAdapter(ctx.user.id);
        
        // If no adapter exists, try to create one
        if (!adapter) {
          try {
            console.log('[settingsRouter] getSymbols: No existing adapter, creating...');
            adapter = await getEngineAdapter(ctx.user.id);
          } catch (startError) {
            console.log('[settingsRouter] getSymbols: Failed to create adapter:', startError);
          }
        }
        
        if (adapter) {
          // Get virtual symbols from running adapter
          const status = adapter.getStatus();
          if (status.isRunning && status.symbolCount > 0) {
            // Return virtual symbol info for paper trading
            console.log('[settingsRouter] getSymbols: Returning virtual symbols from engine');
            const virtualSymbols = [];
            let idCounter = -1;
            
            // Get actual symbols from adapter's status
            for (const sym of status.symbols || []) {
              virtualSymbols.push({
                id: idCounter--,
                userId: ctx.user.id,
                symbol: sym,
                exchangeName: 'coinbase',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                isPaperTrading: true,
              });
            }
            
            // If no pairs in status, return default paper trading symbols
            if (virtualSymbols.length === 0) {
              virtualSymbols.push(
                {
                  id: -1,
                  userId: ctx.user.id,
                  symbol: 'BTC-USD',
                  exchangeName: 'coinbase',
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  isPaperTrading: true,
                },
                {
                  id: -2,
                  userId: ctx.user.id,
                  symbol: 'ETH-USD',
                  exchangeName: 'coinbase',
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  isPaperTrading: true,
                }
              );
            }
            
            return virtualSymbols;
          }
        }
      } catch (error) {
        console.log('[settingsRouter] getSymbols: Error checking engine:', error);
      }
    }
    
    return symbols;
  }),

  addSymbol: protectedProcedure
    .input(
      z.object({
        symbol: z.string(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      // Check if symbol already exists
      const existing = await db
        .select()
        .from(tradingSymbols)
        .where(
          and(
            eq(tradingSymbols.userId, ctx.user.id),
            eq(tradingSymbols.symbol, input.symbol)
          )
        )
        .limit(1);
      
      if (existing.length > 0) {
        // Update existing
        await db
          .update(tradingSymbols)
          .set({ isActive: input.isActive ?? true })
          .where(eq(tradingSymbols.id, existing[0].id));
        return { success: true, symbolId: existing[0].id };
      }
      
      // Insert new
      const [result] = await db.insert(tradingSymbols).values({
        userId: ctx.user.id,
        symbol: input.symbol,
        isActive: input.isActive ?? true,
      });
      
      return { success: true, symbolId: result.insertId };
    }),

  deleteSymbol: protectedProcedure
    .input(z.object({ symbolId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      
      await db
        .delete(tradingSymbols)
        .where(eq(tradingSymbols.id, input.symbolId));
      
      return { success: true };
    }),

  // ===== Trading Mode Configuration =====
  getTradingMode: protectedProcedure.query(async ({ ctx }) => {
    const config = await getTradingModeConfig(ctx.user.id);
    return config || {
      userId: ctx.user.id,
      mode: "paper" as const,
      enableSlippage: true,
      enableCommission: true,
      enableMarketImpact: true,
      enableLatency: true,
      autoTradeEnabled: false,
      portfolioFunds: "10000.00",
    };
  }),

  // ===== Portfolio Funds Management =====
  getPortfolioFunds: protectedProcedure.query(async ({ ctx }) => {
    const config = await getTradingModeConfig(ctx.user.id);
    return {
      funds: config?.portfolioFunds || "10000.00",
    };
  }),

  updatePortfolioFunds: protectedProcedure
    .input(
      z.object({
        funds: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0 && num <= 100000000;
        }, "Funds must be a valid number between 0 and 100,000,000"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await upsertTradingModeConfig({
        userId: ctx.user.id,
        portfolioFunds: input.funds,
      });
      return { success: true, funds: input.funds };
    }),

  updateTradingMode: protectedProcedure
    .input(
      z.object({
        mode: z.enum(["paper", "real"]),
        enableSlippage: z.boolean().optional(),
        enableCommission: z.boolean().optional(),
        enableMarketImpact: z.boolean().optional(),
        enableLatency: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Save to database
      await upsertTradingModeConfig({
        userId: ctx.user.id,
        mode: input.mode,
        enableSlippage: input.enableSlippage ?? true,
        enableCommission: input.enableCommission ?? true,
        enableMarketImpact: input.enableMarketImpact ?? true,
        enableLatency: input.enableLatency ?? true,
      });
      
      // Sync trading mode to running engine in background (non-blocking)
      // This ensures the API response is fast while engine sync happens asynchronously
      // The periodic sync will also catch this as a fallback
      const syncToEngine = async () => {
        try {
          const { getEngineAdapter } = await import('../services/EngineAdapter');
          
          const timeoutPromise = new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('Engine sync timeout')), 5000)
          );
          
          const adapter = await Promise.race([
            getEngineAdapter(ctx.user.id),
            timeoutPromise
          ]);
          
          if (adapter) {
            // Phase 14D: Trading mode sync is handled by UserTradingSession settings sync
            console.log(`[settingsRouter] Trading mode sync requested: ${input.mode.toUpperCase()} — handled by UserTradingSession`);
          }
        } catch (syncError) {
          // Non-critical - periodic sync will catch this
          console.warn(`[settingsRouter] Failed to sync trading mode to engine:`, syncError);
        }
      };
      
      // Fire and forget - don't await
      syncToEngine().catch(console.warn);
      
      return { success: true };
    }),

  // ===== Auto Trading Configuration =====
  // CRITICAL FIX: Use tradingModeConfig.autoTradeEnabled as SINGLE SOURCE OF TRUTH
  // This matches what the engine's syncAutoTradingEnabled() reads
  getAutoTrading: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    
    try {
      // Read from tradingModeConfig - the same source the engine uses
      const config = await getTradingModeConfig(userId);
      
      // MySQL returns 1/0 for boolean columns, so use Boolean() for proper conversion
      const enabled = Boolean(config?.autoTradeEnabled);
      
      console.log(`[getAutoTrading] User ${userId}: autoTradeEnabled=${enabled} (from tradingModeConfig)`);
      return { enabled };
    } catch (error) {
      console.error('[getAutoTrading] Error:', error);
      return { enabled: false };
    }
  }),

  /**
   * Update Auto Trading Setting
   * 
   * CRITICAL FIX: Write to tradingModeConfig.autoTradeEnabled (SINGLE SOURCE OF TRUTH)
   * This is the same table the engine's syncAutoTradingEnabled() reads from.
   * 
   * The engine has a 5-second periodic sync that will pick up the change.
   * This design prevents connection pool contention and gateway timeouts.
   */
  updateAutoTrading: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      console.log(`[updateAutoTrading] User ${ctx.user.id} setting auto trading to: ${input.enabled}`);
      
      try {
        // Write to tradingModeConfig - the SINGLE SOURCE OF TRUTH
        await upsertTradingModeConfig({
          userId: ctx.user.id,
          autoTradeEnabled: input.enabled,
        });
        
        const duration = Date.now() - startTime;
        console.log(`[updateAutoTrading] Updated tradingModeConfig in ${duration}ms. Engine will sync within 5 seconds.`);
        
        return { success: true };
      } catch (error) {
        console.error(`[updateAutoTrading] Failed:`, error);
        throw error;
      }
    }),
});
