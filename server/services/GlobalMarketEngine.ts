/**
 * Phase 14A: GlobalMarketEngine — Always-On Market Observation
 *
 * Singleton that observes ALL markets independently of users.
 * Runs at server boot, never stops. Creates one GlobalSymbolAnalyzer per symbol.
 *
 * Architecture:
 *   Server boot -> GlobalMarketEngine.start()
 *     -> Reads globalSymbols from DB (or defaults to BTC-USD, ETH-USD)
 *     -> Creates one GlobalSymbolAnalyzer per symbol (29 agents each)
 *     -> Each analyzer emits raw signals -> UserTradingSessions consume them
 *
 * Key difference from SEERMultiEngine:
 * - NO userId — this is platform-level, not per-user
 * - NO trade decisions — purely observational
 * - Runs ONCE for ALL users (vs N duplicated engines)
 * - Never stops (vs start/stop lifecycle per user)
 *
 * Result: 2 symbols x 29 agents = 58 agent instances total
 *         (vs N x 2 x 29 = 58N with per-user engines)
 */

import { EventEmitter } from 'events';
import { GlobalSymbolAnalyzer, GlobalSignal, GlobalSymbolStatus } from './GlobalSymbolAnalyzer';

const DEFAULT_SYMBOLS = ['BTC-USD', 'ETH-USD'];

export interface GlobalMarketEngineStatus {
  isRunning: boolean;
  uptimeMs: number;
  symbols: string[];
  analyzerStatuses: GlobalSymbolStatus[];
  lastHealthCheck: number;
}

class GlobalMarketEngine extends EventEmitter {
  private analyzers: Map<string, GlobalSymbolAnalyzer> = new Map();
  private isRunning: boolean = false;
  private startedAt: number = 0;
  private _startState: string = 'never_started';
  private _stopReason: string = '';
  private lastHealthCheckMs: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Health check every 60 seconds
  private readonly HEALTH_CHECK_INTERVAL_MS = 60_000;

  /**
   * Start the global market engine.
   * Reads symbol list from DB, creates analyzers, starts observing.
   * Called ONCE at server boot.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[GlobalMarketEngine] Already running');
      return;
    }

    console.log('[GlobalMarketEngine] Starting always-on market observation...');
    this.startedAt = Date.now();
    this._startState = 'starting';

    // Load symbols from database, fall back to defaults
    let symbols: string[];
    try {
      this._startState = 'loading_symbols';
      symbols = await this.loadSymbolsFromDb();
      console.log(`[GlobalMarketEngine] Symbols to observe: ${symbols.join(', ')}`);
    } catch (err) {
      console.error('[GlobalMarketEngine] CRITICAL: loadSymbolsFromDb threw:', (err as Error)?.message);
      symbols = ['BTC-USD', 'ETH-USD'];
    }

    // Create and start analyzers for each symbol with staggered delays
    // to avoid hitting API rate limits (CoinGecko, etc.) when multiple symbols
    // fire slow agents simultaneously
    const SYMBOL_STAGGER_MS = 30_000; // 30s between symbol starts
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      try {
        this._startState = `adding_symbol_${symbol}`;
        const result = await this.addSymbol(symbol, i * SYMBOL_STAGGER_MS);
        console.log(`[GlobalMarketEngine] addSymbol(${symbol}) result: ${result}, analyzers.size: ${this.analyzers.size}, slowAgentDelay: ${i * SYMBOL_STAGGER_MS}ms`);
      } catch (err) {
        console.error(`[GlobalMarketEngine] CRITICAL: addSymbol(${symbol}) threw:`, (err as Error)?.message, (err as Error)?.stack);
      }
    }

    // Start health check loop
    this.startHealthCheckLoop();

    this.isRunning = true;
    this._startState = 'running';
    console.log(`[GlobalMarketEngine] ✅ Started. Symbols: ${symbols.join(', ')} (${this.analyzers.size} analyzers)`);

    // Update health state so /api/trpc/health shows agents as active
    this.updateAgentHealthState();
  }

  /**
   * Stop the global market engine.
   * Called only on server shutdown.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this._stopReason = new Error().stack?.split('\n').slice(1, 4).join(' | ') || 'unknown';
    this._startState = 'stopped';
    console.log('[GlobalMarketEngine] Stopping... (called from:', this._stopReason, ')');

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Stop all analyzers
    const stopPromises: Promise<void>[] = [];
    for (const [symbol, analyzer] of this.analyzers) {
      console.log(`[GlobalMarketEngine] Stopping analyzer for ${symbol}`);
      stopPromises.push(analyzer.stop());
    }
    await Promise.allSettled(stopPromises);

    this.analyzers.clear();
    this.isRunning = false;

    // Update health state to reflect agents are now inactive
    import('../routers/healthRouter').then(({ updateHealthState }) => {
      updateHealthState('agents', { active: 0, total: 0, lastSignal: 0 });
    }).catch(() => {});

    console.log('[GlobalMarketEngine] Stopped');
  }

  /**
   * Hot-add a new symbol for observation.
   * Can be called while running (e.g., when a user adds a new symbol to their watchlist).
   */
  async addSymbol(symbol: string, initialSlowAgentDelayMs: number = 0): Promise<boolean> {
    if (this.analyzers.has(symbol)) {
      return true; // Already observing
    }

    try {
      console.log(`[GlobalMarketEngine] Adding symbol: ${symbol} (slowAgentDelay: ${initialSlowAgentDelayMs}ms)`);

      const analyzer = new GlobalSymbolAnalyzer(symbol, 'coinbase');

      // Forward signals from analyzer to engine-level events
      analyzer.on('signals_updated', (sym: string, signals: GlobalSignal[], marketContext?: any) => {
        this.emit('signals_updated', sym, signals, marketContext);
        // Update lastSignal timestamp on every signal batch
        this.updateAgentLastSignal();
      });

      await analyzer.start(initialSlowAgentDelayMs);
      this.analyzers.set(symbol, analyzer);

      console.log(`[GlobalMarketEngine] Symbol added: ${symbol}`);

      // Persist to DB (non-blocking)
      this.persistSymbolToDb(symbol).catch(err => {
        console.warn(`[GlobalMarketEngine] Failed to persist symbol ${symbol} to DB:`, (err as Error)?.message);
      });

      return true;
    } catch (err) {
      console.error(`[GlobalMarketEngine] Failed to add symbol ${symbol}:`, (err as Error)?.message);
      return false;
    }
  }

  /**
   * Hot-remove a symbol from observation.
   */
  async removeSymbol(symbol: string): Promise<boolean> {
    const analyzer = this.analyzers.get(symbol);
    if (!analyzer) {
      return false; // Not observing
    }

    try {
      console.log(`[GlobalMarketEngine] Removing symbol: ${symbol}`);
      await analyzer.stop();
      analyzer.removeAllListeners();
      this.analyzers.delete(symbol);
      console.log(`[GlobalMarketEngine] Symbol removed: ${symbol}`);
      return true;
    } catch (err) {
      console.error(`[GlobalMarketEngine] Failed to remove symbol ${symbol}:`, (err as Error)?.message);
      return false;
    }
  }

  /**
   * Get the latest signals for a specific symbol.
   * Used by UserTradingSession for on-demand access (polling fallback).
   */
  getLatestSignals(symbol: string): GlobalSignal[] {
    const analyzer = this.analyzers.get(symbol);
    if (!analyzer) return [];
    return analyzer.getLatestSignals();
  }

  /**
   * Get the GlobalSymbolAnalyzer for a specific symbol.
   * Used for advanced queries (agent health, agent manager access).
   */
  getAnalyzer(symbol: string): GlobalSymbolAnalyzer | undefined {
    return this.analyzers.get(symbol);
  }

  /**
   * Get all currently observed symbols.
   */
  getSymbols(): string[] {
    return Array.from(this.analyzers.keys());
  }

  /**
   * Get comprehensive platform status for health dashboards and API.
   */
  getStatus(): GlobalMarketEngineStatus {
    const analyzerStatuses: GlobalSymbolStatus[] = [];
    for (const [, analyzer] of this.analyzers) {
      analyzerStatuses.push(analyzer.getStatus());
    }

    return {
      isRunning: this.isRunning,
      uptimeMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      symbols: Array.from(this.analyzers.keys()),
      analyzerStatuses,
      lastHealthCheck: this.lastHealthCheckMs,
      _startState: this._startState,
      _stopReason: this._stopReason,
    } as any;
  }

  // ========================================
  // PRIVATE: Symbol loading from database
  // ========================================

  private async loadSymbolsFromDb(): Promise<string[]> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) {
        console.warn('[GlobalMarketEngine] Database not available, using defaults');
        return [...DEFAULT_SYMBOLS];
      }

      const { globalSymbols } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      const rows = await db.select().from(globalSymbols).where(eq(globalSymbols.isActive, true));

      if (rows.length === 0) {
        console.log('[GlobalMarketEngine] No symbols in globalSymbols table, seeding defaults...');
        // Seed default symbols
        for (const symbol of DEFAULT_SYMBOLS) {
          try {
            await db.insert(globalSymbols).values({
              symbol,
              exchange: 'coinbase',
              isActive: true,
            });
          } catch (insertErr) {
            // Ignore duplicate key errors
          }
        }
        return [...DEFAULT_SYMBOLS];
      }

      return rows.map(r => r.symbol);
    } catch (err) {
      console.warn('[GlobalMarketEngine] Failed to load symbols from DB, using defaults:', (err as Error)?.message);
      return [...DEFAULT_SYMBOLS];
    }
  }

  /**
   * Persist a newly added symbol to the globalSymbols table.
   */
  private async persistSymbolToDb(symbol: string): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { globalSymbols } = await import('../../drizzle/schema');

      await db.insert(globalSymbols).values({
        symbol,
        exchange: 'coinbase',
        isActive: true,
      });
    } catch {
      // Ignore duplicate key errors — symbol may already exist
    }
  }

  // ========================================
  // PRIVATE: Health check loop
  // ========================================

  private startHealthCheckLoop(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL_MS);

    // Don't prevent process exit
    if (this.healthCheckInterval.unref) {
      this.healthCheckInterval.unref();
    }
  }

  private performHealthCheck(): void {
    this.lastHealthCheckMs = Date.now();

    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const [symbol, analyzer] of this.analyzers) {
      const status = analyzer.getStatus();

      if (status.running) {
        healthyCount++;

        // Phase 15D: Agent-level watchdog — check for stale/dead agents within each analyzer
        // If an agent hasn't produced a signal in 30 minutes, it's effectively dead
        const AGENT_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();
        let staleAgents = 0;

        if (status.agentHealth && Array.isArray(status.agentHealth)) {
          for (const agent of status.agentHealth) {
            const lastSignalTime = agent.lastSignalTime || agent.lastUpdate || 0;
            if (lastSignalTime > 0 && (now - lastSignalTime) > AGENT_STALE_THRESHOLD_MS) {
              staleAgents++;
              console.warn(`[GlobalMarketEngine] ⚠️ Agent ${agent.name || agent.agentName} for ${symbol} stale (no signal for ${Math.round((now - lastSignalTime) / 60000)}min)`);
            }
          }
        }

        if (staleAgents > 0) {
          console.warn(`[GlobalMarketEngine] ${symbol}: ${staleAgents} stale agents detected`);
        }
      } else {
        unhealthyCount++;
        console.warn(`[GlobalMarketEngine] Analyzer for ${symbol} is not running, attempting restart...`);

        // Attempt restart
        analyzer.start().then(() => {
          console.log(`[GlobalMarketEngine] Analyzer for ${symbol} restarted`);
        }).catch(err => {
          console.error(`[GlobalMarketEngine] Failed to restart analyzer for ${symbol}:`, (err as Error)?.message);
        });
      }
    }

    // Log only if there's something noteworthy
    if (unhealthyCount > 0) {
      console.log(`[GlobalMarketEngine] Health check: ${healthyCount} healthy, ${unhealthyCount} unhealthy`);
    }

    // Update health state for agents reporting
    this.updateAgentHealthState();
  }

  // ========================================
  // PRIVATE: Health state reporting
  // ========================================

  /**
   * Update the global health state with agent counts.
   * Called on start, during every health check cycle, and on stop.
   */
  private updateAgentHealthState(): void {
    let totalAgents = 0;
    let activeAgents = 0;
    let lastSignalMs = 0;

    for (const [, analyzer] of this.analyzers) {
      const status = analyzer.getStatus();
      totalAgents += status.agentCount;
      if (status.running) {
        activeAgents += status.agentCount;
      }
      if (status.lastSignalUpdate > lastSignalMs) {
        lastSignalMs = status.lastSignalUpdate;
      }
    }

    // Non-blocking import to avoid circular dependencies
    import('../routers/healthRouter').then(({ updateHealthState }) => {
      updateHealthState('agents', {
        active: activeAgents,
        total: totalAgents,
        lastSignal: lastSignalMs,
      });
    }).catch(() => {}); // Silent fail — health reporting is non-critical
  }

  /**
   * Lightweight update: only refresh lastSignal timestamp.
   * Called on every signal batch to keep the timestamp current without
   * recalculating full agent counts.
   */
  private updateAgentLastSignal(): void {
    import('../routers/healthRouter').then(({ updateHealthState }) => {
      updateHealthState('agents', { lastSignal: Date.now() });
    }).catch(() => {});
  }
}

// ========================================
// Singleton export
// ========================================

let globalMarketEngineInstance: GlobalMarketEngine | null = null;

export function getGlobalMarketEngine(): GlobalMarketEngine {
  if (!globalMarketEngineInstance) {
    globalMarketEngineInstance = new GlobalMarketEngine();
  }
  return globalMarketEngineInstance;
}
