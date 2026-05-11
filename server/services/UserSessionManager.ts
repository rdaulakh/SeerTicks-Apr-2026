/**
 * Phase 14B: UserSessionManager — Manages All User Trading Sessions
 *
 * Singleton that manages lightweight per-user UserTradingSessions.
 * Replaces the heavy backgroundEngineManager's per-user engine creation.
 *
 * Responsibilities:
 * 1. Creates UserTradingSession for each user with auto-trade enabled
 * 2. Subscribes sessions to GlobalMarketEngine signals
 * 3. Routes price ticks to sessions for exit management
 * 4. Syncs sessions when users change settings (symbol add/remove, mode change)
 * 5. Polls DB periodically for new users (lightweight, just user list)
 *
 * Trade duplication prevention:
 * - Checks getExistingEngine(userId) before creating session
 * - During transition, legacy engine users keep using old system
 * - After Phase 14D, all users use sessions
 */

import { UserTradingSession, UserTradingSessionConfig } from './UserTradingSession';
import { getActiveClock } from '../_core/clock';
import { GlobalSignal } from './GlobalSymbolAnalyzer';
import { priceFeedService } from './priceFeedService';

export interface UserSessionManagerStatus {
  isInitialized: boolean;
  totalSessions: number;
  activeSessions: number;
  autoTradingSessions: number;
  lastSyncMs: number;
}

class UserSessionManager {
  private sessions: Map<number, UserTradingSession> = new Map();
  private isInitialized: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private priceTickInterval: NodeJS.Timeout | null = null;
  private lastSyncMs: number = 0;

  // Sync user list from DB every 5 minutes
  private readonly USER_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  // Route price ticks to exit managers every 1 second
  private readonly PRICE_TICK_INTERVAL_MS = 1000;

  /**
   * Initialize the session manager.
   * Queries DB for all users with auto-trade enabled, creates sessions.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[UserSessionManager] Initializing...');

    // Subscribe to GlobalMarketEngine signals
    this.subscribeToGlobalSignals();

    // Create sessions for existing users
    await this.syncAllUsers();

    // Start periodic user sync
    this.syncInterval = setInterval(async () => {
      await this.syncAllUsers();
    }, this.USER_SYNC_INTERVAL_MS);

    if (this.syncInterval.unref) {
      this.syncInterval.unref();
    }

    // Start price tick routing
    this.startPriceTickRouting();

    this.isInitialized = true;
    console.log(`[UserSessionManager] ✅ Initialized. Sessions: ${this.sessions.size}`);
  }

  /**
   * Get an existing session for a user.
   */
  getSession(userId: number): UserTradingSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * Get or create a session for a user.
   * Used when a user logs in or changes settings.
   */
  async getOrCreateSession(userId: number): Promise<UserTradingSession> {
    let session = this.sessions.get(userId);
    if (session) return session;

    // Phase 14E: Legacy engine check removed — seerMainMulti.ts deleted
    return this.createSessionForUser(userId);
  }

  /**
   * Sync a specific user's session when they change settings.
   * Called from settingsRouter after updateAutoTrading, addSymbol, etc.
   */
  async syncUserSession(userId: number): Promise<void> {
    let session = this.sessions.get(userId);

    if (session) {
      // Session exists — sync settings from DB
      await session.syncSettings();
    } else {
      // No session — check if user needs one
      const config = await this.loadUserConfig(userId);
      if (config && (config.autoTradingEnabled || config.subscribedSymbols.length > 0)) {
        await this.createSessionForUser(userId);
      }
    }
  }

  /**
   * Get all sessions (for admin/debugging).
   */
  getAllSessions(): Map<number, UserTradingSession> {
    return this.sessions;
  }

  /**
   * Get manager status for health dashboards.
   */
  getStatus(): UserSessionManagerStatus {
    let autoTradingCount = 0;
    let activeCount = 0;

    for (const [, session] of this.sessions) {
      if (session.isAutoTradingEnabled()) autoTradingCount++;
      if (session.getStatus().isRunning) activeCount++;
    }

    return {
      isInitialized: this.isInitialized,
      totalSessions: this.sessions.size,
      activeSessions: activeCount,
      autoTradingSessions: autoTradingCount,
      lastSyncMs: this.lastSyncMs,
    };
  }

  /**
   * Stop the session manager and all sessions.
   */
  async stop(): Promise<void> {
    console.log('[UserSessionManager] Stopping...');

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.priceTickInterval) {
      clearInterval(this.priceTickInterval);
      this.priceTickInterval = null;
    }

    // Stop all sessions
    const stopPromises: Promise<void>[] = [];
    for (const [userId, session] of this.sessions) {
      stopPromises.push(session.stop().catch(err => {
        console.warn(`[UserSessionManager] Failed to stop session for user ${userId}:`, (err as Error)?.message);
      }));
    }
    await Promise.allSettled(stopPromises);

    this.sessions.clear();
    this.isInitialized = false;
    console.log('[UserSessionManager] Stopped');
  }

  // ========================================
  // PRIVATE: Signal subscription
  // ========================================

  private subscribeToGlobalSignals(): void {
    import('./GlobalMarketEngine').then(({ getGlobalMarketEngine }) => {
      const globalEngine = getGlobalMarketEngine();

      globalEngine.on('signals_updated', (symbol: string, signals: GlobalSignal[], marketContext?: any) => {
        // Route signals to all sessions that subscribe to this symbol
        for (const [, session] of this.sessions) {
          if (session.getSubscribedSymbols().includes(symbol)) {
            // Fire-and-forget — don't block signal delivery
            // Phase 30: Pass market context through to UserTradingSession
            session.onGlobalSignals(symbol, signals, marketContext).catch(err => {
              console.error(`[UserSessionManager] Signal delivery failed for user ${session.getUserId()}:`, (err as Error)?.message);
            });
          }
        }
      });

      console.log('[UserSessionManager] Subscribed to GlobalMarketEngine signals');
    }).catch(err => {
      console.error('[UserSessionManager] Failed to subscribe to GlobalMarketEngine:', (err as Error)?.message);
    });
  }

  // ========================================
  // PRIVATE: Price tick routing
  // ========================================

  private startPriceTickRouting(): void {
    this.priceTickInterval = setInterval(() => {
      // Route latest prices to all sessions' exit managers
      for (const [, session] of this.sessions) {
        const symbols = session.getSubscribedSymbols();
        for (const symbol of symbols) {
          const priceData = priceFeedService.getLatestPrice(symbol);
          if (priceData?.price && priceData.price > 0) {
            session.onPriceTick(symbol, priceData.price).catch(() => {
              // Non-critical — exit manager handles its own errors
            });
          }
        }
      }
    }, this.PRICE_TICK_INTERVAL_MS);

    if (this.priceTickInterval.unref) {
      this.priceTickInterval.unref();
    }
  }

  // ========================================
  // PRIVATE: User sync from database
  // ========================================

  private async syncAllUsers(): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { tradingModeConfig } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      // Get all users with auto-trade enabled
      const usersWithAutoTrade = await db.select({
        userId: tradingModeConfig.userId,
        mode: tradingModeConfig.mode,
        autoTradeEnabled: tradingModeConfig.autoTradeEnabled,
      }).from(tradingModeConfig)
        .where(eq(tradingModeConfig.autoTradeEnabled, true));

      for (const user of usersWithAutoTrade) {
        if (!this.sessions.has(user.userId)) {
          try {
            await this.createSessionForUser(user.userId);
          } catch (err) {
            console.error(`[UserSessionManager] Failed to create session for user ${user.userId}:`, (err as Error)?.message);
          }
        }
      }

      this.lastSyncMs = getActiveClock().now();
    } catch (err) {
      console.error('[UserSessionManager] User sync failed:', (err as Error)?.message);
    }
  }

  private async createSessionForUser(userId: number): Promise<UserTradingSession> {
    // Don't create duplicate sessions
    const existing = this.sessions.get(userId);
    if (existing) return existing;

    const config = await this.loadUserConfig(userId);

    // Phase 20 — defaults expanded to include SOL-USD so users without
    // explicit `tradingSymbols` rows still observe all 3 default markets.
    // Pre-Phase-20 the omission silently dropped SOL from the trade
    // pipeline even though its agent analyzers were running.
    const session = new UserTradingSession(config || {
      userId,
      autoTradingEnabled: false,
      tradingMode: 'paper',
      subscribedSymbols: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
    });

    await session.initialize();
    this.sessions.set(userId, session);

    console.log(`[UserSessionManager] Created session for user ${userId}`);
    return session;
  }

  private async loadUserConfig(userId: number): Promise<UserTradingSessionConfig | null> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return null;

      const { tradingModeConfig, tradingSymbols } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      // Get trading mode config
      const modeResult = await db.select().from(tradingModeConfig)
        .where(eq(tradingModeConfig.userId, userId))
        .limit(1);

      // Get user's subscribed symbols
      const symbolResult = await db.select().from(tradingSymbols)
        .where(and(eq(tradingSymbols.userId, userId), eq(tradingSymbols.isActive, true)));

      // Phase 20 — see comment in createSessionForUser. Defaults align with
      // GlobalMarketEngine.DEFAULT_SYMBOLS so price feed, agent analyzers,
      // and per-user subscriptions all agree on the same 3-symbol baseline.
      const symbols = symbolResult.length > 0
        ? symbolResult.map(s => s.symbol)
        : ['BTC-USD', 'ETH-USD', 'SOL-USD']; // Defaults

      return {
        userId,
        autoTradingEnabled: modeResult[0]?.autoTradeEnabled ?? false,
        tradingMode: (modeResult[0]?.mode as 'paper' | 'real') || 'paper',
        subscribedSymbols: symbols,
      };
    } catch {
      return null;
    }
  }
}

// ========================================
// Singleton export
// ========================================

let userSessionManagerInstance: UserSessionManager | null = null;

export function getUserSessionManager(): UserSessionManager {
  if (!userSessionManagerInstance) {
    userSessionManagerInstance = new UserSessionManager();
  }
  return userSessionManagerInstance;
}
