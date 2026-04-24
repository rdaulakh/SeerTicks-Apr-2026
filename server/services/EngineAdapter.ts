/**
 * EngineAdapter — Phase 14D + Phase 18 Event Pipeline Fix
 * 
 * Drop-in replacement for getSEERMultiEngine(userId).
 * Wraps UserTradingSession (per-user trade decisions) + GlobalMarketEngine (shared market data)
 * to expose the same API surface that routers, WebSocket, and backgroundEngineManager expect.
 * 
 * Phase 18 Fix: Added periodic broadcasting of all events that the frontend dashboard
 * expects via Socket.IO (agent_signals, consensus, status, trading_stats, activity,
 * position_prices, tick). Previously only trade_executed/exit_executed were forwarded.
 */

import { EventEmitter } from 'events';
import type { UserTradingSession } from './UserTradingSession';
import { AGENT_CATEGORIES } from './AgentWeightManager';

// Lazy singleton references (avoid circular imports)
let _globalEngine: any = null;
async function getGlobalEngine() {
  if (!_globalEngine) {
    const { getGlobalMarketEngine } = await import('./GlobalMarketEngine');
    _globalEngine = getGlobalMarketEngine();
  }
  return _globalEngine;
}

let _sessionManager: any = null;
async function getSessionMgr() {
  if (!_sessionManager) {
    const { getUserSessionManager } = await import('./UserSessionManager');
    _sessionManager = getUserSessionManager();
  }
  return _sessionManager;
}

/**
 * Per-user adapter instances, keyed by userId.
 * Each adapter wraps one UserTradingSession + the shared GlobalMarketEngine.
 */
const adapterInstances: Map<number, EngineAdapter> = new Map();

export class EngineAdapter extends EventEmitter {
  private session: UserTradingSession;
  private userId: number;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private _broadcastCount: number = 0;
  private readonly BROADCAST_INTERVAL_MS = 3000; // 3 seconds

  constructor(session: UserTradingSession) {
    super();
    this.session = session;
    this.userId = session.getUserId();

    // Forward session events to adapter listeners (WebSocket compatibility)
    this.session.on('trade_executed', (data: any) => this.emit('trade_executed', data));
    this.session.on('exit_executed', (data: any) => this.emit('exit_executed', data));
    this.session.on('signal_approved', (data: any) => this.emit('signal_approved', data));
    this.session.on('signal_rejected', (data: any) => this.emit('signal_rejected', data));
    this.session.on('position_prices', (data: any) => this.emit('position_prices', data));

    // Start periodic broadcasting of dashboard events
    this.startPeriodicBroadcast();
  }

  // ========================================
  // PERIODIC BROADCAST — Phase 18 Fix
  // Emits agent_signals, consensus, status, trading_stats, activity
  // to connected Socket.IO clients via PriceFeedService listeners
  // ========================================

  private startPeriodicBroadcast(): void {
    if (this.broadcastTimer) return;

    this.broadcastTimer = setInterval(async () => {
      try {
        await this.broadcastDashboardEvents();
      } catch (err) {
        // Non-critical — don't crash the adapter
      }
    }, this.BROADCAST_INTERVAL_MS);

    // Don't keep the process alive just for broadcasting
    if (this.broadcastTimer.unref) {
      this.broadcastTimer.unref();
    }
  }

  private stopPeriodicBroadcast(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  /**
   * Broadcast all dashboard events in one cycle.
   * Called every BROADCAST_INTERVAL_MS.
   */
  private async broadcastDashboardEvents(): Promise<void> {
    // Diagnostic log (every 10th cycle to avoid spam)
    if (!this._broadcastCount) this._broadcastCount = 0;
    this._broadcastCount++;
    const shouldLog = this._broadcastCount % 10 === 1;

    // 1. Emit status — send rich SymbolTickData[] for frontend symbolStates map
    const status = this.getStatus();
    const symbolStatesObj = this.getSymbolStates();
    const richSymbols = Object.values(symbolStatesObj);
    this.emit('status', {
      running: status.isRunning,
      symbols: richSymbols, // SymbolTickData[] not string[]
      engine: { running: status.isRunning },
      autoTrading: status.autoTrading,
      positionCount: status.positionCount,
      walletBalance: status.walletBalance,
    });

    // 2. Emit trading_stats
    const wallet = this.session.getWallet();
    const positions = this.session.getPositions();
    const tradeHistory = this.session.getTradeHistory();
    const winningTrades = tradeHistory.filter((t: any) => (t.pnl || t.profit || 0) > 0).length;
    const losingTrades = tradeHistory.filter((t: any) => (t.pnl || t.profit || 0) < 0).length;
    const totalPnL = tradeHistory.reduce((sum: number, t: any) => sum + (t.pnl || t.profit || 0), 0);
    const unrealizedPnL = positions.reduce((sum: number, p: any) => sum + (p.unrealizedPnl || 0), 0);

    this.emit('trading_stats', {
      balance: wallet?.balance || 10000,
      equity: (wallet?.balance || 10000) + unrealizedPnL,
      unrealizedPnL,
      realizedPnL: totalPnL,
      totalTrades: tradeHistory.length,
      winRate: tradeHistory.length > 0 ? (winningTrades / tradeHistory.length) * 100 : 0,
      winningTrades,
      losingTrades,
      totalPnL,
      timestamp: Date.now(),
    });

    // 3. Emit agent_signals — real signals from GlobalMarketEngine
    try {
      const globalEngine = await getGlobalEngine();
      const symbols = this.session.getSubscribedSymbols();
      const allSignals: any[] = [];

      for (const symbol of symbols) {
        const signals = globalEngine.getLatestSignals(symbol);
        for (const signal of signals) {
          allSignals.push({
            ...signal,
            symbol,
            timestamp: signal.timestamp || Date.now(),
          });
        }
      }

      if (shouldLog) {
        console.log(`[EngineAdapter] 📊 Broadcast cycle #${this._broadcastCount} for user ${this.userId}: ${allSignals.length} signals from ${symbols.length} symbols`);
      }
      if (allSignals.length > 0) {
        this.emit('agent_signals', allSignals);
      } else if (shouldLog) {
        console.log(`[EngineAdapter] ⚠️ No signals from GlobalMarketEngine for symbols: ${symbols.join(', ')}`);
      }
    } catch (err) {
      if (shouldLog) console.error(`[EngineAdapter] ❌ Error getting signals:`, (err as Error)?.message);
    }

    // 4. Emit consensus — from consensus cache
    try {
      const { getAllCachedConsensus } = await import('./AutomatedSignalProcessor');
      const cachedConsensus = getAllCachedConsensus();
      if (shouldLog) {
        console.log(`[EngineAdapter] 📊 Consensus cache size: ${cachedConsensus.size}`);
      }
      if (cachedConsensus.size > 0) {
        const consensusData: Record<string, any> = {};
        cachedConsensus.forEach((data, symbol) => {
          consensusData[symbol] = {
            direction: data.direction,
            strength: data.consensus,
            timestamp: data.timestamp,
          };
        });
        this.emit('consensus', consensusData);
      }
    } catch (err) {
      if (shouldLog) console.error(`[EngineAdapter] ❌ Error getting consensus:`, (err as Error)?.message);
    }

    // 5. Emit activity feed
    const activity = this.getActivityFeed();
    if (activity.length > 0) {
      this.emit('activity', activity);
    }

    // 6. Emit position_prices for live position tracking
    try {
      const { priceFeedService } = await import('./priceFeedService');
      const positionPrices = positions.map((pos: any) => {
        const symbol = pos.symbol || pos.pair;
        const priceData = priceFeedService.getLatestPrice(symbol);
        const currentPrice = priceData?.price || pos.currentPrice || pos.entryPrice || 0;
        const entryPrice = pos.entryPrice || 0;
        const quantity = pos.quantity || pos.size || 0;
        const side = pos.side || pos.direction || 'LONG';
        const unrealizedPnl = side === 'LONG'
          ? (currentPrice - entryPrice) * quantity
          : (entryPrice - currentPrice) * quantity;
        return {
          positionId: pos.id || pos.positionId,
          symbol,
          currentPrice,
          unrealizedPnl,
          unrealizedPnlPercent: entryPrice > 0 ? (unrealizedPnl / (entryPrice * quantity)) * 100 : 0,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
        };
      });
      if (positionPrices.length > 0) {
        this.emit('position_prices', positionPrices);
      }
    } catch {
      // Non-critical
    }

    // 7. Emit multi_tick for symbol state updates — enriched with signals + consensus
    try {
      const { priceFeedService } = await import('./priceFeedService');
      const globalEngine = await getGlobalEngine();
      const symbols = this.session.getSubscribedSymbols();
      
      // Get consensus data for enrichment
      let cachedConsensus: Map<string, any> = new Map();
      try {
        const { getAllCachedConsensus } = await import('./AutomatedSignalProcessor');
        cachedConsensus = getAllCachedConsensus();
      } catch { /* non-critical */ }

      const results = symbols.map(symbol => {
        const priceData = priceFeedService.getLatestPrice(symbol);
        const signals = globalEngine.getLatestSignals(symbol) || [];
        const consensus = cachedConsensus.get(symbol);
        
        // Determine recommendation from consensus
        let recommendation: { action: string; confidence: number } | null = null;
        if (consensus) {
          const dir = consensus.direction;
          const strength = Math.abs(consensus.consensus || 0);
          recommendation = {
            action: dir === 'bullish' ? 'BUY' : dir === 'bearish' ? 'SELL' : 'HOLD',
            confidence: strength,
          };
        }

        return {
          exchangeId: 1,
          exchangeName: 'coinbase',
          symbol,
          signals: signals.map((s: any) => ({
            agentName: s.agentName,
            signal: s.signal,
            confidence: s.confidence,
            timestamp: s.timestamp,
          })),
          recommendation,
          decision: null,
          state: {
            currentPrice: priceData?.price || 0,
            priceChange24h: priceData?.change24h || 0,
          },
          currentPrice: priceData?.price || 0,
          priceChange24h: priceData?.change24h || 0,
        };
      });
      if (results.length > 0) {
        this.emit('tick', {
          tickCount: results.length,
          timestamp: Date.now(),
          results,
          status: { running: status.isRunning },
        });
      }
    } catch {
      // Non-critical
    }
  }

  // ========================================
  // STATUS & HEALTH (used by router + WebSocket)
  // ========================================

  getStatus() {
    const sessionStatus = this.session.getStatus();
    return {
      isRunning: sessionStatus.isRunning,
      userId: this.userId,
      mode: sessionStatus.tradingMode,
      autoTrading: sessionStatus.autoTradingEnabled,
      symbols: sessionStatus.subscribedSymbols,
      activeSymbols: sessionStatus.subscribedSymbols,
      positionCount: sessionStatus.positionCount,
      walletBalance: sessionStatus.walletBalance,
      exitManagerActive: sessionStatus.exitManagerActive,
      totalTradesExecuted: sessionStatus.totalTradesExecuted,
      totalTradesRejected: sessionStatus.totalTradesRejected,
      lastSignalProcessed: sessionStatus.lastSignalProcessed,
      lastTradeExecuted: sessionStatus.lastTradeExecuted,
      // Legacy compatibility fields
      orchestrators: [],
      exchangeCount: 1,
      symbolCount: sessionStatus.subscribedSymbols.length,
      uptimeMs: 0,
    };
  }

  // ========================================
  // AGENT STATUS (used by router)
  // ========================================

  async getAllAgentsStatus() {
    const globalEngine = await getGlobalEngine();
    const globalStatus = globalEngine.getStatus();
    const allAgents: any[] = [];

    for (const analyzerStatus of globalStatus.analyzerStatuses) {
      const agentHealthMap = (analyzerStatus as any).agentHealth || {};
      for (const [agentName, health] of Object.entries(agentHealthMap)) {
        allAgents.push({
          name: agentName,
          symbol: analyzerStatus.symbol,
          status: health ? 'active' : 'inactive',
          health: health || { isHealthy: false },
          lastSignal: null,
        });
      }
    }

    return allAgents;
  }

  async getAgentHealth() {
    const globalEngine = await getGlobalEngine();
    const globalStatus = globalEngine.getStatus();
    const healthMap: Record<string, any> = {};

    for (const analyzerStatus of globalStatus.analyzerStatuses) {
      const agentHealthMap = (analyzerStatus as any).agentHealth || {};
      for (const [agentName, health] of Object.entries(agentHealthMap)) {
        healthMap[`${analyzerStatus.symbol}:${agentName}`] = health;
      }
    }

    return healthMap;
  }

  // ========================================
  // ORCHESTRATOR STATE — Phase 18 Fix
  // Returns proper OrchestratorState format expected by Strategy.tsx:
  // { fastAgents, slowAgents, fastScore, slowBonus, totalConfidence, threshold, recommendation }
  // ========================================

  async getOrchestratorState() {
    const globalEngine = await getGlobalEngine();
    const symbols = this.session.getSubscribedSymbols();

    // Aggregate signals across all subscribed symbols
    const fastAgents: any[] = [];
    const slowAgents: any[] = [];
    let totalFastScore = 0;
    let totalSlowScore = 0;
    let signalCount = 0;

    const fastAgentNames = new Set(AGENT_CATEGORIES.FAST);
    const slowAgentNames = new Set([...AGENT_CATEGORIES.SLOW, ...AGENT_CATEGORIES.PHASE2]);

    for (const symbol of symbols) {
      const signals = globalEngine.getLatestSignals(symbol);
      for (const signal of signals) {
        const agentVote = {
          name: signal.agentName,
          weight: Math.round(signal.confidence * 100),
          signal: signal.signal,
          confidence: Math.round(signal.confidence * 100),
          executionScore: signal.qualityScore || 0,
          symbol,
        };

        if (fastAgentNames.has(signal.agentName)) {
          fastAgents.push(agentVote);
          // Fast score: direction * confidence * 100
          const direction = signal.signal === 'bullish' ? 1 : signal.signal === 'bearish' ? -1 : 0;
          totalFastScore += direction * signal.confidence * 100;
        } else if (slowAgentNames.has(signal.agentName)) {
          slowAgents.push(agentVote);
          const direction = signal.signal === 'bullish' ? 1 : signal.signal === 'bearish' ? -1 : 0;
          totalSlowScore += direction * signal.confidence * 100;
        }

        signalCount++;
      }
    }

    // Normalize scores by number of agents in each category
    const fastCount = fastAgents.length || 1;
    const slowCount = slowAgents.length || 1;
    const fastScore = totalFastScore / fastCount;
    const slowBonus = (totalSlowScore / slowCount) * 0.20; // Slow agents contribute 20% bonus

    const totalConfidence = Math.abs(fastScore + slowBonus);
    const threshold = 25; // Default execution threshold

    // Determine recommendation
    const combinedScore = fastScore + slowBonus;
    let recommendation = 'HOLD';
    if (combinedScore > threshold) {
      recommendation = 'BUY';
    } else if (combinedScore < -threshold) {
      recommendation = 'SELL';
    }

    return {
      fastAgents,
      slowAgents,
      fastScore: parseFloat(fastScore.toFixed(2)),
      slowBonus: parseFloat(slowBonus.toFixed(2)),
      totalConfidence: parseFloat(totalConfidence.toFixed(2)),
      totalConsensus: parseFloat(combinedScore.toFixed(2)),
      signal: combinedScore > 0 ? 'bullish' : combinedScore < 0 ? 'bearish' : 'neutral',
      threshold,
      recommendation,
    };
  }

  // ========================================
  // SYMBOL STATES (used by router + WebSocket)
  // ========================================

  getSymbolStates() {
    const symbols = this.session.getSubscribedSymbols();
    const states: Record<string, any> = {};

    for (const symbol of symbols) {
      states[symbol] = {
        symbol,
        exchangeId: 1,
        exchangeName: 'coinbase',
        isActive: true,
        positionCount: 0,
        lastPrice: 0,
        currentPrice: 0,
        priceChange24h: 0,
        lastUpdate: Date.now(),
        signals: [],
        recommendation: null,
        decision: null,
        state: {},
      };
    }

    // Enrich with live price data from priceFeedService
    try {
      // Use synchronous require to avoid async in getter
      const pfs = require('./priceFeedService').priceFeedService;
      for (const symbol of symbols) {
        const priceData = pfs.getLatestPrice(symbol);
        if (priceData && states[symbol]) {
          states[symbol].lastPrice = priceData.price || 0;
          states[symbol].currentPrice = priceData.price || 0;
          states[symbol].priceChange24h = priceData.change24h || 0;
          states[symbol].state = {
            currentPrice: priceData.price || 0,
            priceChange24h: priceData.change24h || 0,
          };
        }
      }
    } catch {
      // Non-critical
    }

    // Enrich with position data
    const positions = this.session.getPositions();
    for (const pos of positions) {
      const sym = pos.symbol || pos.pair;
      if (sym && states[sym]) {
        states[sym].positionCount++;
        if (!states[sym].lastPrice) {
          states[sym].lastPrice = pos.currentPrice || pos.entryPrice || 0;
        }
      }
    }

    // Enrich with agent signals from GlobalMarketEngine
    try {
      const { getGlobalMarketEngine } = require('./GlobalMarketEngine');
      const engine = getGlobalMarketEngine();
      for (const symbol of symbols) {
        const signals = engine.getLatestSignals(symbol) || [];
        if (signals.length > 0 && states[symbol]) {
          states[symbol].signals = signals.map((s: any) => ({
            agentName: s.agentName,
            signal: s.signal,
            confidence: s.confidence,
            timestamp: s.timestamp,
          }));
        }
      }
    } catch {
      // Non-critical — engine may not be initialized yet
    }

    // Enrich with consensus/recommendation from AutomatedSignalProcessor
    try {
      const { getAllCachedConsensus } = require('./AutomatedSignalProcessor');
      const cachedConsensus = getAllCachedConsensus();
      for (const symbol of symbols) {
        const consensus = cachedConsensus.get(symbol);
        if (consensus && states[symbol]) {
          const dir = consensus.direction;
          const strength = Math.abs(consensus.consensus || 0);
          states[symbol].recommendation = {
            action: dir === 'bullish' ? 'BUY' : dir === 'bearish' ? 'SELL' : 'HOLD',
            confidence: strength,
          };
        }
      }
    } catch {
      // Non-critical — processor may not be initialized yet
    }

    return states;
  }

  // ========================================
  // POSITIONS (used by router + WebSocket + positionConsensusRouter)
  // ========================================

  async getAllPositions(): Promise<any[]> {
    return this.session.getPositions();
  }

  async getPositionsWithLivePrices(): Promise<any[]> {
    const positions = this.session.getPositions();
    // Enrich with live prices from PriceFeedService
    try {
      const { priceFeedService } = await import('./priceFeedService');
      return positions.map((pos: any) => {
        const symbol = pos.symbol || pos.pair;
        const priceData = priceFeedService.getLatestPrice(symbol);
        const currentPrice = priceData?.price || pos.currentPrice || pos.entryPrice;
        const entryPrice = pos.entryPrice || 0;
        const quantity = pos.quantity || pos.size || 0;
        const side = pos.side || pos.direction || 'LONG';
        const unrealizedPnl = side === 'LONG'
          ? (currentPrice - entryPrice) * quantity
          : (entryPrice - currentPrice) * quantity;

        return {
          ...pos,
          currentPrice,
          unrealizedPnl,
          unrealizedPnlPercent: entryPrice > 0 ? (unrealizedPnl / (entryPrice * quantity)) * 100 : 0,
        };
      });
    } catch {
      return positions;
    }
  }

  // ========================================
  // SIGNAL HISTORY (used by router)
  // ========================================

  async getSignalHistory() {
    const globalEngine = await getGlobalEngine();
    const symbols = this.session.getSubscribedSymbols();
    const history: any[] = [];

    for (const symbol of symbols) {
      const signals = globalEngine.getLatestSignals(symbol);
      for (const signal of signals) {
        history.push({
          ...signal,
          symbol,
          timestamp: signal.timestamp || Date.now(),
        });
      }
    }

    // Sort by timestamp descending
    history.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    return history.slice(0, 100); // Last 100 signals
  }

  // ========================================
  // ACTIVITY FEED (used by router)
  // ========================================

  getActivityFeed() {
    // Activity feed is derived from trade history
    const trades = this.session.getTradeHistory();
    return trades.slice(-50).map((trade: any) => ({
      type: trade.side === 'BUY' ? 'entry' : 'exit',
      symbol: trade.symbol || trade.pair,
      price: trade.price || trade.entryPrice,
      quantity: trade.quantity || trade.size,
      timestamp: trade.timestamp || trade.createdAt,
      reason: trade.reason || trade.exitReason || 'trade',
    }));
  }

  // ========================================
  // TRADE ACTIONS (used by router)
  // ========================================

  /**
   * Phase 9 — manual close path, routed through UserTradingSession.requestManualClose
   * which applies the ProfitLockGuard net-positive floor before executing.
   *
   * Pre-Phase-9 this method called `wallet.closePosition(...)` — but `wallet`
   * is a PaperWallet/RealWallet data interface with no methods, so the function
   * check was always false, the fallback emitted a `manual_close_requested`
   * event nothing listened to, and the API lied: `{success:true}` while the
   * position stayed open. Post-Phase-9 the call actually executes via the
   * engine's `closePositionById`, and guard blocks surface as structured
   * `[PROFIT_LOCK_BLOCKED]` errors the API layer can map to 409/422.
   *
   * The `symbol` input is retained for back-compat with the router contract
   * but no longer authoritative — we resolve the symbol from the actual
   * in-memory position so there's one source of truth.
   */
  async closePosition(_exchangeId: number, _symbol: string, positionId: string, reason: string) {
    try {
      const result = await this.session.requestManualClose(positionId, reason);
      this.emit('exit_executed', {
        positionId,
        reason,
        price: result.price,
        symbol: result.symbol,
      });
      return {
        success: true,
        price: result.price,
        symbol: result.symbol,
        guardReason: result.guardReason,
        netPnlPercent: result.netPnlPercent,
        grossPnlPercent: result.grossPnlPercent,
      };
    } catch (error) {
      console.error(`[EngineAdapter] Failed to close position ${positionId}:`, (error as Error)?.message);
      throw error;
    }
  }

  async rebalance() {
    console.log(`[EngineAdapter] Rebalance requested for user ${this.userId} — signals auto-distributed by GlobalMarketEngine`);
    return { success: true, message: 'Rebalance handled by GlobalMarketEngine signal distribution' };
  }

  updateConfig(config: any) {
    if (config.autoTrading !== undefined) {
      this.session.updateAutoTrading(config.autoTrading);
    }
    if (config.symbols) {
      const currentSymbols = new Set(this.session.getSubscribedSymbols());
      for (const sym of config.symbols) {
        if (!currentSymbols.has(sym)) {
          this.session.addSymbol(sym);
        }
      }
    }
    return { success: true };
  }

  // ========================================
  // LIFECYCLE (used by router + backgroundEngineManager)
  // ========================================

  async start() {
    console.log(`[EngineAdapter] Start requested for user ${this.userId} — session managed by UserSessionManager`);
    return { success: true };
  }

  async stop() {
    this.stopPeriodicBroadcast();
    await this.session.stop();
    adapterInstances.delete(this.userId);
    return { success: true };
  }

  // ========================================
  // WALLET (used internally)
  // ========================================

  getWallet() {
    return this.session.getWallet();
  }
}

// ========================================
// PUBLIC API — drop-in replacement for getSEERMultiEngine
// ========================================

/**
 * Get or create an EngineAdapter for a user.
 * Drop-in replacement for getSEERMultiEngine(userId).
 */
export async function getEngineAdapter(userId: number): Promise<EngineAdapter> {
  if (!userId) {
    throw new Error('EngineAdapter requires userId');
  }

  // Return existing adapter if available
  let adapter = adapterInstances.get(userId);
  if (adapter) return adapter;

  // Get or create a UserTradingSession
  const sessionMgr = await getSessionMgr();
  const session = await sessionMgr.getOrCreateSession(userId);

  adapter = new EngineAdapter(session);
  adapterInstances.set(userId, adapter);
  return adapter;
}

/**
 * Get existing adapter without creating one.
 * Drop-in replacement for getExistingEngine(userId).
 */
export function getExistingAdapter(userId: number): EngineAdapter | undefined {
  return adapterInstances.get(userId);
}

/**
 * Stop all adapters. Used during graceful shutdown.
 */
export async function stopAllAdapters(): Promise<void> {
  const stopPromises: Promise<any>[] = [];
  adapterInstances.forEach((adapter) => {
    stopPromises.push(adapter.stop());
  });
  await Promise.allSettled(stopPromises);
  adapterInstances.clear();
}
