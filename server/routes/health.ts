import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

/**
 * Health check endpoint for monitoring and load balancers
 * Returns 200 OK if server is healthy, 503 Service Unavailable if not
 */
router.get('/health', async (req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    },
    checks: {
      database: false,
      server: true
    }
  };

  // Check database connection
  try {
    const db = await getDb();
    if (db) {
      // Simple query to verify database is accessible
      await db.execute('SELECT 1');
      health.checks.database = true;
    }
  } catch (error) {
    console.error('[Health] Database check failed:', error);
    health.status = 'degraded';
  }

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Trading-pipeline health — is the engine actually making trades?
 *
 * The basic /health endpoint only tells you "process alive + DB reachable,"
 * which is true even when the pipeline has been silent for 3 days (the
 * 2026-04-21→04-24 incident). This endpoint exposes the watchdog's latest
 * snapshot so external monitoring can alert when no trades / high-rejection.
 *
 * Returns 200 when healthy, 503 when the watchdog has any alarm set.
 * `?window=60` overrides the trade-silence window in minutes for queries.
 */
router.get('/health/trading', async (_req: Request, res: Response) => {
  try {
    const { getLastHealthSnapshot, computeHealthSnapshot, DEFAULT_WATCHDOG_CONFIG } =
      await import('../services/TradingSilenceWatchdog');
    // Prefer the last cached snapshot (produced by the watchdog loop) for speed,
    // fall back to computing live if watchdog hasn't ticked yet.
    const snapshot = getLastHealthSnapshot() ?? computeHealthSnapshot(DEFAULT_WATCHDOG_CONFIG);
    const statusCode = snapshot.healthy ? 200 : 503;
    res.status(statusCode).json(snapshot);
  } catch (error) {
    res.status(500).json({
      healthy: false,
      error: error instanceof Error ? error.message : 'watchdog_unavailable',
    });
  }
});

/**
 * Price-feed health — per-source tick rates, latency, liveness.
 *
 * Phase 14: the 2026-04-21→04-24 silence was primarily a DATA problem. Coinbase
 * WS gapped every 3s, CoinGecko 429'd for 120s at a time, and no single number
 * surfaced that fragility. This endpoint dumps PriceFabric's per-source health
 * so operators can see which feeds are live and which are starving the agents.
 *
 * Returns 200 when at least one source is marked alive; 503 when the fabric is
 * stopped OR every source is dead (agents have no input → consensus impossible).
 */
router.get('/health/feeds', async (_req: Request, res: Response) => {
  try {
    const { getPriceFabric } = await import('../services/PriceFabric');
    const status = getPriceFabric().getStatus();
    const anyAlive = status.sources.some((s) => s.isAlive);
    const statusCode = status.isRunning && anyAlive ? 200 : 503;
    res.status(statusCode).json({
      healthy: statusCode === 200,
      ...status,
    });
  } catch (error) {
    res.status(500).json({
      healthy: false,
      error: error instanceof Error ? error.message : 'price_fabric_unavailable',
    });
  }
});

/**
 * Readiness check - similar to health but stricter
 * Used by Kubernetes/orchestrators to determine if pod can receive traffic
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        ready: false,
        reason: 'Database not connected'
      });
    }

    // Verify database is responsive
    await db.execute('SELECT 1');

    res.status(200).json({
      ready: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ready: false,
      reason: 'Database query failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Liveness check - minimal check to see if process is alive
 * Used by Kubernetes to determine if pod should be restarted
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString()
  });
});

/**
 * Phase 16: Agent Alpha Validation results
 * Returns per-agent statistical alpha analysis
 */
router.get('/alpha-validation', async (req: Request, res: Response) => {
  try {
    const { getAgentAlphaValidator } = await import('../services/AgentAlphaValidator');
    const validator = getAgentAlphaValidator();
    const result = validator.getLastValidation();

    if (!result) {
      return res.status(200).json({
        status: 'pending',
        message: 'Alpha validation has not run yet',
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      status: 'complete',
      timestamp: new Date(result.timestamp).toISOString(),
      totalTradesAnalyzed: result.totalTradesAnalyzed,
      systemMetrics: {
        winRate: result.systemWinRate,
        sharpeRatio: result.systemSharpe,
        profitFactor: result.systemProfitFactor,
      },
      agentsWithAlpha: result.agentsWithAlpha,
      agentsToBoost: result.agentsToBoost,
      agentsToPrune: result.agentsToPrune,
      agentReports: result.agentReports.map(r => ({
        agentName: r.agentName,
        alphaGrade: r.alphaGrade,
        recommendation: r.recommendation,
        totalTrades: r.totalTrades,
        directionalAccuracy: r.directionalAccuracy,
        sharpeRatio: r.sharpeRatio,
        profitFactor: r.profitFactor,
        informationCoefficient: r.informationCoefficient,
        pValue: r.pValue,
        isSignificant: r.isSignificant,
        hasAlpha: r.hasAlpha,
        valueAdded: r.valueAdded,
        rollingWinRate: r.rollingWinRate,
      })),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 16: Unified platform health (from PlatformHealthAggregator)
 * Returns all component health statuses, alerts, and webhook config
 */
router.get('/platform-health', async (req: Request, res: Response) => {
  try {
    const { getPlatformHealthAggregator } = await import('../services/PlatformHealthAggregator');
    const aggregator = getPlatformHealthAggregator();
    const health = aggregator.getHealth();

    if (!health) {
      return res.status(200).json({
        status: 'starting',
        message: 'Health aggregator has not completed first check yet',
      });
    }

    res.status(200).json({
      overallStatus: health.overallStatus,
      timestamp: new Date(health.timestamp).toISOString(),
      uptimeMs: health.uptimeMs,
      components: health.components,
      alerts: health.alerts,
      webhookCount: aggregator.getWebhooks().length,
      recentAlerts: aggregator.getAlertHistory().slice(-10),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 16: Adaptive consensus engine status
 * Returns current agent weight adjustments from alpha validation
 */
router.get('/consensus-weights', async (req: Request, res: Response) => {
  try {
    const { getAdaptiveConsensusEngine } = await import('../services/AdaptiveConsensusEngine');
    const engine = getAdaptiveConsensusEngine();
    const status = engine.getStatus();

    res.status(200).json({
      isActive: status.isActive,
      lastUpdate: status.lastUpdate > 0 ? new Date(status.lastUpdate).toISOString() : null,
      totalUpdates: status.totalUpdates,
      boostedAgents: status.boostedAgents,
      prunedAgents: status.prunedAgents,
      weights: status.currentWeights.map(w => ({
        agentName: w.agentName,
        baseWeight: w.baseWeight,
        alphaMultiplier: w.alphaMultiplier,
        rollingMultiplier: w.rollingMultiplier,
        finalWeight: w.finalWeight,
        reason: w.reason,
      })),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 17: VaR Risk Gate status
 * Returns current portfolio VaR metrics and recent return data
 */
router.get('/var-status', async (req: Request, res: Response) => {
  try {
    const { getVaRStatus } = await import('../services/VaRRiskGate');
    const { getTradingConfig } = await import('../config/TradingConfig');
    const status = getVaRStatus();
    const config = getTradingConfig().varLimits;

    res.status(200).json({
      enabled: config.enabled,
      dataPoints: status.dataPoints,
      recentVolatility: status.recentVolatility,
      recentMeanReturn: status.recentMeanReturn,
      limits: {
        maxPortfolioVaR95Percent: config.maxPortfolioVaR95Percent,
        maxIncrementalVaR95Percent: config.maxIncrementalVaR95Percent,
        maxPortfolioCVaR95Percent: config.maxPortfolioCVaR95Percent,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 17: Dynamic Correlation matrix and status
 * Returns rolling correlations between trading pairs
 */
router.get('/correlation-matrix', async (req: Request, res: Response) => {
  try {
    const { getDynamicCorrelationTracker } = await import('../services/DynamicCorrelationTracker');
    const tracker = getDynamicCorrelationTracker();
    const matrix = tracker.getCorrelationMatrix();
    const status = tracker.getStatus();

    res.status(200).json({
      matrix: {
        symbols: matrix.symbols,
        correlations: matrix.matrix,
        windowMinutes: matrix.windowMinutes,
        dataPoints: matrix.dataPoints,
      },
      trackedSymbols: status.trackedSymbols,
      openExposure: status.openExposure,
      correlationPairs: status.correlationPairs.map(p => ({
        symbolA: p.symbolA,
        symbolB: p.symbolB,
        correlation: p.correlation,
        dataPoints: p.dataPoints,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 17: Walk-Forward Optimization results
 * Returns parameter stability, overfit detection, and recommended parameters
 */
router.get('/walk-forward', async (req: Request, res: Response) => {
  try {
    const { getWalkForwardOptimizer } = await import('../services/WalkForwardOptimizer');
    const result = getWalkForwardOptimizer().getLastResult();

    if (!result) {
      return res.status(200).json({
        status: 'pending',
        message: 'Walk-forward optimization has not run yet',
      });
    }

    res.status(200).json({
      status: 'complete',
      timestamp: new Date(result.timestamp).toISOString(),
      totalWindows: result.totalWindows,
      avgInSampleSharpe: result.avgInSampleSharpe,
      avgOutOfSampleSharpe: result.avgOutOfSampleSharpe,
      avgOverfitRatio: result.avgOverfitRatio,
      maxParameterDrift: result.maxParameterDrift,
      isOverfit: result.isOverfit,
      isUnstable: result.isUnstable,
      confidence: result.confidence,
      recommendedParams: result.recommendedParams,
      windows: result.windowResults.map(w => ({
        trainTrades: w.trainTrades,
        testTrades: w.testTrades,
        inSampleSharpe: w.inSampleSharpe,
        outOfSampleSharpe: w.outOfSampleSharpe,
        overfitRatio: w.overfitRatio,
        parameterDrift: w.parameterDrift,
      })),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Phase 17: Unified TradingConfig view
 * Returns current active configuration for all trading parameters
 */
router.get('/trading-config', async (req: Request, res: Response) => {
  try {
    const { getTradingConfig } = await import('../config/TradingConfig');
    const config = getTradingConfig();
    res.status(200).json({
      config,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Signal pipeline diagnostic endpoint
 * Returns the current state of the signal generation pipeline
 */
router.get('/signal-diagnostic', async (req: Request, res: Response) => {
  try {
    const { coinbasePublicWebSocket } = await import('../services/CoinbasePublicWebSocket');
    const { getGlobalMarketEngine } = await import('../services/GlobalMarketEngine');
    const { getAllCachedConsensus } = await import('../services/AutomatedSignalProcessor');
    const { getUserSessionManager } = await import('../services/UserSessionManager');

    const wsStatus = coinbasePublicWebSocket.getStatus();
    const engine = getGlobalMarketEngine();
    const symbols = engine.getSymbols();
    const sessionMgr = getUserSessionManager();

    const signalData: Record<string, any> = {};
    for (const sym of symbols) {
      const signals = engine.getLatestSignals(sym);
      const analyzer = engine.getAnalyzer(sym);
      const analyzerStatus = analyzer?.getStatus();
      signalData[sym] = {
        signalCount: signals.length,
        signals: signals.map(s => ({
          agent: s.agentName,
          signal: s.signal,
          confidence: s.confidence,
          reasoning: (s.reasoning || '').slice(0, 100),
          timestamp: s.timestamp,
        })),
        analyzerRunning: analyzerStatus?.running,
        agentCount: analyzerStatus?.agentCount,
        tickCount: analyzerStatus?.tickCount,
        cachedSlowSignalCount: analyzerStatus?.cachedSlowSignalCount,
        lastSlowAgentUpdate: analyzerStatus?.lastSlowAgentUpdate,
        nextSlowAgentUpdate: analyzerStatus?.nextSlowAgentUpdate,
        agentHealth: analyzerStatus?.agentHealth,
      };
    }

    const consensusCache = getAllCachedConsensus();
    const consensusData: Record<string, any> = {};
    consensusCache.forEach((data, symbol) => {
      consensusData[symbol] = {
        direction: data.direction,
        consensus: data.consensus,
        timestamp: data.timestamp,
      };
    });

    const engineStatus = engine.getStatus();

    res.json({
      coinbaseWS: {
        isRunning: wsStatus.isRunning,
        isConnected: wsStatus.isConnected,
        isHealthy: coinbasePublicWebSocket.isHealthy(),
        symbols: wsStatus.symbols,
        tickCount: wsStatus.tickCount,
        messageCount: wsStatus.messageCount,
        lastMessageTime: wsStatus.lastMessageTime,
        timeSinceLastMessage: Date.now() - wsStatus.lastMessageTime,
      },
      globalMarketEngine: {
        isRunning: engineStatus.isRunning,
        uptimeMs: engineStatus.uptimeMs,
        analyzerCount: engineStatus.analyzerStatuses.length,
        _startState: (engineStatus as any)._startState,
        _stopReason: (engineStatus as any)._stopReason,
        symbols,
        signalData,
      },
      consensusCache: consensusData,
      sessions: {
        total: (sessionMgr as any).getSessionCount?.() || 'N/A',
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});


export { router as healthRouter };
