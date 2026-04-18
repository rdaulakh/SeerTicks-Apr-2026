/**
 * SEER Multi-Exchange Router — Phase 14D
 * 
 * tRPC procedures for multi-exchange, multi-symbol trading engine.
 * 
 * Phase 14D: ALL endpoints now use EngineAdapter (wraps GlobalMarketEngine + UserTradingSession).
 * Legacy SEERMultiEngine dependency fully removed.
 */

import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../_core/trpc';
import { getEngineAdapter, getExistingAdapter } from '../services/EngineAdapter';
import { getPerformanceMonitor } from '../services/PerformanceMonitor';

// Phase 14D: Helper to get GlobalMarketEngine status (platform-level, no userId)
async function getGlobalEngineStatus() {
  try {
    const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
    return getGlobalMarketEngine().getStatus();
  } catch {
    return null;
  }
}

export const seerMultiRouter = router({
  /**
   * Get current status
   * Uses EngineAdapter (Phase 14D) — no legacy engine dependency
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const adapter = await getEngineAdapter(ctx.user.id);
      const status = adapter.getStatus();
      const globalStatus = await getGlobalEngineStatus();

      // Include symbol states with signals/consensus in the status response
      // This eliminates the need for a separate getSymbolStates query
      const symbolStatesObj = adapter.getSymbolStates();
      const symbolStates = Object.values(symbolStatesObj);


      return {
        running: true,
        isRunning: true,
        startedAt: globalStatus ? new Date(Date.now() - globalStatus.uptimeMs).toISOString() : new Date().toISOString(),
        pairs: status.symbols.map((s: string) => ({ symbol: s, exchange: 'coinbase' })),
        exchanges: ['coinbase'],
        health: {
          lastSignalTimestamp: status.lastSignalProcessed,
          totalSignalsGenerated: status.totalTradesExecuted + status.totalTradesRejected,
          signalTimeoutMs: 300000,
          isHealthy: true,
        },
        cachedExchangeCount: 1,
        cachedTradingPairCount: status.symbolCount,
        architecture: 'global',
        autoTradingEnabled: status.autoTrading,
        tradingMode: status.mode,
        walletBalance: status.walletBalance,
        symbolStates,
      };
    } catch (error) {
      // Fallback: Return platform-level status from GlobalMarketEngine
      const globalStatus = await getGlobalEngineStatus();
      if (globalStatus && globalStatus.isRunning) {
        return {
          running: true,
          isRunning: true,
          startedAt: new Date(Date.now() - globalStatus.uptimeMs).toISOString(),
          pairs: globalStatus.symbols.map(s => ({ symbol: s, exchange: 'coinbase' })),
          exchanges: ['coinbase'],
          health: {
            lastSignalTimestamp: globalStatus.lastHealthCheck,
            totalSignalsGenerated: 0,
            signalTimeoutMs: 300000,
            isHealthy: true,
          },
          cachedExchangeCount: 1,
          cachedTradingPairCount: globalStatus.symbols.length,
          architecture: 'global',
        };
      }
      return {
        running: false,
        isRunning: false,
        startedAt: null,
        pairs: [],
        exchanges: [],
        health: {
          lastSignalTimestamp: 0,
          totalSignalsGenerated: 0,
          signalTimeoutMs: 300000,
          isHealthy: false,
        },
        cachedExchangeCount: 0,
        cachedTradingPairCount: 0,
      };
    }
  }),

  /**
   * Get all symbol states
   */
  getSymbolStates: protectedProcedure.query(async ({ ctx }) => {
    try {
      const adapter = await getEngineAdapter(ctx.user.id);
      const states = adapter.getSymbolStates();
      return Object.values(states);
    } catch {
      return [];
    }
  }),

  /**
   * Get performance metrics for 50ms tick system
   */
  getPerformanceMetrics: protectedProcedure.query(async () => {
    const perfMonitor = getPerformanceMonitor();
    return perfMonitor.getMetrics();
  }),

  /**
   * Get performance history for charting
   */
  getPerformanceHistory: protectedProcedure
    .input(z.object({
      windowMs: z.number().positive().default(60000).optional(),
    }).optional())
    .query(async ({ input }) => {
      const perfMonitor = getPerformanceMonitor();
      return perfMonitor.getPerformanceHistory();
    }),

  /**
   * Get all positions
   */
  getPositions: protectedProcedure.query(async ({ ctx }) => {
    const adapter = await getEngineAdapter(ctx.user.id);
    return adapter.getAllPositions();
  }),

  /**
   * Get all positions with live market prices
   */
  getPositionsWithLivePrices: protectedProcedure.query(async ({ ctx }) => {
    const adapter = await getEngineAdapter(ctx.user.id);
    return adapter.getPositionsWithLivePrices();
  }),

  /**
   * Get agent health for a specific symbol
   */
  getAgentHealth: protectedProcedure
    .input(z.object({
      exchangeId: z.number(),
      symbol: z.string(),
    }))
    .query(async ({ ctx }) => {
      const adapter = await getEngineAdapter(ctx.user.id);
      return adapter.getAgentHealth();
    }),

  /**
   * Start the multi-exchange engine
   * Phase 14D: Platform is always on — this creates/returns a user session
   */
  start: protectedProcedure
    .input(z.object({
      totalCapital: z.number().positive().optional(),
      tickInterval: z.number().positive().default(5000).optional(),
      enableAutoTrading: z.boolean().default(false).optional(),
      enableLearning: z.boolean().default(true).optional(),
      allocationStrategy: z.enum(['equal', 'market_cap', 'performance']).default('equal').optional(),
    }).optional())
    .mutation(async ({ ctx }) => {
      console.log('[seerMultiRouter] START mutation called for userId:', ctx.user.id);
      const adapter = await getEngineAdapter(ctx.user.id);
      await adapter.start();
      return { success: true, status: adapter.getStatus() };
    }),

  /**
   * Stop the engine
   * Phase 14D: Platform stays on — this disables auto-trading for the user
   */
  stop: protectedProcedure
    .input(z.object({
      force: z.boolean().default(false).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      console.log('[seerMultiRouter] STOP mutation called for userId:', ctx.user.id, 'force:', input?.force);
      const adapter = await getEngineAdapter(ctx.user.id);
      adapter.updateConfig({ autoTrading: false });
      return { success: true, status: adapter.getStatus() };
    }),

  /**
   * Update configuration
   */
  updateConfig: protectedProcedure
    .input(z.object({
      totalCapital: z.number().positive().optional(),
      tickInterval: z.number().positive().optional(),
      enableAutoTrading: z.boolean().optional(),
      enableLearning: z.boolean().optional(),
      allocationStrategy: z.enum(['equal', 'market_cap', 'performance']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const adapter = await getEngineAdapter(ctx.user.id);
      adapter.updateConfig({
        autoTrading: input.enableAutoTrading,
        symbols: undefined,
      });
      return { success: true, status: adapter.getStatus() };
    }),

  /**
   * Open a new position
   */
  openPosition: protectedProcedure
    .input(z.object({
      symbol: z.string(),
      side: z.enum(['long', 'short']),
      quantity: z.number().positive(),
      price: z.number().positive(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
      strategy: z.string().default('Manual'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getPaperWallet, upsertPaperWallet, insertPaperPosition, insertPaperOrder, insertPaperTrade } = await import('../db');
      const { getBalanceTracker } = await import('../services/BalanceTracker');
      
      // Get wallet
      const wallet = await getPaperWallet(ctx.user.id);
      if (!wallet) {
        throw new Error('Wallet not found');
      }
      
      // Calculate position cost
      const positionCost = input.quantity * input.price;
      
      // Get real-time balance snapshot (includes margin used calculation)
      const balanceTracker = getBalanceTracker();
      balanceTracker.registerUser(ctx.user.id, 10000);
      const balanceSnapshot = balanceTracker.getBalanceSnapshot();
      
      // Institutional-grade validation: Check AVAILABLE balance
      if (positionCost > balanceSnapshot.availableBalance) {
        throw new Error(
          `Insufficient available balance. Required: $${positionCost.toFixed(2)}, ` +
          `Available: $${balanceSnapshot.availableBalance.toFixed(2)} ` +
          `(Total: $${balanceSnapshot.totalBalance.toFixed(2)}, Margin Used: $${balanceSnapshot.marginUsed.toFixed(2)})`
        );
      }
      
      // Institutional-grade validation: Minimum notional value ($100)
      const MIN_NOTIONAL = 100;
      if (positionCost < MIN_NOTIONAL) {
        throw new Error(`Position size $${positionCost.toFixed(2)} below minimum notional value $${MIN_NOTIONAL}. Institutional standards require positions ≥ $100 for execution efficiency.`);
      }
      
      // Institutional-grade validation: Minimum position size (1% of account)
      const MIN_POSITION_PERCENT = 0.01;
      const positionPercent = positionCost / balanceSnapshot.totalBalance;
      if (positionPercent < MIN_POSITION_PERCENT) {
        throw new Error(`Position size ${(positionPercent * 100).toFixed(2)}% below institutional minimum ${(MIN_POSITION_PERCENT * 100).toFixed(0)}%. Hedge fund best practices require positions ≥ 1% of account to prevent micro-positions.`);
      }
      
      // Institutional-grade validation: Maximum position size (20% of account)
      const MAX_POSITION_PERCENT = 0.20;
      if (positionPercent > MAX_POSITION_PERCENT) {
        throw new Error(`Position size ${(positionPercent * 100).toFixed(2)}% exceeds maximum ${(MAX_POSITION_PERCENT * 100).toFixed(0)}%. Risk management requires positions ≤ 20% of account.`);
      }
      
      // Institutional-grade validation: Minimum balance buffer (keep 10% available)
      const balanceAfter = balanceSnapshot.availableBalance - positionCost;
      const minBuffer = balanceSnapshot.totalBalance * 0.10;
      if (balanceAfter < minBuffer) {
        throw new Error(
          `Position would leave insufficient buffer. Minimum buffer: $${minBuffer.toFixed(2)}, ` +
          `Remaining after position: $${balanceAfter.toFixed(2)}. ` +
          `Institutional risk management requires maintaining 10% cash buffer.`
        );
      }
      
      // Deduct balance
      const currentBalance = parseFloat(wallet.balance);
      const newBalance = currentBalance - positionCost;
      await upsertPaperWallet({
        userId: ctx.user.id,
        balance: newBalance.toFixed(2),
        equity: newBalance.toFixed(2),
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
      
      // Create position
      await insertPaperPosition({
        userId: ctx.user.id,
        symbol: input.symbol,
        exchange: 'coinbase',
        side: input.side,
        entryPrice: input.price.toFixed(2),
        currentPrice: input.price.toFixed(2),
        quantity: input.quantity.toString(),
        stopLoss: input.stopLoss?.toFixed(2),
        takeProfit: input.takeProfit?.toFixed(2),
        status: 'open',
        strategy: input.strategy,
        entryTime: new Date(),
        unrealizedPnL: '0.00',
        unrealizedPnLPercent: '0.00',
      });
      
      // Record order
      const orderId = `paper_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await insertPaperOrder({
        userId: ctx.user.id,
        orderId,
        symbol: input.symbol,
        exchange: 'coinbase',
        type: 'market',
        side: input.side === 'long' ? 'buy' : 'sell',
        quantity: input.quantity.toString(),
        price: input.price.toFixed(2),
        status: 'filled',
        strategy: input.strategy,
        createdAt: new Date(),
        filledAt: new Date(),
      });
      
      // Record trade
      await insertPaperTrade({
        userId: ctx.user.id,
        orderId,
        symbol: input.symbol,
        side: input.side === 'long' ? 'buy' : 'sell',
        quantity: input.quantity.toString(),
        price: input.price.toFixed(2),
        pnl: '0.00',
        commission: '0.00',
        strategy: input.strategy,
        timestamp: new Date(),
      });
      
      return { success: true, newBalance: newBalance.toFixed(2) };
    }),

  /**
   * Adjust an existing position (change stop-loss or take-profit)
   */
  adjustPosition: protectedProcedure
    .input(z.object({
      positionId: z.string(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { paperPositions } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { getDb } = await import('../db');
      
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }
      
      const updateData: any = {};
      if (input.stopLoss !== undefined) {
        updateData.stopLoss = input.stopLoss.toFixed(2);
      }
      if (input.takeProfit !== undefined) {
        updateData.takeProfit = input.takeProfit.toFixed(2);
      }
      
      await db.update(paperPositions)
        .set(updateData)
        .where(eq(paperPositions.id, parseInt(input.positionId)));
      
      return { success: true };
    }),

  /**
   * Close a specific position
   */
  closePosition: protectedProcedure
    .input(z.object({
      exchangeId: z.number(),
      symbol: z.string(),
      positionId: z.string(),
      reason: z.string().default('Manual close'),
    }))
    .mutation(async ({ ctx, input }) => {
      const adapter = await getEngineAdapter(ctx.user.id);
      await adapter.closePosition(
        input.exchangeId,
        input.symbol,
        input.positionId,
        input.reason
      );
      return { success: true };
    }),

  /**
   * Close all open positions
   */
  closeAllPositions: protectedProcedure
    .input(z.object({
      reason: z.string().default('Close all positions'),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const adapter = await getEngineAdapter(ctx.user.id);
      const positions = await adapter.getAllPositions();
      
      const openPositions = positions.filter((p: any) => p.status === 'open');
      const results: { positionId: string; symbol: string; success: boolean; error?: string }[] = [];
      
      for (const position of openPositions) {
        try {
          await adapter.closePosition(
            1,
            position.symbol,
            position.id.toString(),
            input?.reason || 'Close all positions'
          );
          results.push({ positionId: position.id.toString(), symbol: position.symbol, success: true });
        } catch (error: any) {
          results.push({ 
            positionId: position.id.toString(), 
            symbol: position.symbol, 
            success: false, 
            error: error.message 
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      return { 
        success: failCount === 0, 
        totalClosed: successCount, 
        totalFailed: failCount,
        results 
      };
    }),

  /**
   * Rebalance capital allocation
   */
  rebalance: protectedProcedure.mutation(async ({ ctx }) => {
    const adapter = await getEngineAdapter(ctx.user.id);
    await adapter.rebalance();
    return { success: true, status: adapter.getStatus() };
  }),

  /**
   * Get all agents across all symbols
   * Uses GlobalMarketEngine (shared across all users)
   */
  getAllAgents: protectedProcedure.query(async ({ ctx }) => {
    const { AGENT_CATEGORIES } = await import('../services/AgentWeightManager');
    const fastSet = new Set(AGENT_CATEGORIES.FAST);

    // Transform raw AgentHealth + latestSignal into the shape AgentActivity.tsx expects
    function transformAgent(raw: any, symbol: string): any {
      const sig = raw.latestSignal;
      // Accuracy: successRate is 0-1 EMA, convert to 0-100 percentage
      const accuracyPct = Math.round((raw.successRate ?? 0) * 100);
      // Signals: use actual signal count from signalHistory, not tick count
      const signalCount = raw.signalCount ?? 0;
      // Uptime: raw.uptime is seconds since start, convert to percentage
      const uptimePct = raw.status === 'healthy' ? 99.9 : raw.status === 'degraded' ? 95.0 : 0;
      // Reasoning: show meaningful text, not generic placeholder
      const reasoning = sig?.reasoning || sig?.analysis || (sig ? `${raw.agentName} signal: ${sig.signal}` : 'Awaiting first signal...');
      // ExecutionScore: executionScore is 0-100, qualityScore is 0-1 (needs *100)
      const execScore = sig?.executionScore ?? (sig?.qualityScore != null ? Math.round(sig.qualityScore * 100) : 0);
      return {
        name: raw.agentName,
        symbol: `coinbase:${symbol}`,
        exchange: 'coinbase',
        tradingPair: symbol,
        type: fastSet.has(raw.agentName) ? 'fast' : 'slow',
        status: raw.status === 'healthy' ? 'active' : raw.status === 'degraded' ? 'idle' : 'error',
        lastUpdate: sig?.timestamp ? new Date(sig.timestamp).toISOString() : new Date().toISOString(),
        lastTickTime: raw.lastTickTime || 0,
        ticksReceived: raw.ticksReceived || 0,
        nextUpdate: undefined,
        signal: sig?.signal || 'neutral',
        confidence: Math.round((sig?.confidence ?? 0) * 100),
        executionScore: execScore,
        reasoning,
        metrics: {
          accuracy: accuracyPct,
          signals: signalCount,
          uptime: uptimePct,
        },
      };
    }

    try {
      const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
      const globalEngine = getGlobalMarketEngine();
      if (globalEngine.getStatus().isRunning) {
        const allAgents: any[] = [];
        for (const symbol of globalEngine.getSymbols()) {
          const analyzer = globalEngine.getAnalyzer(symbol);
          if (analyzer) {
            const agentManager = analyzer.getAgentManager();
            const agents = agentManager.getAllAgentsWithSignals();

            // Build a lookup of cachedSlowSignals from the analyzer for agents
            // whose signalHistory is empty (e.g., after errors or timeouts).
            // This ensures the frontend always shows the latest available signal.
            const cachedSignals = new Map<string, any>();
            try {
              const latestSignals = analyzer.getLatestSignals();
              for (const sig of latestSignals) {
                cachedSignals.set(sig.agentName, sig);
              }
            } catch { /* non-critical */ }

            for (const agent of agents) {
              // If agent has no signal in signalHistory, try cachedSlowSignals
              if (!agent.latestSignal && cachedSignals.has(agent.agentName)) {
                const cached = cachedSignals.get(agent.agentName);
                agent.latestSignal = {
                  agentName: cached.agentName,
                  symbol,
                  timestamp: cached.timestamp,
                  signal: cached.signal,
                  confidence: cached.confidence,
                  strength: cached.strength,
                  reasoning: cached.reasoning,
                  evidence: cached.evidence || {},
                  qualityScore: cached.qualityScore || 0,
                  processingTime: 0,
                  dataFreshness: (Date.now() - cached.timestamp) / 1000,
                  executionScore: cached.evidence?.executionScore || 50,
                };
              }
              allAgents.push(transformAgent(agent, symbol));
            }
          }
        }
        if (allAgents.length > 0) return allAgents;
      }
    } catch { /* Fall through */ }

    // Fallback via adapter
    try {
      const adapter = await getEngineAdapter(ctx.user.id);
      const rawAgents = await adapter.getAllAgentsStatus();
      return rawAgents.map((a: any) => transformAgent(a, a.symbol || 'BTC-USD'));
    } catch {
      return [];
    }
  }),

  /**
   * DEBUG: Get raw agent signals with full execution score data
   */
  debugAgentSignals: protectedProcedure.query(async ({ ctx }) => {
    const debug: any[] = [];
    const analyzerStatuses: any[] = [];

    try {
      const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
      const globalEngine = getGlobalMarketEngine();
      const globalStatus = globalEngine.getStatus();

      for (const symbol of globalEngine.getSymbols()) {
        const analyzer = globalEngine.getAnalyzer(symbol);
        if (!analyzer) continue;

        // Get analyzer-level status including slow agent cycle info
        const analyzerStatus = analyzer.getStatus();
        analyzerStatuses.push({
          symbol,
          running: analyzerStatus.running,
          cachedSlowSignalCount: analyzerStatus.cachedSlowSignalCount,
          lastSlowAgentUpdate: analyzerStatus.lastSlowAgentUpdate,
          nextSlowAgentUpdate: analyzerStatus.nextSlowAgentUpdate,
          tickCount: analyzerStatus.tickCount,
        });

        // Build cachedSlowSignals lookup
        const cachedSignals = new Map<string, any>();
        try {
          for (const sig of analyzer.getLatestSignals()) {
            cachedSignals.set(sig.agentName, sig);
          }
        } catch { /* non-critical */ }

        const agentManager = analyzer.getAgentManager();
        const agents = agentManager.getAllAgentsWithSignals();

        for (const agentData of agents) {
          const cached = cachedSignals.get(agentData.agentName);
          debug.push({
            agent: agentData.agentName,
            exchange: 'coinbase',
            symbol,
            latestSignal: agentData.latestSignal,
            hasExecutionScore: agentData.latestSignal?.executionScore !== undefined,
            executionScoreValue: agentData.latestSignal?.executionScore,
            executionScoreType: typeof agentData.latestSignal?.executionScore,
            confidence: agentData.latestSignal?.confidence,
            signal: agentData.latestSignal?.signal,
            signalHistoryCount: agentData.signalCount || 0,
            hasCachedSlowSignal: !!cached,
            cachedSlowConfidence: cached?.confidence ?? null,
            cachedSlowSignal: cached?.signal ?? null,
          });
        }
      }

      return {
        timestamp: new Date().toISOString(),
        engineRunning: globalStatus.isRunning,
        totalAgents: debug.length,
        analyzerStatuses,
        agents: debug,
      };
    } catch {
      return {
        timestamp: new Date().toISOString(),
        engineRunning: false,
        totalAgents: 0,
        analyzerStatuses: [],
        agents: [],
      };
    }
  }),

  /**
   * Get Strategy Orchestrator consensus state
   */
  getOrchestratorState: protectedProcedure
    .input(z.object({
      exchange: z.string().optional(),
      symbol: z.string().optional(),
    }).optional())
    .query(async ({ ctx }) => {
      try {
        const adapter = await getEngineAdapter(ctx.user.id);
        return adapter.getOrchestratorState();
      } catch {
        return null;
      }
    }),

  /**
   * Get comprehensive health metrics
   */
  getHealthMetrics: protectedProcedure.query(async ({ ctx }) => {
    try {
      const adapter = await getEngineAdapter(ctx.user.id);
      const status = adapter.getStatus();
      const agents = await adapter.getAllAgentsStatus();
      const globalStatus = await getGlobalEngineStatus();

      // Calculate uptime
      const uptimeMs = globalStatus?.uptimeMs || 0;
      const uptimeMinutes = Math.max(uptimeMs / 60000, 1);
      const signalRate = (status.totalTradesExecuted + status.totalTradesRejected) / uptimeMinutes;

      // Calculate agent health summary
      const agentHealthSummary = agents.reduce((acc: any, agent: any) => {
        const healthStatus = agent.status === 'active' ? 'healthy' : 'error';
        acc[healthStatus] = (acc[healthStatus] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get WebSocket connection status
      const wsConnectionCounts = {
        connected: status.isRunning ? status.symbolCount : 0,
        disconnected: status.isRunning ? 0 : status.symbolCount,
        reconnecting: 0,
      };

      // Get current latency from LatencyTracker
      let avgLatency = 0;
      try {
        const { getLatencyTracker } = await import('../utils/LatencyTracker');
        const latencyTracker = getLatencyTracker();
        const stats = latencyTracker.getStats();
        avgLatency = Math.round(stats.p50Latency);
      } catch { /* Ignore */ }

      return {
        system: {
          isRunning: status.isRunning,
          uptime: uptimeMs,
          uptimeFormatted: formatUptime(uptimeMs),
          startedAt: globalStatus ? new Date(Date.now() - globalStatus.uptimeMs).toISOString() : null,
        },
        signals: {
          totalGenerated: status.totalTradesExecuted + status.totalTradesRejected,
          ratePerMinute: Math.round(signalRate * 10) / 10,
          lastSignalAt: status.lastSignalProcessed,
          minutesSinceLastSignal: status.lastSignalProcessed > 0
            ? Math.floor((Date.now() - status.lastSignalProcessed) / 60000)
            : 0,
        },
        agents: {
          total: agents.length,
          healthy: agentHealthSummary.healthy || 0,
          warning: agentHealthSummary.warning || 0,
          error: agentHealthSummary.error || 0,
        },
        exchanges: {
          active: 1,
          tradingPairs: status.symbolCount,
        },
        websocket: {
          connected: wsConnectionCounts.connected > 0,
          connectedCount: wsConnectionCounts.connected,
          disconnectedCount: wsConnectionCounts.disconnected,
          reconnectingCount: wsConnectionCounts.reconnecting,
          latency: avgLatency,
        },
        health: {
          isHealthy: status.isRunning,
          warnings: status.isRunning ? [] : ['Engine not running'],
        },
      };
    } catch {
      return {
        system: { isRunning: false, uptime: 0, uptimeFormatted: '0s', startedAt: null },
        signals: { totalGenerated: 0, ratePerMinute: 0, lastSignalAt: 0, minutesSinceLastSignal: 0 },
        agents: { total: 0, healthy: 0, warning: 0, error: 0 },
        exchanges: { active: 0, tradingPairs: 0 },
        websocket: { connected: false, connectedCount: 0, disconnectedCount: 0, reconnectingCount: 0, latency: 0 },
        health: { isHealthy: false, warnings: ['Engine not running'] },
      };
    }
  }),

  /**
   * Get agent health details
   */
  getAgentHealthDetails: protectedProcedure.query(async ({ ctx }) => {
    try {
      const adapter = await getEngineAdapter(ctx.user.id);
      const agents = await adapter.getAllAgentsStatus();
      const now = Date.now();

      return agents.map((agent: any) => {
        const lastUpdateTime = agent.lastUpdate ? new Date(agent.lastUpdate).getTime() : 0;
        const timeSinceUpdate = lastUpdateTime > 0 ? now - lastUpdateTime : Infinity;
        const secondsSinceUpdate = Math.floor(timeSinceUpdate / 1000);
        const minutesSinceUpdate = Math.floor(timeSinceUpdate / 60000);

        // Determine health status
        let healthStatus: 'healthy' | 'warning' | 'error' = 'healthy';
        const warnings: string[] = [];

        if (agent.type === 'fast') {
          if (secondsSinceUpdate > 60) {
            healthStatus = 'error';
            warnings.push(`No update for ${minutesSinceUpdate} minutes`);
          } else if (secondsSinceUpdate > 10) {
            healthStatus = 'warning';
            warnings.push(`No update for ${secondsSinceUpdate} seconds`);
          }
        } else {
          if (minutesSinceUpdate > 10) {
            healthStatus = 'error';
            warnings.push(`No update for ${minutesSinceUpdate} minutes`);
          } else if (minutesSinceUpdate > 6) {
            healthStatus = 'warning';
            warnings.push(`No update for ${minutesSinceUpdate} minutes`);
          }
        }

        return {
          name: agent.name,
          symbol: agent.symbol,
          exchange: agent.exchange || 'coinbase',
          type: agent.type || 'slow',
          status: healthStatus,
          lastUpdate: agent.lastUpdate,
          secondsSinceUpdate,
          minutesSinceUpdate,
          signal: agent.lastSignal?.signal,
          confidence: agent.lastSignal?.confidence,
          metrics: agent.metrics,
          warnings,
        };
      });
    } catch {
      return [];
    }
  }),

  /**
   * Get historical signal generation data
   */
  getHealthHistory: protectedProcedure
    .input(z.object({
      hours: z.number().min(1).max(24).default(1),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const adapter = await getEngineAdapter(ctx.user.id);
        const history = await adapter.getSignalHistory();
        const hours = input?.hours || 1;
        const maxEntries = hours * 12;
        return history.slice(-maxEntries);
      } catch {
        return [];
      }
    }),

  /**
   * Get recent activity feed events
   */
  getActivityFeed: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const adapter = await getEngineAdapter(ctx.user.id);
        const feed = adapter.getActivityFeed();
        return feed.slice(0, input?.limit || 50);
      } catch {
        return [];
      }
    }),

  /**
   * Get latency metrics statistics
   */
  getLatencyMetrics: protectedProcedure.query(async () => {
    const { getLatencyTracker } = await import('../utils/LatencyTracker');
    const latencyTracker = getLatencyTracker();
    return latencyTracker.getStats();
  }),

  /**
   * Get recent latency traces
   */
  getLatencyTraces: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const { getLatencyTracker } = await import('../utils/LatencyTracker');
      const latencyTracker = getLatencyTracker();
      return latencyTracker.getRecentTraces(input?.limit || 100);
    }),

  /**
   * Get health metrics history (last 24 hours)
   */
  getHealthMetricsHistory: protectedProcedure
    .input(z.object({ hours: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('../db');
      const { healthMetrics } = await import('../../drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');
      
      const db = await getDb();
      if (!db) return [];
      
      const hours = input?.hours || 24;
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const metrics = await db
        .select()
        .from(healthMetrics)
        .where(eq(healthMetrics.userId, ctx.user.id))
        .orderBy(desc(healthMetrics.timestamp));
      
      return metrics
        .filter(m => m.timestamp >= cutoffTime)
        .reverse();
    }),

  /**
   * Get real news feed from NewsSentinel agent
   */
  getNewsFeed: protectedProcedure
    .input(z.object({
      symbol: z.string().default('BTC/USDT'),
    }).optional())
    .query(async ({ input }) => {
      const { NewsSentinel } = await import('../agents/NewsSentinel');
      const newsSentinel = new NewsSentinel();
      
      try {
        const newsFeed = await newsSentinel.getNewsFeed(input?.symbol || 'BTC/USDT');
        return newsFeed;
      } catch (error) {
        console.error('[seerMultiRouter] Failed to fetch news feed:', error);
        return {
          items: [],
          summary: {
            totalItems: 0,
            tier1Count: 0,
            tier2Count: 0,
            tier3Count: 0,
            avgImpactScore: 50,
            overallSentiment: 'neutral' as const,
          },
        };
      }
    }),
});

/**
 * Format uptime milliseconds to human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
