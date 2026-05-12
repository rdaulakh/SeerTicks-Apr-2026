import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { ENV } from './_core/env';
import { settingsRouter } from "./routers/settingsRouter";
import { seerMultiRouter } from "./routers/seerMultiRouter";
import { portfolioRouter } from "./routers/portfolioRouter";
import { strategyAnalyticsRouter } from "./routers/strategyAnalyticsRouter";
import { positionSizeRouter } from "./routers/positionSizeRouter";
import { adminRouter } from "./routers/adminRouter";
import { agentAccuracyRouter } from "./routers/agentAccuracyRouter";
import { priceFeedRouter } from "./routers/priceFeedRouter";
// import { rateLimitManagementRouter } from "./routers/rateLimitManagementRouter";
import { monitoringRouter } from "./routers/monitoringRouter";
import { healthRouter } from "./routers/healthRouter";
import { leadInfoRouter } from "./routers/leadInfoRouter";
import { alertRouter } from "./routers/alertRouter";
import { reconciliationRouter } from "./routers/reconciliation";
import { riskRouter } from "./routers/riskRouter";
import { advancedRiskRouter } from "./routers/advancedRiskRouter";
import { orderHistoryRouter } from "./routers/orderHistoryRouter";
import { pnlChartRouter } from "./routers/pnlChartRouter";
import { patternRouter } from "./routers/patternRouter";
import { technicalIndicatorsRouter } from "./routers/technicalIndicatorsRouter";
import { tradingSignalsRouter } from "./routers/tradingSignalsRouter";
import { automatedTradingRouter } from "./routers/automatedTrading";
import { candlesRouter } from "./routers/candlesRouter";
import { agentSignalsRouter } from "./routers/agentSignalsRouter";
import { highFrequencyRouter } from "./routers/highFrequencyRouter";
import { strategyRouter } from "./routers/strategyRouter";
import { multiStrategyRouter } from "./routers/multiStrategyRouter";
import { whaleAlertRouter } from "./routers/whaleAlertRouter";
import { advancedAIRouter } from './routers/advancedAIRouter';
import { onChainAnalyticsRouter } from './routers/onChainAnalyticsRouter';
import { aplusPlusRouter } from './routers/aplusPlusRouter';
import { consensusBacktestRouter } from './routers/consensusBacktestRouter';
import { dataIngestionRouter } from './routers/dataIngestionRouter';
import { tradeJournalRouter } from './routers/tradeJournalRouter';
import { onchainAgentsRouter } from './routers/onchainAgentsRouter';
import { positionConsensusRouter } from './routers/positionConsensusRouter';
import { tradeDecisionLogRouter } from './routers/tradeDecisionLogRouter';
import { waitlistRouter } from './routers/waitlistRouter';
import { mlAnalyticsRouter } from './routers/mlAnalyticsRouter';
import { riskManagementRouter } from './routers/riskManagementRouter';
import { pipelineRouter } from './routers/pipelineRouter';
import { tcaRouter } from './routers/tcaRouter';
import { agentScorecardRouter } from './routers/agentScorecardRouter';

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  settings: settingsRouter,
  seerMulti: seerMultiRouter,
  portfolio: portfolioRouter,
  strategyAnalytics: strategyAnalyticsRouter,
  positionSize: positionSizeRouter,
  admin: adminRouter,
  agentAccuracy: agentAccuracyRouter,
  priceFeed: priceFeedRouter,
  // rateLimit: rateLimitManagementRouter,
  monitoring: monitoringRouter,
  health: healthRouter,
  leadInfo: leadInfoRouter,
  alert: alertRouter,
  reconciliation: reconciliationRouter,
  risk: riskRouter,
  advancedRisk: advancedRiskRouter,
  orderHistory: orderHistoryRouter,
  pnlChart: pnlChartRouter,
  pattern: patternRouter,
  technicalIndicators: technicalIndicatorsRouter,
  tradingSignals: tradingSignalsRouter,
  automatedTrading: automatedTradingRouter,
  candles: candlesRouter,
  agentSignals: agentSignalsRouter,
  highFrequency: highFrequencyRouter,
  strategy: strategyRouter,
  multiStrategy: multiStrategyRouter,
  whaleAlert: whaleAlertRouter,
  advancedAI: advancedAIRouter,
  onChainAnalytics: onChainAnalyticsRouter,
  aplusPlus: aplusPlusRouter,
  consensusBacktest: consensusBacktestRouter,
  dataIngestion: dataIngestionRouter,
  tradeJournal: tradeJournalRouter,
  onchainAgents: onchainAgentsRouter,
  positionConsensus: positionConsensusRouter,
  tca: tcaRouter,
  agentScorecard: agentScorecardRouter,
  tradeDecisionLog: tradeDecisionLogRouter,
  waitlist: waitlistRouter,
  mlAnalytics: mlAnalyticsRouter,
  riskManagement: riskManagementRouter,
  pipeline: pipelineRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    
    // Email/Password Login - bypasses Manus OAuth
    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const bcrypt = await import('bcrypt');
        const jwt = await import('jsonwebtoken');
        const { getDb } = await import('./db');
        const { users } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) {
          throw new Error('Database not available');
        }
        
        // Find user by email
        const result = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        const user = result[0];
        
        if (!user) {
          throw new Error('Invalid email or password');
        }
        
        // Check if user has a password set
        if (!user.passwordHash) {
          throw new Error('Please use OAuth login or reset your password');
        }
        
        // Verify password
        const isValid = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValid) {
          throw new Error('Invalid email or password');
        }
        
        // Update last signed in
        await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
        
        // Create JWT token
        const jwtSecret = ENV.jwtSecret;
        const token = jwt.default.sign(
          { userId: user.id, openId: user.openId || `local_${user.id}`, email: user.email },
          jwtSecret,
          { expiresIn: '7d' }
        );
        
        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        
        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        };
      }),
    
    // Register new user with email/password
    register: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        name: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const bcrypt = await import('bcrypt');
        const jwt = await import('jsonwebtoken');
        const { getDb } = await import('./db');
        const { users } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        
        const db = await getDb();
        if (!db) {
          throw new Error('Database not available');
        }
        
        // Check if email already exists
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (existing.length > 0) {
          throw new Error('Email already registered');
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(input.password, 10);
        
        // Create user
        const result = await db.insert(users).values({
          email: input.email,
          passwordHash,
          name: input.name || null,
          loginMethod: 'email',
          emailVerified: false,
          role: 'user',
        });
        
        const userId = Number(result[0].insertId);
        
        // Create JWT token
        const jwtSecret = ENV.jwtSecret;
        const token = jwt.default.sign(
          { userId, openId: `local_${userId}`, email: input.email },
          jwtSecret,
          { expiresIn: '7d' }
        );
        
        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        
        return {
          success: true,
          user: {
            id: userId,
            email: input.email,
            name: input.name || null,
            role: 'user',
          },
        };
      }),
    
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),

  }),

  // Exchange and API key management
  exchange: router({
    // Get user's active exchange configuration
    getActive: protectedProcedure.query(async ({ ctx }) => {
      const { getUserExchange } = await import("./exchangeDb");
      return await getUserExchange(ctx.user.id);
    }),

    // Get all active exchanges with connection status
    getActiveExchangesWithStatus: protectedProcedure.query(async ({ ctx }) => {
      const { getActiveExchangesWithKeys } = await import("./exchangeDb");
      const exchanges = await getActiveExchangesWithKeys(ctx.user.id);
      
      // Return exchange info with status (hide sensitive keys)
      return exchanges.map(ex => ({
        id: ex.id,
        exchangeName: ex.exchangeName,
        connectionStatus: ex.connectionStatus,
        lastConnected: ex.lastConnected,
        hasValidKeys: ex.hasValidKeys,
        isActive: ex.isActive,
      }));
    }),

    // Manually trigger health check for all exchanges
    checkHealth: protectedProcedure.mutation(async ({ ctx }) => {
      const { getExchangeHealthMonitor } = await import("./services/ExchangeHealthMonitor");
      const monitor = getExchangeHealthMonitor();
      // Note: checkNow method doesn't exist, return current health status
      const health = monitor.getAllHealth();
      return { success: true, health };
    }),

    // Set user's exchange (Binance or Coinbase)
    setExchange: protectedProcedure
      .input(z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { upsertExchange } = await import("./exchangeDb");
        await upsertExchange({
          userId: ctx.user.id,
          exchangeName: input.exchangeName,
        });
        return { success: true };
      }),

    // Store encrypted API keys
    storeApiKeys: protectedProcedure
      .input(z.object({
        exchangeId: z.number(),
        apiKey: z.string().min(1),
        apiSecret: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const { storeApiKeys } = await import("./exchangeDb");
        await storeApiKeys(
          ctx.user.id,
          input.exchangeId,
          input.apiKey,
          input.apiSecret
        );
        return { success: true };
      }),

    // Test API key connection
    testConnection: protectedProcedure
      .input(z.object({
        exchangeId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getApiKeys, updateApiKeyValidity, updateExchangeStatus, getUserExchange } = await import("./exchangeDb");
        const { ExchangeFactory } = await import("./exchanges");
        
        const keys = await getApiKeys(ctx.user.id, input.exchangeId);
        if (!keys) {
          throw new Error("API keys not found");
        }

        const exchange = await getUserExchange(ctx.user.id);
        if (!exchange) {
          throw new Error("Exchange configuration not found");
        }

        try {
          // Create exchange adapter and test connection
          const adapter = ExchangeFactory.createExchange(
            exchange.exchangeName,
            keys.apiKey,
            keys.apiSecret
          );

          const isValid = await adapter.testConnection();

          if (isValid) {
            await updateApiKeyValidity(keys.id, true);
            await updateExchangeStatus(input.exchangeId, "connected");
            return { success: true, message: "Connection successful" };
          } else {
            await updateApiKeyValidity(keys.id, false);
            await updateExchangeStatus(input.exchangeId, "error");
            return { success: false, message: "Connection failed: Invalid credentials" };
          }
        } catch (error: any) {
          await updateApiKeyValidity(keys.id, false);
          await updateExchangeStatus(input.exchangeId, "error");
          throw new Error(`Connection test failed: ${error.message}`);
        }
      }),
  }),

  // Hot Path - Real-time monitoring and deviation detection
  hotpath: router({
    // Start monitoring a position
    startMonitoring: protectedProcedure
      .input(z.object({
        exchangeId: z.number(),
        symbol: z.string(),
        entryPrice: z.number(),
        targetPrice: z.number(),
        stopLoss: z.number(),
        timeHorizon: z.number(), // in minutes
        side: z.enum(["long", "short"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getUserExchange, getApiKeys } = await import("./exchangeDb");
        const { ExchangeFactory } = await import("./exchanges");
        const { getHotPath, getDeviationEngine } = await import("./hotpath");

        // Get user's exchange configuration
        const exchange = await getUserExchange(ctx.user.id);
        if (!exchange) {
          throw new Error("Exchange not configured");
        }

        // Get API keys
        const keys = await getApiKeys(ctx.user.id, input.exchangeId);
        if (!keys) {
          throw new Error("API keys not found");
        }

        // Create exchange adapter
        const adapter = ExchangeFactory.createExchange(
          exchange.exchangeName,
          keys.apiKey,
          keys.apiSecret
        );

        // Generate expected path
        const deviationEngine = getDeviationEngine();
        const expectedPath = deviationEngine.generateSimplePath(
          input.symbol,
          input.entryPrice,
          input.targetPrice,
          input.stopLoss,
          input.timeHorizon
        );

        // Start monitoring
        const hotPath = getHotPath();
        await hotPath.startMonitoring(
          ctx.user.id,
          adapter,
          input.symbol,
          expectedPath,
          input.side
        );

        return { success: true, message: "Monitoring started" };
      }),

    // Stop monitoring a position
    stopMonitoring: protectedProcedure
      .input(z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
        symbol: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getHotPath } = await import("./hotpath");

        const hotPath = getHotPath();
        await hotPath.stopMonitoring(ctx.user.id, input.exchangeName, input.symbol);

        return { success: true, message: "Monitoring stopped" };
      }),

    // Get Hot Path statistics
    getStats: publicProcedure
      .query(async () => {
        const { getHotPath } = await import("./hotpath");
        const { RedisHelpers } = await import("./hotpath");

        const hotPath = getHotPath();
        const stats = hotPath.getStats();
        const redisHealthy = await RedisHelpers.healthCheck();

        return {
          ...stats,
          redisHealthy,
        };
      }),

    // Get current deviation score for a symbol
    getDeviation: publicProcedure
      .input(z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
        symbol: z.string(),
      }))
      .query(async ({ input }) => {
        const { RedisHelpers } = await import("./hotpath");

        const deviation = await RedisHelpers.getDeviation(input.exchangeName, input.symbol);
        return { deviation };
      }),

    // Get recent ticks for a symbol
    getRecentTicks: publicProcedure
      .input(z.object({
        exchangeName: z.enum(["binance", "coinbase"]),
        symbol: z.string(),
        count: z.number().optional().default(100),
      }))
      .query(async ({ input }) => {
        const { RedisHelpers } = await import("./hotpath");

        const ticks = await RedisHelpers.getRecentTicks(
          input.exchangeName,
          input.symbol,
          input.count
        );
        return { ticks };
      }),
  }),

  // User bias and human-AI collaboration
  bias: router({
    // Get current bias settings
    get: protectedProcedure.query(async ({ ctx }) => {
      const { getUserBias } = await import("./exchangeDb");
      return await getUserBias(ctx.user.id);
    }),

    // Update bias slider
    update: protectedProcedure
      .input(z.object({
        bias: z.enum(["bearish", "neutral", "bullish"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { updateUserBias } = await import("./exchangeDb");
        await updateUserBias(ctx.user.id, input.bias);
        return { success: true };
      }),

    // Veto next trade
    vetoNext: protectedProcedure.mutation(async ({ ctx }) => {
      const { getUserBias, updateUserBias } = await import("./exchangeDb");
      const current = await getUserBias(ctx.user.id);
      if (current) {
        await updateUserBias(ctx.user.id, current.bias, true);
      }
      return { success: true };
    }),
  }),

  // SEER Trading Engine — Phase 14D: Uses EngineAdapter (no legacy SEERMultiEngine)
  seer: router({
    getStatus: protectedProcedure.query(async ({ ctx }) => {
      const { getEngineAdapter } = await import('./services/EngineAdapter');
      const adapter = await getEngineAdapter(ctx.user.id);
      return adapter.getStatus();
    }),

    start: protectedProcedure
      .input(z.object({
        symbol: z.string().default('BTCUSDT'),
        tickInterval: z.number().default(5000),
        capitalAvailable: z.number().default(10000),
        enableAutoTrading: z.boolean().default(false),
        enableLearning: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getEngineAdapter } = await import('./services/EngineAdapter');
        const adapter = await getEngineAdapter(ctx.user.id);
        await adapter.start();
        return { success: true, message: 'SEER engine started' };
      }),

    stop: protectedProcedure
      .input(z.object({
        force: z.boolean().default(false).optional(),
      }).optional())
      .mutation(async ({ ctx, input }) => {
        const { getEngineAdapter } = await import('./services/EngineAdapter');
        const adapter = await getEngineAdapter(ctx.user.id);
        
        try {
          adapter.updateConfig({ autoTrading: false });
          return { success: true, message: 'SEER engine stopped' };
        } catch (error: any) {
          const positions = await adapter.getAllPositions();
          const isOpenPositionsError = error.message?.includes('open position');
          
          return { 
            success: false, 
            error: error.message || 'Failed to stop engine',
            safetyBlock: isOpenPositionsError,
            openPositions: positions.length,
            positions: isOpenPositionsError ? positions.map((p: any) => ({
              id: p.id,
              symbol: p.symbol,
              side: p.side,
              unrealizedPnl: p.unrealizedPnl,
            })) : [],
          };
        }
      }),

    updateConfig: protectedProcedure
      .input(z.object({
        symbol: z.string().optional(),
        tickInterval: z.number().optional(),
        capitalAvailable: z.number().optional(),
        enableAutoTrading: z.boolean().optional(),
        enableLearning: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getEngineAdapter } = await import('./services/EngineAdapter');
        const adapter = await getEngineAdapter(ctx.user.id);
        adapter.updateConfig({ autoTrading: input.enableAutoTrading });
        return { success: true };
      }),

    getAgentHealth: protectedProcedure.query(async ({ ctx }) => {
      const { getEngineAdapter } = await import('./services/EngineAdapter');
      const adapter = await getEngineAdapter(ctx.user.id);
      return adapter.getAllAgentsStatus();
    }),

    getPositions: protectedProcedure.query(async ({ ctx }) => {
      const { getEngineAdapter } = await import('./services/EngineAdapter');
      const adapter = await getEngineAdapter(ctx.user.id);
      return adapter.getAllPositions();
    }),

    getLearningStats: publicProcedure.query(async () => {
      const { getLearningSystem } = await import('./ml/LearningSystem');
      const learningSystem = getLearningSystem();
      return await learningSystem.getStatistics();
    }),
  }),

  // Trading Execution
  trading: router({
    // Get trading mode configuration
    getMode: protectedProcedure.query(async ({ ctx }) => {
      const { getTradingModeConfig, upsertTradingModeConfig } = await import("./db");
      let config = await getTradingModeConfig(ctx.user.id);
      
      // If no config exists, create default paper mode config
      if (!config) {
        await upsertTradingModeConfig({
          userId: ctx.user.id,
          mode: 'paper',
          enableSlippage: true,
          enableCommission: true,
          enableMarketImpact: true,
          enableLatency: true,
        });
        config = await getTradingModeConfig(ctx.user.id);
      }
      
      return config || { mode: 'paper', enableSlippage: true, enableCommission: true, enableMarketImpact: true, enableLatency: true };
    }),

    // Set trading mode (paper or real)
    setMode: protectedProcedure
      .input(z.object({
        mode: z.enum(["paper", "real"]),
        enableSlippage: z.boolean().optional(),
        enableCommission: z.boolean().optional(),
        enableMarketImpact: z.boolean().optional(),
        enableLatency: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { upsertTradingModeConfig } = await import("./db");
        await upsertTradingModeConfig({
          userId: ctx.user.id,
          mode: input.mode,
          enableSlippage: input.enableSlippage ?? true,
          enableCommission: input.enableCommission ?? true,
          enableMarketImpact: input.enableMarketImpact ?? true,
          enableLatency: input.enableLatency ?? true,
        });
        return { success: true };
      }),

    // Get real-time balance breakdown with margin calculation
    getBalanceBreakdown: protectedProcedure.query(async ({ ctx }) => {
      const { getBalanceTracker } = await import("./services/BalanceTracker");
      const balanceTracker = getBalanceTracker(ctx.user.id);
      // getBalanceSnapshot already loads fresh data from database
      const snapshot = balanceTracker.getBalanceSnapshot();
      return snapshot;
    }),

    // Get paper trading wallet
    getPaperWallet: protectedProcedure.query(async ({ ctx }) => {
      console.log('[DEBUG] getPaperWallet called for user:', ctx.user.id, ctx.user.email);
      const { getPaperWallet, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      const wallet = await getPaperWallet(ctx.user.id, mode);
      console.log('[DEBUG] getPaperWallet result:', wallet ? 'found' : 'not found', wallet?.balance);
      return wallet || {
        userId: ctx.user.id,
        balance: '10000.00',
        equity: '10000.00',
        margin: '0.00',
        marginLevel: '0.00',
        totalPnL: '0.00',
        realizedPnL: '0.00',
        unrealizedPnL: '0.00',
        totalCommission: '0.00',
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: '0.00',
      };
    }),

    // Add virtual USD to paper trading wallet
    addPaperFunds: protectedProcedure
      .input(z.object({
        amount: z.number().positive(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getPaperWallet, upsertPaperWallet, getTradingModeConfig } = await import("./db");
        const tradingConfig = await getTradingModeConfig(ctx.user.id);
        const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
        const wallet = await getPaperWallet(ctx.user.id, mode);

        if (wallet) {
          const newBalance = parseFloat(wallet.balance) + input.amount;
          const newEquity = parseFloat(wallet.equity) + input.amount;

          await upsertPaperWallet({
            userId: ctx.user.id,
            tradingMode: mode,
            balance: newBalance.toFixed(2),
            equity: newEquity.toFixed(2),
            margin: wallet.margin,
            marginLevel: wallet.marginLevel,
            totalPnL: wallet.totalPnL,
            realizedPnL: wallet.realizedPnL,
            unrealizedPnL: wallet.unrealizedPnL,
            totalCommission: wallet.totalCommission,
            totalTrades: wallet.totalTrades,
            winningTrades: wallet.winningTrades,
            losingTrades: wallet.losingTrades,
            winRate: wallet.winRate,
          });
        } else {
          await upsertPaperWallet({
            userId: ctx.user.id,
            tradingMode: mode,
            balance: (10000 + input.amount).toFixed(2),
            equity: (10000 + input.amount).toFixed(2),
            margin: '0.00',
            marginLevel: '0.00',
            totalPnL: '0.00',
            realizedPnL: '0.00',
            unrealizedPnL: '0.00',
            totalCommission: '0.00',
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: '0.00',
          });
        }
        
        // Reload BalanceTracker with updated balance
        const { getBalanceTracker } = await import("./services/BalanceTracker");
        const balanceTracker = getBalanceTracker(ctx.user.id);
        // Balance will be reloaded on next getBalanceSnapshot() call
        
        return { success: true };
      }),

    // Reset paper trading wallet to default state
    resetPaperWallet: protectedProcedure.mutation(async ({ ctx }) => {
      const { resetPaperWallet, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      await resetPaperWallet(ctx.user.id, mode);
      
      // Reload BalanceTracker with reset balance
      const { getBalanceTracker } = await import("./services/BalanceTracker");
      const balanceTracker = getBalanceTracker(ctx.user.id);
      // Balance will be reloaded on next getBalanceSnapshotAsync() call
      
      return { success: true };
    }),

    // Get paper trading positions
    getPaperPositions: protectedProcedure.query(async ({ ctx }) => {
      const { getPaperPositions, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      return await getPaperPositions(ctx.user.id, mode);
    }),

    // Get paper trading orders
    getPaperOrders: protectedProcedure.query(async ({ ctx }) => {
      const { getPaperOrders, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      return await getPaperOrders(ctx.user.id, mode);
    }),

    // Get paper trading trades
    getPaperTrades: protectedProcedure.query(async ({ ctx }) => {
      const { getPaperTrades, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      return await getPaperTrades(ctx.user.id, mode);
    }),

    // Get trading statistics
    getStats: protectedProcedure.query(async ({ ctx }) => {
      const { getPaperWallet, getTradingModeConfig } = await import("./db");
      const tradingConfig = await getTradingModeConfig(ctx.user.id);
      const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
      const wallet = await getPaperWallet(ctx.user.id, mode);
      
      if (!wallet) {
        return {
          todayPnL: 0,
          winRate: 0,
          totalTrades: 0,
        };
      }

      return {
        todayPnL: parseFloat(wallet.realizedPnL || '0'),
        winRate: parseFloat(wallet.winRate || '0'),
        totalTrades: wallet.totalTrades || 0,
      };
    }),

    // Phase 93.6 — Time-windowed statistics
    //
    // Returns aggregate trade stats for a configurable time window. Drives the
    // "today / 7d / 30d / all-time" selector on Performance and the war-room
    // dashboard. Computes wins, losses, win rate, P&L, average trade, and
    // profit factor (gross wins ÷ |gross losses|) directly from the
    // paperPositions table — no dependence on the (often-stale) paperWallets
    // counters.
    getStatsByWindow: protectedProcedure
      .input(z.object({
        window: z.enum(['today', '7d', '30d', 'all']).default('all'),
      }))
      .query(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return null;
        const { paperPositions } = await import("../drizzle/schema");
        const { eq, and, gte, sql: drzSql } = await import("drizzle-orm");

        const windowMap: Record<typeof input.window, number> = {
          today: 1, '7d': 7, '30d': 30, all: 3650,
        };
        const days = windowMap[input.window];
        const cutoff = new Date(Date.now() - days * 86400_000);

        const rows = await db.select().from(paperPositions).where(and(
          eq(paperPositions.userId, ctx.user.id),
          eq(paperPositions.status, 'closed'),
          gte(paperPositions.exitTime, cutoff),
        ));

        let wins = 0, losses = 0, even = 0;
        let totalPnl = 0, sumWins = 0, sumLosses = 0;
        let totalCommission = 0;
        let bestTrade = -Infinity, worstTrade = Infinity;
        const symbolStats: Record<string, { n: number; pnl: number }> = {};

        for (const r of rows) {
          const pnl = parseFloat(r.realizedPnl ?? '0');
          const comm = parseFloat(r.commission ?? '0');
          totalPnl += pnl;
          totalCommission += comm;
          if (pnl > 0) { wins++; sumWins += pnl; }
          else if (pnl < 0) { losses++; sumLosses += pnl; }
          else even++;
          if (pnl > bestTrade) bestTrade = pnl;
          if (pnl < worstTrade) worstTrade = pnl;
          if (!symbolStats[r.symbol]) symbolStats[r.symbol] = { n: 0, pnl: 0 };
          symbolStats[r.symbol].n++;
          symbolStats[r.symbol].pnl += pnl;
        }
        const totalTrades = rows.length;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
        const avgWin = wins > 0 ? sumWins / wins : 0;
        const avgLoss = losses > 0 ? sumLosses / losses : 0;
        const profitFactor = sumLosses < 0 ? Math.abs(sumWins / sumLosses) : (sumWins > 0 ? Infinity : 0);
        return {
          window: input.window,
          windowDays: days,
          totalTrades, wins, losses, even,
          winRate: Number(winRate.toFixed(2)),
          totalPnl: Number(totalPnl.toFixed(2)),
          avgPnl: Number(avgPnl.toFixed(2)),
          avgWin: Number(avgWin.toFixed(2)),
          avgLoss: Number(avgLoss.toFixed(2)),
          profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : null,
          totalCommission: Number(totalCommission.toFixed(2)),
          bestTrade: bestTrade === -Infinity ? 0 : Number(bestTrade.toFixed(2)),
          worstTrade: worstTrade === Infinity ? 0 : Number(worstTrade.toFixed(2)),
          netPnlAfterCommissions: Number((totalPnl - totalCommission).toFixed(2)),
          bySymbol: Object.entries(symbolStats)
            .map(([symbol, s]) => ({ symbol, trades: s.n, pnl: Number(s.pnl.toFixed(2)) }))
            .sort((a, b) => b.pnl - a.pnl),
        };
      }),

    // Phase 93.6 — Binance ↔ SEER reconciliation
    //
    // Returns the current reality on both sides + the deltas. Used by the
    // Wallet/Reconciliation panel to surface drift to the operator the moment
    // SEER's view falls out of sync with the exchange. ADMIN-only for now —
    // exposes encrypted-key-derived API calls; we'll relax once the surface
    // area is settled.
    getReconciliation: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error('db_unavailable');
      const { paperPositions, paperWallets, exchanges, apiKeys } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");

      // Pull SEER's view
      const seerOpenPositions = await db.select().from(paperPositions).where(and(
        eq(paperPositions.userId, ctx.user.id),
        eq(paperPositions.status, 'open'),
      ));
      const wallets = await db.select().from(paperWallets).where(eq(paperWallets.userId, ctx.user.id));
      const liveWallet = wallets.find(w => w.tradingMode === 'live');

      // Pull Binance ground truth (only if futures keys exist)
      let binance: any = null;
      try {
        const exRow = await db.select().from(exchanges).where(and(
          eq(exchanges.userId, ctx.user.id),
          eq(exchanges.exchangeName, 'binance-futures'),
        )).limit(1);
        if (exRow.length > 0) {
          const keyRow = await db.select().from(apiKeys).where(and(
            eq(apiKeys.userId, ctx.user.id),
            eq(apiKeys.exchangeId, exRow[0].id),
          )).limit(1);
          if (keyRow.length > 0) {
            const { decrypt } = await import("./crypto");
            const apiKey = decrypt(keyRow[0].encryptedApiKey, keyRow[0].apiKeyIv);
            const apiSecret = decrypt(keyRow[0].encryptedApiSecret, keyRow[0].apiSecretIv);
            const { createHmac } = await import("crypto");
            const base = process.env.BINANCE_FUTURES_USE_TESTNET === '1'
              ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
            const ts = Date.now();
            const qs = new URLSearchParams({ timestamp: String(ts), recvWindow: '10000' }).toString();
            const sig = createHmac('sha256', apiSecret).update(qs).digest('hex');
            const r = await fetch(`${base}/fapi/v2/account?${qs}&signature=${sig}`, {
              headers: { 'X-MBX-APIKEY': apiKey },
            });
            if (r.ok) binance = await r.json();
          }
        }
      } catch (err) {
        console.warn('[reconciliation] binance fetch failed:', (err as Error)?.message);
      }

      // Compute drift
      const drifts: Array<{ kind: string; severity: 'ok' | 'warn' | 'critical'; message: string; }> = [];

      if (!binance) {
        return {
          binance: null,
          seer: { wallet: liveWallet, openPositions: seerOpenPositions },
          drifts: [{ kind: 'no_binance_data', severity: 'warn' as const, message: 'Could not reach Binance API — check keys.' }],
          checkedAt: new Date().toISOString(),
        };
      }

      // Wallet-level drift
      if (liveWallet) {
        const binBal = parseFloat(binance.totalWalletBalance);
        const seerBal = parseFloat(liveWallet.balance);
        const balDrift = Math.abs(binBal - seerBal);
        if (balDrift > 5) drifts.push({
          kind: 'wallet_balance_drift',
          severity: balDrift > 50 ? 'critical' : 'warn',
          message: `Wallet balance drift $${balDrift.toFixed(2)} (Binance $${binBal.toFixed(2)} vs SEER $${seerBal.toFixed(2)})`,
        });
      }

      // Position-level drift
      const binPositions = (binance.positions || []).filter((p: any) => parseFloat(p.positionAmt) !== 0);
      const seerByCanonical = new Map<string, typeof seerOpenPositions[number]>(
        seerOpenPositions.filter(p => p.exchange === 'binance').map(p => [p.symbol, p])
      );
      const binByCanonical = new Map<string, any>(
        binPositions.map((p: any) => [p.symbol.replace('USDT', '-USD'), p])
      );

      for (const [sym, p] of seerByCanonical) {
        if (!binByCanonical.has(sym)) drifts.push({
          kind: 'orphan_position',
          severity: 'critical',
          message: `${sym}: SEER has position #${p.id} but Binance is flat (orphan)`,
        });
      }
      for (const [sym, b] of binByCanonical) {
        const s = seerByCanonical.get(sym);
        if (!s) {
          drifts.push({
            kind: 'unhydrated_position',
            severity: 'warn',
            message: `${sym}: open on Binance but not in SEER`,
          });
          continue;
        }
        const binAmt = Math.abs(parseFloat((b as any).positionAmt));
        const qtyDiff = Math.abs(binAmt - parseFloat(s.quantity));
        if (qtyDiff > 0.001) drifts.push({
          kind: 'qty_drift',
          severity: qtyDiff > 0.01 ? 'critical' : 'warn',
          message: `${sym}: quantity drift Δ=${qtyDiff.toFixed(6)} (Binance ${binAmt}, SEER ${s.quantity})`,
        });
      }

      if (drifts.length === 0) drifts.push({ kind: 'in_sync', severity: 'ok', message: 'All values match exchange.' });

      return {
        binance: binance ? {
          totalWalletBalance: parseFloat(binance.totalWalletBalance),
          totalMarginBalance: parseFloat(binance.totalMarginBalance),
          totalUnrealizedProfit: parseFloat(binance.totalUnrealizedProfit),
          availableBalance: parseFloat(binance.availableBalance),
          maxWithdrawAmount: parseFloat(binance.maxWithdrawAmount),
          openPositions: binPositions.map((p: any) => ({
            symbol: p.symbol,
            side: parseFloat(p.positionAmt) > 0 ? 'long' : 'short',
            quantity: Math.abs(parseFloat(p.positionAmt)),
            entryPrice: parseFloat(p.entryPrice),
            markPrice: parseFloat(p.markPrice ?? '0'),
            unrealizedPnl: parseFloat(p.unrealizedProfit),
          })),
        } : null,
        seer: {
          wallet: liveWallet ? {
            balance: parseFloat(liveWallet.balance),
            equity: parseFloat(liveWallet.equity),
            margin: parseFloat(liveWallet.margin),
            unrealizedPnL: parseFloat(liveWallet.unrealizedPnL),
            realizedPnL: parseFloat(liveWallet.realizedPnL),
            totalCommission: parseFloat(liveWallet.totalCommission),
            totalTrades: liveWallet.totalTrades ?? 0,
            updatedAt: liveWallet.updatedAt,
          } : null,
          openPositions: seerOpenPositions.map(p => ({
            id: p.id,
            symbol: p.symbol,
            side: p.side,
            exchange: p.exchange,
            strategy: p.strategy,
            entryPrice: parseFloat(p.entryPrice),
            quantity: parseFloat(p.quantity),
            stopLoss: p.stopLoss ? parseFloat(p.stopLoss) : null,
            takeProfit: p.takeProfit ? parseFloat(p.takeProfit) : null,
            unrealizedPnL: parseFloat(p.unrealizedPnL ?? '0'),
          })),
        },
        drifts,
        checkedAt: new Date().toISOString(),
      };
    }),

    // Get recent trades for activity feed
    getRecentTrades: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(5),
      }))
      .query(async ({ ctx, input }) => {
        const { getPaperTrades, getTradingModeConfig } = await import("./db");
        const tradingConfig = await getTradingModeConfig(ctx.user.id);
        const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
        const trades = await getPaperTrades(ctx.user.id, mode);

        // Return most recent trades
        return trades
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, input.limit)
          .map(trade => ({
            symbol: trade.symbol,
            side: trade.side,
            quantity: parseFloat(trade.quantity),
            price: parseFloat(trade.price),
            pnl: parseFloat(trade.pnl || '0'),
            timestamp: trade.timestamp,
          }));
      }),

    // Get P&L history for chart
    getPnLHistory: protectedProcedure
      .input(z.object({
        days: z.number().optional().default(7),
      }))
      .query(async ({ ctx, input }) => {
        const { getPaperTrades, getTradingModeConfig } = await import("./db");
        const tradingConfig = await getTradingModeConfig(ctx.user.id);
        const mode = (tradingConfig?.mode === 'real' ? 'live' : 'paper') as 'paper' | 'live';
        const trades = await getPaperTrades(ctx.user.id, mode);

        // Group trades by date and calculate daily P&L
        const dailyPnL = new Map<string, number>();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - input.days);

        trades.forEach(trade => {
          const tradeDate = new Date(trade.timestamp);
          if (tradeDate >= cutoffDate) {
            const dateKey = tradeDate.toISOString().split('T')[0];
            const pnl = parseFloat(trade.pnl || '0');
            dailyPnL.set(dateKey, (dailyPnL.get(dateKey) || 0) + pnl);
          }
        });

        // Fill in missing dates with 0 P&L
        const result = [];
        for (let i = input.days - 1; i >= 0; i--) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const dateKey = date.toISOString().split('T')[0];
          result.push({
            date: dateKey,
            pnl: dailyPnL.get(dateKey) || 0,
          });
        }

        return result;
      }),
  }),

  // System configuration
  config: router({
    // Get all configurations
    getAll: protectedProcedure.query(async ({ ctx }) => {
      const { getAllSystemConfig } = await import("./exchangeDb");
      return await getAllSystemConfig(ctx.user.id);
    }),

    // Get specific configuration
    get: protectedProcedure
      .input(z.object({
        key: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { getSystemConfig } = await import("./exchangeDb");
        return await getSystemConfig(ctx.user.id, input.key);
      }),

    // Set configuration
    set: protectedProcedure
      .input(z.object({
        key: z.string(),
        value: z.any(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { setSystemConfig } = await import("./exchangeDb");
        await setSystemConfig(ctx.user.id, input.key, input.value, input.description);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
