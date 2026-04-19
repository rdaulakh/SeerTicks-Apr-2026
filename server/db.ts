import { eq, and, desc, asc, gte, lte, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from 'mysql2/promise';
import { InsertUser, users, paperWallets, InsertPaperWallet, paperPositions, InsertPaperPosition, paperOrders, InsertPaperOrder, paperTrades, InsertPaperTrade, tradingModeConfig, InsertTradingModeConfig, agentAccuracy, settings, InsertSettings, Settings, automatedTradingSettings, InsertAutomatedTradingSettings, AutomatedTradingSettings, automatedTradeLog, InsertAutomatedTradeLog, AutomatedTradeLog, automatedTradingMetrics, InsertAutomatedTradingMetric } from "../drizzle/schema";
import { ENV } from './_core/env';
import { withDatabaseRetry, DatabaseRetryPresets } from './utils/DatabaseRetry';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

/**
 * Connection pool configuration for production-grade stability
 * - connectionLimit: Max concurrent connections (10 for TiDB Cloud free tier)
 * - queueLimit: Max queued connection requests (0 = unlimited)
 * - waitForConnections: Wait for available connection instead of erroring
 * - connectTimeout: Timeout for establishing connection (10s)
 * - idleTimeout: Close idle connections after 60s
 * - enableKeepAlive: Keep connections alive to prevent timeout
 * - keepAliveInitialDelay: Initial delay before first keepalive packet (10s)
 */
function createConnectionPool(): mysql.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
  }

  // Parse DATABASE_URL to extract connection parameters
  const url = new URL(process.env.DATABASE_URL);
  
  // Parse SSL configuration from query string
  const sslParam = url.searchParams.get('ssl');
  let ssl: any = false;
  if (sslParam) {
    try {
      ssl = JSON.parse(sslParam);
    } catch {
      ssl = { rejectUnauthorized: true };
    }
  }

  const poolConfig: mysql.PoolOptions = {
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1), // Remove leading '/'
    ssl,
    
    // Connection pool settings
    connectionLimit: 10, // Max concurrent connections
    queueLimit: 0, // Unlimited queue (will wait for available connection)
    waitForConnections: true, // Wait instead of erroring immediately
    
    // Timeout settings
    connectTimeout: 5000, // 5 seconds to establish connection (reduced for faster startup)
    
    // Keep-alive settings to prevent connection drops
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000, // 10 seconds
    
    // Connection lifecycle
    idleTimeout: 60000, // Close idle connections after 60s
    maxIdle: 5, // Keep max 5 idle connections
    
    // Character set
    charset: 'utf8mb4',
    
    // Timezone
    timezone: '+00:00',
  };

  console.log('[Database] Creating connection pool with config:', {
    host: poolConfig.host,
    port: poolConfig.port,
    database: poolConfig.database,
    connectionLimit: poolConfig.connectionLimit,
    ssl: !!poolConfig.ssl,
  });

  return mysql.createPool(poolConfig);
}

/**
 * Get or create database connection pool with retry logic
 * Lazily creates the drizzle instance so local tooling can run without a DB.
 */
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Create connection pool if it doesn't exist
      if (!_pool) {
        _pool = createConnectionPool();
        
        // Test connection with retry
        await withDatabaseRetry(async () => {
          const connection = await _pool!.getConnection();
          console.log('[Database] Connection pool test successful');
          connection.release();
        }, DatabaseRetryPresets.STANDARD, 'testConnection');
      }
      
      // Create Drizzle instance with the pool
      // Cast to any to avoid type mismatch between mysql2/promise and mysql2 Pool types
      _db = drizzle(_pool as any);
      console.log('[Database] Drizzle ORM initialized successfully');

      // FIX: Update health state so health endpoint shows DB as connected
      import('./routers/healthRouter').then(({ updateHealthState }) => {
        updateHealthState('database', { connected: true, lastQuery: Date.now() });
      }).catch(() => {}); // Silent fail
    } catch (error) {
      console.error("[Database] Failed to initialize:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

/**
 * Get connection pool statistics for monitoring
 */
export function getPoolStats() {
  if (!_pool) {
    return null;
  }
  
  return {
    totalConnections: (_pool as any)._allConnections?.length || 0,
    freeConnections: (_pool as any)._freeConnections?.length || 0,
    queuedRequests: (_pool as any)._connectionQueue?.length || 0,
  };
}

/**
 * Gracefully close database connection pool
 */
export async function closeDb() {
  if (_pool) {
    console.log('[Database] Closing connection pool...');
    await _pool.end();
    _pool = null;
    _db = null;
    console.log('[Database] Connection pool closed');
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId && !user.email) {
    throw new Error("User openId or email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  // Use retry logic for critical user operations
  await withDatabaseRetry(async () => {
    const values: InsertUser = {
      openId: user.openId || null,
      email: user.email || '',
    };
    const updateSet: Record<string, string | number | Date | null> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      // Keep null as null for database compatibility
      (values as any)[field] = value ?? null;
      updateSet[field] = value ?? null;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  }, DatabaseRetryPresets.STANDARD, "upsertUser");
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  // Use fast retry for read operations
  return await withDatabaseRetry(async () => {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  }, DatabaseRetryPresets.FAST, "getUserByOpenId");
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  // Use fast retry for read operations
  return await withDatabaseRetry(async () => {
    const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  }, DatabaseRetryPresets.FAST, "getUserById");
}

// Settings Database Helpers

export async function getUserSettings(userId: number): Promise<Settings | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertSettings(userId: number, settingsData: Partial<Omit<Settings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert settings: database not available");
    return;
  }

  try {
    const values: InsertSettings = {
      userId,
      ...settingsData,
    };

    await db.insert(settings).values(values).onDuplicateKeyUpdate({
      set: settingsData,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert settings:", error);
    throw error;
  }
}

export async function resetSettingsToDefaults(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot reset settings: database not available");
    return;
  }

  try {
    const defaults = {
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

    await upsertSettings(userId, defaults);
  } catch (error) {
    console.error("[Database] Failed to reset settings:", error);
    throw error;
  }
}

// Paper Trading Database Helpers

export async function getPaperWallet(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(paperWallets).where(
    and(
      eq(paperWallets.userId, userId),
      eq(paperWallets.tradingMode, tradingMode)
    )
  ).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertPaperWallet(wallet: InsertPaperWallet, txDb?: any) {
  const db = txDb || await getDb();
  if (!db) return;
  
  await db.insert(paperWallets).values(wallet).onDuplicateKeyUpdate({
    set: {
      balance: wallet.balance,
      equity: wallet.equity,
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
    },
  });
}

/**
 * ✅ WALLET MARGIN RECALCULATION
 * Recalculates wallet margin based on actual open positions
 * Use this to fix data inconsistencies where margin doesn't match open positions
 * 
 * @param userId - The user ID to recalculate margin for
 * @returns The recalculated wallet state or null if failed
 */
export async function recalculateWalletMargin(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return null;

  try {
    // Get current wallet
    const [wallet] = await db.select()
      .from(paperWallets)
      .where(and(
        eq(paperWallets.userId, userId),
        eq(paperWallets.tradingMode, tradingMode)
      ))
      .limit(1);

    if (!wallet) {
      console.warn(`[recalculateWalletMargin] No wallet found for user ${userId} (mode=${tradingMode})`);
      return null;
    }

    // Get all open positions
    const openPositions = await db.select()
      .from(paperPositions)
      .where(and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'open'),
        eq(paperPositions.tradingMode, tradingMode)
      ));
    
    // Calculate margin from open positions
    let calculatedMargin = 0;
    let calculatedUnrealizedPnL = 0;
    
    for (const position of openPositions) {
      const entryPrice = parseFloat(position.entryPrice.toString());
      const quantity = parseFloat(position.quantity.toString());
      calculatedMargin += entryPrice * quantity;
      calculatedUnrealizedPnL += parseFloat(position.unrealizedPnL?.toString() || '0');
    }
    
    const currentBalance = parseFloat(wallet.balance.toString());
    const calculatedEquity = currentBalance + calculatedUnrealizedPnL;
    const calculatedMarginLevel = calculatedMargin > 0 ? (calculatedEquity / calculatedMargin) * 100 : 0;
    
    const oldMargin = parseFloat(wallet.margin.toString());
    
    // Only update if there's a discrepancy
    if (Math.abs(oldMargin - calculatedMargin) > 0.01) {
      console.log(`[recalculateWalletMargin] User ${userId}: Margin mismatch detected!`);
      console.log(`  - Old margin: $${oldMargin.toFixed(2)}`);
      console.log(`  - Calculated margin: $${calculatedMargin.toFixed(2)}`);
      console.log(`  - Open positions: ${openPositions.length}`);
      
      await db.update(paperWallets)
        .set({
          margin: calculatedMargin.toFixed(2),
          marginLevel: calculatedMarginLevel.toFixed(2),
          equity: calculatedEquity.toFixed(2),
          unrealizedPnL: calculatedUnrealizedPnL.toFixed(2),
        })
        .where(and(
          eq(paperWallets.userId, userId),
          eq(paperWallets.tradingMode, tradingMode)
        ));
      
      console.log(`[recalculateWalletMargin] User ${userId}: Margin corrected to $${calculatedMargin.toFixed(2)}`);
    }
    
    return {
      userId,
      oldMargin,
      newMargin: calculatedMargin,
      openPositions: openPositions.length,
      corrected: Math.abs(oldMargin - calculatedMargin) > 0.01,
    };
  } catch (error) {
    console.error(`[recalculateWalletMargin] Error for user ${userId}:`, error);
    return null;
  }
}

/**
 * ✅ INSTITUTIONAL-GRADE SOFT RESET
 * Resets wallet to initial balance while preserving complete audit trail
 * 
 * What this does:
 * 1. Closes all open positions at current market price
 * 2. Records final P&L for each closed position
 * 3. Keeps ALL historical trades (NEVER deletes)
 * 4. Creates transaction record documenting the reset
 * 5. Resets wallet balance to $10,000
 * 6. Maintains complete financial audit trail
 * 
 * What this DOES NOT do:
 * - Delete any historical data
 * - Lose transaction history
 * - Violate financial audit compliance
 */
export async function resetPaperWallet(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return;

  // Use database transaction for atomicity
  await withDatabaseRetry(async () => {
    // 1. Get current wallet state before reset
    const [currentWallet] = await db.select()
      .from(paperWallets)
      .where(and(
        eq(paperWallets.userId, userId),
        eq(paperWallets.tradingMode, tradingMode)
      ))
      .limit(1);

    const balanceBefore = currentWallet ? parseFloat(currentWallet.balance.toString()) : 10000;
    const totalPnLBefore = currentWallet ? parseFloat(currentWallet.totalPnL.toString()) : 0;
    const totalTradesBefore = currentWallet ? currentWallet.totalTrades : 0;
    const winRateBefore = currentWallet ? parseFloat(currentWallet.winRate.toString()) : 0;

    // 2. Close all open positions at current price (DO NOT DELETE)
    const openPositions = await db.select()
      .from(paperPositions)
      .where(and(
        eq(paperPositions.userId, userId),
        eq(paperPositions.status, 'open'),
        eq(paperPositions.tradingMode, tradingMode)
      ));

    for (const position of openPositions) {
      // Phase 23: Calculate real P&L from currentPrice (last known market price)
      const entryPrice = parseFloat(position.entryPrice?.toString() || '0');
      const currentPrice = parseFloat(position.currentPrice?.toString() || '0');
      const quantity = parseFloat(position.quantity?.toString() || '0');
      const exitPx = currentPrice > 0 ? currentPrice : 0;
      
      let realizedPnl = 0;
      if (exitPx > 0 && entryPrice > 0 && quantity > 0) {
        realizedPnl = position.side === 'long'
          ? (exitPx - entryPrice) * quantity
          : (entryPrice - exitPx) * quantity;
      }
      
      // Close position with real data where available, mark as data_integrity_issue if not
      const exitReason = exitPx > 0
        ? 'WALLET_RESET_CLOSURE'
        : 'WALLET_RESET_CLOSURE: data_integrity_issue (no market price available)';
      
      await db.update(paperPositions)
        .set({
          status: 'closed',
          exitPrice: exitPx > 0 ? exitPx.toString() : null,
          exitTime: new Date(),
          realizedPnl: exitPx > 0 ? realizedPnl.toFixed(8) : null,
          exitReason,
          updatedAt: new Date(),
        })
        .where(eq(paperPositions.id, position.id));

      // Record closing trade in history (KEEP FOREVER)
      await db.insert(paperTrades).values({
        userId,
        tradingMode,
        orderId: `reset_close_${Date.now()}_${position.id}`,
        symbol: position.symbol,
        side: position.side === 'long' ? 'sell' : 'buy',
        price: (exitPx > 0 ? exitPx : entryPrice).toString(),
        quantity: quantity.toString(),
        pnl: realizedPnl.toFixed(8),
        commission: '0.00',
        strategy: 'WALLET_RESET_CLOSURE',
        timestamp: new Date(),
      });
    }

    // 3. Create transaction record for wallet reset (AUDIT TRAIL)
    const { paperTransactions } = await import('../drizzle/schema');
    await db.insert(paperTransactions).values({
      userId,
      tradingMode,
      type: 'WALLET_RESET',
      amount: `-${balanceBefore.toFixed(2)}`,
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: '0.00',
      description: `Wallet reset (${tradingMode}). Previous state: Balance=$${balanceBefore.toFixed(2)}, Total P&L=$${totalPnLBefore.toFixed(2)}, Trades=${totalTradesBefore}, Win Rate=${winRateBefore.toFixed(1)}%`,
      metadata: JSON.stringify({
        tradingMode,
        previousBalance: balanceBefore,
        previousTotalPnL: totalPnLBefore,
        previousTotalTrades: totalTradesBefore,
        previousWinRate: winRateBefore,
        positionsClosed: openPositions.length,
        resetTimestamp: new Date().toISOString(),
      }),
      timestamp: new Date(),
    });

    // 4. Reset wallet metrics (or create if doesn't exist)
    if (currentWallet) {
      await db.update(paperWallets)
        .set({
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
          updatedAt: new Date(),
        })
        .where(and(
          eq(paperWallets.userId, userId),
          eq(paperWallets.tradingMode, tradingMode)
        ));
    } else {
      await db.insert(paperWallets).values({
        userId,
        tradingMode,
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
      });
    }

    // 5. Create transaction record for initial deposit after reset
    await db.insert(paperTransactions).values({
      userId,
      tradingMode,
      type: 'DEPOSIT',
      amount: '10000.00',
      balanceBefore: '0.00',
      balanceAfter: '10000.00',
      description: `Initial ${tradingMode} trading balance after wallet reset`,
      metadata: JSON.stringify({
        tradingMode,
        depositType: 'RESET_INITIAL_BALANCE',
        timestamp: new Date().toISOString(),
      }),
      timestamp: new Date(),
    });

    console.log(`[resetPaperWallet] Wallet reset completed for user ${userId} (mode=${tradingMode}). Previous balance: $${balanceBefore.toFixed(2)}, New balance: $10,000.00. ${openPositions.length} positions closed. All history preserved.`);
  }, DatabaseRetryPresets.AGGRESSIVE); // Use AGGRESSIVE for critical wallet operations
}

export async function getPaperPositions(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(paperPositions)
    .where(and(
      eq(paperPositions.userId, userId),
      eq(paperPositions.status, 'open'),
      eq(paperPositions.tradingMode, tradingMode)
    ));
  return result;
}

export async function insertPaperPosition(position: InsertPaperPosition) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.insert(paperPositions).values(position);
  
  // Return the inserted position
  // MySQL2 returns [ResultSetHeader, undefined] for insert operations
  // ResultSetHeader has insertId property
  const insertResult = result as any;
  const insertId = insertResult?.[0]?.insertId || insertResult?.insertId;
  
  if (insertId) {
    const inserted = await db.select().from(paperPositions)
      .where(eq(paperPositions.id, Number(insertId)))
      .limit(1);
    return inserted[0];
  }
  
  // Fallback: Query by unique fields if insertId not available
  const inserted = await db.select().from(paperPositions)
    .where(eq(paperPositions.userId, position.userId))
    .orderBy(sql`${paperPositions.id} DESC`)
    .limit(1);
  return inserted[0];
}

/**
 * Update a paper position with partial data
 */
export async function updatePaperPosition(positionId: number, updates: Partial<InsertPaperPosition>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(paperPositions)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(paperPositions.id, positionId));
}

/**
 * Close a paper position with exit details
 */
export async function closePaperPosition(
  positionId: number,
  exitPrice: number,
  realizedPnl: number,
  exitReason: 'manual' | 'stop_loss' | 'take_profit' | 'liquidation' | 'system'
) {
  const db = await getDb();
  if (!db) return;
  
  // Phase 23: Always set exitPrice when closing a position
  await db.update(paperPositions)
    .set({
      status: 'closed',
      currentPrice: exitPrice.toString(),
      exitPrice: exitPrice.toString(),
      realizedPnl: realizedPnl.toString(),
      exitReason,
      exitTime: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paperPositions.id, positionId));
}

/**
 * Phase 23: Close all existing open positions for a given user+symbol,
 * properly calculating exitPrice and realizedPnl before closing.
 * Used to prevent duplicate open positions accumulating in the database.
 * @param currentPrice - The current market price to use as exit price
 * Returns the number of positions closed.
 */
export async function closeStalePaperPositions(userId: number, symbol: string, currentPrice?: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Find all open positions for this user+symbol with full details
  const openPositions = await db.select({
    id: paperPositions.id,
    entryPrice: paperPositions.entryPrice,
    quantity: paperPositions.quantity,
    side: paperPositions.side,
    currentPrice: paperPositions.currentPrice,
  })
    .from(paperPositions)
    .where(and(
      eq(paperPositions.userId, userId),
      eq(paperPositions.symbol, symbol),
      eq(paperPositions.status, 'open')
    ));

  if (openPositions.length === 0) return 0;

  const now = new Date();
  let closedCount = 0;

  // Phase 23: Close each position with proper P&L — REJECT if no real price
  for (const pos of openPositions) {
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const qty = parseFloat(pos.quantity || '0');
    // Use provided currentPrice first, then position's last known market price
    // NEVER fall back to entryPrice — that fabricates $0 P&L
    const exitPx = currentPrice || parseFloat(pos.currentPrice || '0');
    
    if (!exitPx || exitPx <= 0 || isNaN(exitPx)) {
      console.warn(`[closeStalePaperPositions] SKIPPED position ${pos.id} — no real market price available`);
      continue;
    }
    
    // Calculate realized P&L based on position side
    let realizedPnl = 0;
    if (entryPrice > 0 && qty > 0 && exitPx > 0) {
      if (pos.side === 'long') {
        realizedPnl = (exitPx - entryPrice) * qty;
      } else {
        realizedPnl = (entryPrice - exitPx) * qty;
      }
    }

    await db.update(paperPositions)
      .set({
        status: 'closed',
        exitReason: 'position_replaced',
        exitPrice: exitPx.toString(),
        exitTime: now,
        realizedPnl: realizedPnl.toFixed(8),
        updatedAt: now,
      })
      .where(eq(paperPositions.id, pos.id));
    closedCount++;
  }

  return closedCount;
}

export async function getPaperOrders(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(paperOrders)
    .where(and(
      eq(paperOrders.userId, userId),
      eq(paperOrders.tradingMode, tradingMode)
    ))
    .orderBy(paperOrders.createdAt);
  return result;
}

export async function insertPaperOrder(order: InsertPaperOrder) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(paperOrders).values(order);
}

export async function getPaperTrades(userId: number, tradingMode: 'paper' | 'live' = 'paper') {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(paperTrades)
    .where(and(
      eq(paperTrades.userId, userId),
      eq(paperTrades.tradingMode, tradingMode)
    ))
    .orderBy(paperTrades.timestamp);
  return result;
}

export async function insertPaperTrade(trade: InsertPaperTrade, txDb?: any) {
  const db = txDb || await getDb();
  if (!db) return;
  
  await db.insert(paperTrades).values(trade);
}

export async function getTradingModeConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(tradingModeConfig)
    .where(eq(tradingModeConfig.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertTradingModeConfig(config: InsertTradingModeConfig) {
  const db = await getDb();
  if (!db) return;
  
  // Build update set dynamically to only update provided fields
  const updateSet: Record<string, any> = {};
  if (config.mode !== undefined) updateSet.mode = config.mode;
  if (config.enableSlippage !== undefined) updateSet.enableSlippage = config.enableSlippage;
  if (config.enableCommission !== undefined) updateSet.enableCommission = config.enableCommission;
  if (config.enableMarketImpact !== undefined) updateSet.enableMarketImpact = config.enableMarketImpact;
  if (config.enableLatency !== undefined) updateSet.enableLatency = config.enableLatency;
  if (config.autoTradeEnabled !== undefined) updateSet.autoTradeEnabled = config.autoTradeEnabled;
  if (config.portfolioFunds !== undefined) updateSet.portfolioFunds = config.portfolioFunds;
  
  await db.insert(tradingModeConfig).values(config).onDuplicateKeyUpdate({
    set: updateSet,
  });
}

/**
 * Agent Accuracy Persistence
 */
export async function getAgentAccuracy(
  userId: number,
  agentName: string,
  symbol: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(agentAccuracy)
    .where(
      and(
        eq(agentAccuracy.userId, userId),
        eq(agentAccuracy.agentName, agentName),
        eq(agentAccuracy.symbol, symbol)
      )
    )
    .limit(1);

  return result.length > 0 ? parseFloat(result[0].accuracy.toString()) : null;
}

export async function updateAgentAccuracy(
  userId: number,
  agentName: string,
  symbol: string,
  wasCorrect: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Get current accuracy
  const current = await getAgentAccuracy(userId, agentName, symbol);
  
  if (current === null) {
    // Create new record
    await db.insert(agentAccuracy).values({
      userId,
      agentName,
      symbol,
      accuracy: wasCorrect ? "1.0000" : "0.0000",
      totalTrades: 1,
      correctTrades: wasCorrect ? 1 : 0,
    });
  } else {
    // Update existing record with exponential moving average
    const alpha = 0.1;
    const newAccuracy = alpha * (wasCorrect ? 1 : 0) + (1 - alpha) * current;
    
    await db
      .update(agentAccuracy)
      .set({
        accuracy: newAccuracy.toFixed(4),
        totalTrades: sql`${agentAccuracy.totalTrades} + 1`,
        correctTrades: wasCorrect ? sql`${agentAccuracy.correctTrades} + 1` : sql`${agentAccuracy.correctTrades}`,
      })
      .where(
        and(
          eq(agentAccuracy.userId, userId),
          eq(agentAccuracy.agentName, agentName),
          eq(agentAccuracy.symbol, symbol)
        )
      );
  }
}

// Automated Trading Database Helpers

export async function getAutomatedTradingSettings(userId: number): Promise<AutomatedTradingSettings | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(automatedTradingSettings).where(eq(automatedTradingSettings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertAutomatedTradingSettings(settings: InsertAutomatedTradingSettings): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert automated trading settings: database not available");
    return;
  }

  await withDatabaseRetry(async () => {
    await db.insert(automatedTradingSettings).values(settings).onDuplicateKeyUpdate({
      set: {
        enabled: settings.enabled,
        minSignalConfidence: settings.minSignalConfidence,
        maxPositionSizePercent: settings.maxPositionSizePercent,
        useKellyCriterion: settings.useKellyCriterion,
        kellyFraction: settings.kellyFraction,
        maxTradesPerDay: settings.maxTradesPerDay,
        maxOpenPositions: settings.maxOpenPositions,
        cooldownMinutes: settings.cooldownMinutes,
        maxDailyLossUSD: settings.maxDailyLossUSD,
        stopOnConsecutiveLosses: settings.stopOnConsecutiveLosses,
        requireBothAgentTypes: settings.requireBothAgentTypes,
        tradingHours: settings.tradingHours,
        allowedSymbols: settings.allowedSymbols,
        blockedSymbols: settings.blockedSymbols,
        enableTechnicalSignals: settings.enableTechnicalSignals,
        enableSentimentSignals: settings.enableSentimentSignals,
        enableOnChainSignals: settings.enableOnChainSignals,
        useMarketOrders: settings.useMarketOrders,
        limitOrderOffsetPercent: settings.limitOrderOffsetPercent,
        notifyOnExecution: settings.notifyOnExecution,
        notifyOnRejection: settings.notifyOnRejection,
        updatedAt: new Date(),
      },
    });
  }, DatabaseRetryPresets.STANDARD, "upsertAutomatedTradingSettings");
}

export async function createAutomatedTradeLog(log: InsertAutomatedTradeLog): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create automated trade log: database not available");
    return 0;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.insert(automatedTradeLog).values(log);
    return result[0].insertId;
  }, DatabaseRetryPresets.STANDARD, "createAutomatedTradeLog");
}

export async function updateAutomatedTradeLog(id: number, updates: Partial<InsertAutomatedTradeLog>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update automated trade log: database not available");
    return;
  }

  await withDatabaseRetry(async () => {
    await db.update(automatedTradeLog).set(updates).where(eq(automatedTradeLog.id, id));
  }, DatabaseRetryPresets.STANDARD, "updateAutomatedTradeLog");
}

export async function getAutomatedTradeLogsByUser(userId: number, limit: number = 100): Promise<AutomatedTradeLog[]> {
  const db = await getDb();
  if (!db) return [];

  return await withDatabaseRetry(async () => {
    return await db.select().from(automatedTradeLog)
      .where(eq(automatedTradeLog.userId, userId))
      .orderBy(desc(automatedTradeLog.createdAt))
      .limit(limit);
  }, DatabaseRetryPresets.FAST, "getAutomatedTradeLogsByUser");
}

export async function getTodayAutomatedTradeCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed"),
        gte(automatedTradeLog.createdAt, today)
      ));
    
    return result[0]?.count || 0;
  }, DatabaseRetryPresets.FAST, "getTodayAutomatedTradeCount");
}

export async function getTodayAutomatedPnL(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all executed automated trades today
    const logs = await db.select()
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed"),
        gte(automatedTradeLog.createdAt, today)
      ));
    
    // Sum up P&L from associated positions
    let totalPnL = 0;
    for (const log of logs) {
      if (log.positionId) {
        const position = await db.select()
          .from(paperPositions)
          .where(eq(paperPositions.id, log.positionId))
          .limit(1);
        
        if (position.length > 0) {
          totalPnL += Number(position[0].realizedPnl || position[0].unrealizedPnL || 0);
        }
      }
    }
    
    return totalPnL;
  }, DatabaseRetryPresets.FAST, "getTodayAutomatedPnL");
}

export async function getRecentConsecutiveLosses(userId: number, limit: number = 10): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  return await withDatabaseRetry(async () => {
    // Get recent executed trades
    const logs = await db.select()
      .from(automatedTradeLog)
      .where(and(
        eq(automatedTradeLog.userId, userId),
        eq(automatedTradeLog.status, "executed")
      ))
      .orderBy(desc(automatedTradeLog.createdAt))
      .limit(limit);
    
    let consecutiveLosses = 0;
    for (const log of logs) {
      if (log.positionId) {
        const position = await db.select()
          .from(paperPositions)
          .where(eq(paperPositions.id, log.positionId))
          .limit(1);
        
        if (position.length > 0) {
          const pnl = Number(position[0].realizedPnl || position[0].unrealizedPnL || 0);
          if (pnl < 0) {
            consecutiveLosses++;
          } else {
            break; // Stop at first win
          }
        }
      }
    }
    
    return consecutiveLosses;
  }, DatabaseRetryPresets.FAST, "getRecentConsecutiveLosses");
}

// ===== Custom Email/Password Authentication Functions =====

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  }, DatabaseRetryPresets.FAST, "getUserByEmail");
}

export async function createUser(email: string, passwordHash: string, name?: string): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  return await withDatabaseRetry(async () => {
    const result = await db.insert(users).values({
      email,
      passwordHash,
      name: name || null,
      emailVerified: false,
      loginMethod: 'email',
      role: 'user',
    });
    return Number(result[0].insertId);
  }, DatabaseRetryPresets.STANDARD, "createUser");
}

export async function updateUserEmailVerified(userId: number, verified: boolean): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await withDatabaseRetry(async () => {
    await db.update(users).set({ emailVerified: verified }).where(eq(users.id, userId));
  }, DatabaseRetryPresets.STANDARD, "updateUserEmailVerified");
}

export async function updateUserLastSignIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await withDatabaseRetry(async () => {
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
  }, DatabaseRetryPresets.FAST, "updateUserLastSignIn");
}

// OTP Verification Functions

export async function createOtpVerification(email: string, otp: string, expiresAt: Date): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { otpVerifications } = await import("../drizzle/schema");
  
  await withDatabaseRetry(async () => {
    await db.insert(otpVerifications).values({
      email,
      otp,
      expiresAt,
      verified: false,
    });
  }, DatabaseRetryPresets.STANDARD, "createOtpVerification");
}

export async function getOtpVerification(email: string, otp: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { otpVerifications } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const result = await db
      .select()
      .from(otpVerifications)
      .where(and(
        eq(otpVerifications.email, email),
        eq(otpVerifications.otp, otp),
        eq(otpVerifications.verified, false)
      ))
      .limit(1);
    return result.length > 0 ? result[0] : undefined;
  }, DatabaseRetryPresets.FAST, "getOtpVerification");
}

export async function markOtpAsVerified(otpId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { otpVerifications } = await import("../drizzle/schema");
  
  await withDatabaseRetry(async () => {
    await db.update(otpVerifications).set({ verified: true }).where(eq(otpVerifications.id, otpId));
  }, DatabaseRetryPresets.STANDARD, "markOtpAsVerified");
}


// ========================================
// TRADE JOURNAL FUNCTIONS
// ========================================

export async function getTradeJournalEntries(userId: number, limit: number = 50, offset: number = 0) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get journal entries: database not available");
    return [];
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const entries = await db.select()
      .from(tradeJournalEntries)
      .where(eq(tradeJournalEntries.userId, userId))
      .orderBy(desc(tradeJournalEntries.createdAt))
      .limit(limit)
      .offset(offset);
    return entries;
  }, DatabaseRetryPresets.STANDARD, "getTradeJournalEntries");
}

export async function getTradeJournalEntryById(userId: number, entryId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get journal entry: database not available");
    return null;
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const entries = await db.select()
      .from(tradeJournalEntries)
      .where(and(
        eq(tradeJournalEntries.userId, userId),
        eq(tradeJournalEntries.id, entryId)
      ))
      .limit(1);
    return entries[0] || null;
  }, DatabaseRetryPresets.STANDARD, "getTradeJournalEntryById");
}

export async function getJournalEntryByTradeId(userId: number, tradeId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get journal entry by trade ID: database not available");
    return null;
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const entries = await db.select()
      .from(tradeJournalEntries)
      .where(and(
        eq(tradeJournalEntries.userId, userId),
        eq(tradeJournalEntries.tradeId, tradeId)
      ))
      .limit(1);
    return entries[0] || null;
  }, DatabaseRetryPresets.STANDARD, "getJournalEntryByTradeId");
}

export async function createTradeJournalEntry(entry: any) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const result = await db.insert(tradeJournalEntries).values(entry);
    return result;
  }, DatabaseRetryPresets.STANDARD, "createTradeJournalEntry");
}

export async function updateTradeJournalEntry(userId: number, entryId: number, updates: any) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    await db.update(tradeJournalEntries)
      .set(updates)
      .where(and(
        eq(tradeJournalEntries.userId, userId),
        eq(tradeJournalEntries.id, entryId)
      ));
  }, DatabaseRetryPresets.STANDARD, "updateTradeJournalEntry");
}

export async function deleteTradeJournalEntry(userId: number, entryId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    await db.delete(tradeJournalEntries)
      .where(and(
        eq(tradeJournalEntries.userId, userId),
        eq(tradeJournalEntries.id, entryId)
      ));
  }, DatabaseRetryPresets.STANDARD, "deleteTradeJournalEntry");
}

export async function getJournalEntriesByStrategy(userId: number, strategy: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get journal entries by strategy: database not available");
    return [];
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const entries = await db.select()
      .from(tradeJournalEntries)
      .where(and(
        eq(tradeJournalEntries.userId, userId),
        eq(tradeJournalEntries.strategy, strategy)
      ))
      .orderBy(desc(tradeJournalEntries.createdAt));
    return entries;
  }, DatabaseRetryPresets.STANDARD, "getJournalEntriesByStrategy");
}

export async function getJournalStats(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get journal stats: database not available");
    return {
      totalEntries: 0,
      entriesWithTrades: 0,
      avgExecutionRating: 0,
      followedPlanRate: 0,
      topStrategies: [],
      emotionBreakdown: {},
    };
  }

  const { tradeJournalEntries } = await import("../drizzle/schema");
  
  return await withDatabaseRetry(async () => {
    const entries = await db.select()
      .from(tradeJournalEntries)
      .where(eq(tradeJournalEntries.userId, userId));
    
    const totalEntries = entries.length;
    const entriesWithTrades = entries.filter(e => e.tradeId !== null).length;
    
    const ratingsSum = entries.reduce((sum, e) => sum + (e.executionRating || 0), 0);
    const ratingsCount = entries.filter(e => e.executionRating !== null).length;
    const avgExecutionRating = ratingsCount > 0 ? ratingsSum / ratingsCount : 0;
    
    const followedPlanCount = entries.filter(e => e.followedPlan === true).length;
    const planEntriesCount = entries.filter(e => e.followedPlan !== null).length;
    const followedPlanRate = planEntriesCount > 0 ? followedPlanCount / planEntriesCount : 0;
    
    // Count strategies
    const strategyCounts: Record<string, number> = {};
    entries.forEach(e => {
      if (e.strategy) {
        strategyCounts[e.strategy] = (strategyCounts[e.strategy] || 0) + 1;
      }
    });
    const topStrategies = Object.entries(strategyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([strategy, count]) => ({ strategy, count }));
    
    // Emotion breakdown
    const emotionBreakdown = {
      before: {} as Record<string, number>,
      during: {} as Record<string, number>,
      after: {} as Record<string, number>,
    };
    entries.forEach(e => {
      if (e.emotionBefore) {
        emotionBreakdown.before[e.emotionBefore] = (emotionBreakdown.before[e.emotionBefore] || 0) + 1;
      }
      if (e.emotionDuring) {
        emotionBreakdown.during[e.emotionDuring] = (emotionBreakdown.during[e.emotionDuring] || 0) + 1;
      }
      if (e.emotionAfter) {
        emotionBreakdown.after[e.emotionAfter] = (emotionBreakdown.after[e.emotionAfter] || 0) + 1;
      }
    });
    
    return {
      totalEntries,
      entriesWithTrades,
      avgExecutionRating,
      followedPlanRate,
      topStrategies,
      emotionBreakdown,
    };
  }, DatabaseRetryPresets.STANDARD, "getJournalStats");
}

// ============================================
// Trading Activity Log Functions
// ============================================

export interface TradingActivityLogEntry {
  userId: number;
  activityType: 'order_placed' | 'order_filled' | 'order_partially_filled' | 'order_rejected' | 'order_cancelled' | 'order_modified' | 'position_opened' | 'position_closed' | 'stop_loss_triggered' | 'take_profit_triggered' | 'margin_call' | 'balance_check' | 'mode_switch';
  tradingMode: 'paper' | 'live';
  orderId?: string;
  tradeId?: number;
  positionId?: number;
  exchangeId?: number;
  symbol?: string;
  side?: 'buy' | 'sell' | 'long' | 'short';
  orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
  quantity?: number;
  price?: number;
  filledQuantity?: number;
  filledPrice?: number;
  status: 'success' | 'failed' | 'pending' | 'partial';
  errorCode?: string;
  errorMessage?: string;
  fees?: number;
  pnl?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  triggeredBy?: 'user' | 'system' | 'ai_agent' | 'stop_loss' | 'take_profit' | 'margin_call';
  agentId?: string;
  signalId?: number;
  metadata?: Record<string, unknown>;
  executedAt?: Date;
}

export async function logTradingActivity(entry: TradingActivityLogEntry): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot log trading activity: database not available");
    return 0;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      INSERT INTO tradingActivityLog (
        userId, activityType, tradingMode, orderId, tradeId, positionId, exchangeId,
        symbol, side, orderType, quantity, price, filledQuantity, filledPrice,
        status, errorCode, errorMessage, fees, pnl, balanceBefore, balanceAfter,
        triggeredBy, agentId, signalId, metadata, executedAt
      ) VALUES (
        ${entry.userId}, ${entry.activityType}, ${entry.tradingMode},
        ${entry.orderId || null}, ${entry.tradeId || null}, ${entry.positionId || null}, ${entry.exchangeId || null},
        ${entry.symbol || null}, ${entry.side || null}, ${entry.orderType || null},
        ${entry.quantity || null}, ${entry.price || null}, ${entry.filledQuantity || null}, ${entry.filledPrice || null},
        ${entry.status}, ${entry.errorCode || null}, ${entry.errorMessage || null},
        ${entry.fees || null}, ${entry.pnl || null}, ${entry.balanceBefore || null}, ${entry.balanceAfter || null},
        ${entry.triggeredBy || null}, ${entry.agentId || null}, ${entry.signalId || null},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null}, ${entry.executedAt || null}
      )
    `);
    return (result as any)[0]?.insertId || 0;
  }, DatabaseRetryPresets.STANDARD, "logTradingActivity");
}

export interface TradingActivityLogFilter {
  userId: number;
  activityTypes?: string[];
  tradingMode?: 'paper' | 'live';
  symbol?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export async function getTradingActivityLogs(filter: TradingActivityLogFilter) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get trading activity logs: database not available");
    return { logs: [], total: 0 };
  }

  return await withDatabaseRetry(async () => {
    // Build WHERE conditions
    const conditions: string[] = [`userId = ${filter.userId}`];
    
    if (filter.activityTypes && filter.activityTypes.length > 0) {
      conditions.push(`activityType IN (${filter.activityTypes.map(t => `'${t}'`).join(',')})`);
    }
    if (filter.tradingMode) {
      conditions.push(`tradingMode = '${filter.tradingMode}'`);
    }
    if (filter.symbol) {
      conditions.push(`symbol = '${filter.symbol}'`);
    }
    if (filter.status) {
      conditions.push(`status = '${filter.status}'`);
    }
    if (filter.startDate) {
      conditions.push(`timestamp >= '${filter.startDate.toISOString().slice(0, 19).replace('T', ' ')}'`);
    }
    if (filter.endDate) {
      conditions.push(`timestamp <= '${filter.endDate.toISOString().slice(0, 19).replace('T', ' ')}'`);
    }

    const whereClause = conditions.join(' AND ');
    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    // Get total count
    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as total FROM tradingActivityLog WHERE ${whereClause}
    `));
    const total = (countResult as any)[0]?.[0]?.total || 0;

    // Get logs
    const logsResult = await db.execute(sql.raw(`
      SELECT * FROM tradingActivityLog 
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    return {
      logs: (logsResult as any)[0] || [],
      total,
    };
  }, DatabaseRetryPresets.STANDARD, "getTradingActivityLogs");
}

export async function getRecentTradingActivity(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get recent trading activity: database not available");
    return [];
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      SELECT * FROM tradingActivityLog 
      WHERE userId = ${userId}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);
    return (result as any)[0] || [];
  }, DatabaseRetryPresets.STANDARD, "getRecentTradingActivity");
}

export async function getTradingActivityStats(userId: number, tradingMode?: 'paper' | 'live') {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get trading activity stats: database not available");
    return {
      totalOrders: 0,
      filledOrders: 0,
      rejectedOrders: 0,
      cancelledOrders: 0,
      totalVolume: 0,
      totalFees: 0,
      totalPnL: 0,
    };
  }

  return await withDatabaseRetry(async () => {
    const modeCondition = tradingMode ? `AND tradingMode = '${tradingMode}'` : '';
    
    const result = await db.execute(sql.raw(`
      SELECT 
        COUNT(CASE WHEN activityType = 'order_placed' THEN 1 END) as totalOrders,
        COUNT(CASE WHEN activityType = 'order_filled' THEN 1 END) as filledOrders,
        COUNT(CASE WHEN activityType = 'order_rejected' THEN 1 END) as rejectedOrders,
        COUNT(CASE WHEN activityType = 'order_cancelled' THEN 1 END) as cancelledOrders,
        COALESCE(SUM(CASE WHEN activityType = 'order_filled' THEN quantity * filledPrice ELSE 0 END), 0) as totalVolume,
        COALESCE(SUM(fees), 0) as totalFees,
        COALESCE(SUM(pnl), 0) as totalPnL
      FROM tradingActivityLog 
      WHERE userId = ${userId} ${modeCondition}
    `));

    const stats = (result as any)[0]?.[0] || {};
    return {
      totalOrders: Number(stats.totalOrders) || 0,
      filledOrders: Number(stats.filledOrders) || 0,
      rejectedOrders: Number(stats.rejectedOrders) || 0,
      cancelledOrders: Number(stats.cancelledOrders) || 0,
      totalVolume: Number(stats.totalVolume) || 0,
      totalFees: Number(stats.totalFees) || 0,
      totalPnL: Number(stats.totalPnL) || 0,
    };
  }, DatabaseRetryPresets.STANDARD, "getTradingActivityStats");
}

// ============================================
// Balance Verification Functions
// ============================================

export interface BalanceVerificationEntry {
  userId: number;
  exchangeId: number;
  verificationType: 'pre_live_switch' | 'pre_trade' | 'periodic_check' | 'manual_check';
  availableBalance: number;
  totalBalance: number;
  marginUsed?: number;
  currency: string;
  minimumRequired: number;
  isVerified: boolean;
  verificationMessage?: string;
  actionAllowed: boolean;
  actionBlocked: boolean;
  blockReason?: string;
  exchangeResponse?: Record<string, unknown>;
  latencyMs?: number;
}

export async function logBalanceVerification(entry: BalanceVerificationEntry): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot log balance verification: database not available");
    return 0;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      INSERT INTO balanceVerificationLog (
        userId, exchangeId, verificationType, availableBalance, totalBalance,
        marginUsed, currency, minimumRequired, isVerified, verificationMessage,
        actionAllowed, actionBlocked, blockReason, exchangeResponse, latencyMs
      ) VALUES (
        ${entry.userId}, ${entry.exchangeId}, ${entry.verificationType},
        ${entry.availableBalance}, ${entry.totalBalance}, ${entry.marginUsed || null},
        ${entry.currency}, ${entry.minimumRequired}, ${entry.isVerified},
        ${entry.verificationMessage || null}, ${entry.actionAllowed}, ${entry.actionBlocked},
        ${entry.blockReason || null}, ${entry.exchangeResponse ? JSON.stringify(entry.exchangeResponse) : null},
        ${entry.latencyMs || null}
      )
    `);
    return (result as any)[0]?.insertId || 0;
  }, DatabaseRetryPresets.STANDARD, "logBalanceVerification");
}

export async function getBalanceVerificationHistory(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get balance verification history: database not available");
    return [];
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      SELECT * FROM balanceVerificationLog 
      WHERE userId = ${userId}
      ORDER BY createdAt DESC
      LIMIT ${limit}
    `);
    return (result as any)[0] || [];
  }, DatabaseRetryPresets.STANDARD, "getBalanceVerificationHistory");
}

export async function getLastBalanceVerification(userId: number, exchangeId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get last balance verification: database not available");
    return null;
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      SELECT * FROM balanceVerificationLog 
      WHERE userId = ${userId} AND exchangeId = ${exchangeId}
      ORDER BY createdAt DESC
      LIMIT 1
    `);
    return (result as any)[0]?.[0] || null;
  }, DatabaseRetryPresets.STANDARD, "getLastBalanceVerification");
}


// ============================================
// Execution Latency Logging Functions
// ============================================

export interface ExecutionLatencyEntry {
  userId: number;
  signalId: string;
  symbol: string;
  signalGeneratedAt: number;
  consensusCalculatedAt?: number;
  decisionMadeAt?: number;
  orderPlacedAt?: number;
  orderFilledAt?: number;
  totalLatencyMs: number;
  executionResult: 'executed' | 'rejected' | 'skipped' | 'failed' | 'timeout';
  agentCount: number;
  consensusStrength?: string;
  priceAtSignal?: string;
  priceAtExecution?: string;
  slippageMs?: number;
}

/**
 * Calculate latency grade based on total latency
 * - excellent: < 50ms
 * - good: 50-100ms
 * - acceptable: 100-250ms
 * - slow: 250-500ms
 * - critical: > 500ms
 */
function calculateLatencyGrade(totalLatencyMs: number): 'excellent' | 'good' | 'acceptable' | 'slow' | 'critical' {
  if (totalLatencyMs < 50) return 'excellent';
  if (totalLatencyMs < 100) return 'good';
  if (totalLatencyMs < 250) return 'acceptable';
  if (totalLatencyMs < 500) return 'slow';
  return 'critical';
}

export async function logExecutionLatency(entry: ExecutionLatencyEntry): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot log execution latency: database not available");
    return 0;
  }

  // Calculate individual stage latencies
  const signalToConsensusMs = entry.consensusCalculatedAt 
    ? entry.consensusCalculatedAt - entry.signalGeneratedAt 
    : null;
  const consensusToDecisionMs = entry.decisionMadeAt && entry.consensusCalculatedAt
    ? entry.decisionMadeAt - entry.consensusCalculatedAt
    : null;
  const decisionToOrderMs = entry.orderPlacedAt && entry.decisionMadeAt
    ? entry.orderPlacedAt - entry.decisionMadeAt
    : null;
  const orderToFillMs = entry.orderFilledAt && entry.orderPlacedAt
    ? entry.orderFilledAt - entry.orderPlacedAt
    : null;

  const latencyGrade = calculateLatencyGrade(entry.totalLatencyMs);

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      INSERT INTO executionLatencyLogs (
        userId, signalId, symbol,
        signalGeneratedAt, consensusCalculatedAt, decisionMadeAt, orderPlacedAt, orderFilledAt,
        signalToConsensusMs, consensusToDecisionMs, decisionToOrderMs, orderToFillMs,
        totalLatencyMs, executionResult, agentCount, consensusStrength,
        priceAtSignal, priceAtExecution, slippageMs, latencyGrade
      ) VALUES (
        ${entry.userId}, ${entry.signalId}, ${entry.symbol},
        ${entry.signalGeneratedAt}, ${entry.consensusCalculatedAt || null}, 
        ${entry.decisionMadeAt || null}, ${entry.orderPlacedAt || null}, ${entry.orderFilledAt || null},
        ${signalToConsensusMs}, ${consensusToDecisionMs}, ${decisionToOrderMs}, ${orderToFillMs},
        ${entry.totalLatencyMs}, ${entry.executionResult}, ${entry.agentCount},
        ${entry.consensusStrength || null}, ${entry.priceAtSignal || null}, 
        ${entry.priceAtExecution || null}, ${entry.slippageMs || null}, ${latencyGrade}
      )
    `);
    return (result as any)[0]?.insertId || 0;
  }, DatabaseRetryPresets.STANDARD, "logExecutionLatency");
}

export interface LatencyMetrics {
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  totalExecutions: number;
  executedCount: number;
  rejectedCount: number;
  skippedCount: number;
  failedCount: number;
  excellentCount: number;
  goodCount: number;
  acceptableCount: number;
  slowCount: number;
  criticalCount: number;
}

export async function getLatencyMetrics(userId: number, hours: number = 24): Promise<LatencyMetrics> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get latency metrics: database not available");
    return {
      avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0,
      minLatencyMs: 0, maxLatencyMs: 0, totalExecutions: 0,
      executedCount: 0, rejectedCount: 0, skippedCount: 0, failedCount: 0,
      excellentCount: 0, goodCount: 0, acceptableCount: 0, slowCount: 0, criticalCount: 0
    };
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      SELECT 
        AVG(totalLatencyMs) as avgLatencyMs,
        MIN(totalLatencyMs) as minLatencyMs,
        MAX(totalLatencyMs) as maxLatencyMs,
        COUNT(*) as totalExecutions,
        SUM(CASE WHEN executionResult = 'executed' THEN 1 ELSE 0 END) as executedCount,
        SUM(CASE WHEN executionResult = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
        SUM(CASE WHEN executionResult = 'skipped' THEN 1 ELSE 0 END) as skippedCount,
        SUM(CASE WHEN executionResult = 'failed' THEN 1 ELSE 0 END) as failedCount,
        SUM(CASE WHEN latencyGrade = 'excellent' THEN 1 ELSE 0 END) as excellentCount,
        SUM(CASE WHEN latencyGrade = 'good' THEN 1 ELSE 0 END) as goodCount,
        SUM(CASE WHEN latencyGrade = 'acceptable' THEN 1 ELSE 0 END) as acceptableCount,
        SUM(CASE WHEN latencyGrade = 'slow' THEN 1 ELSE 0 END) as slowCount,
        SUM(CASE WHEN latencyGrade = 'critical' THEN 1 ELSE 0 END) as criticalCount
      FROM executionLatencyLogs
      WHERE userId = ${userId} AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
    `);

    // Get percentiles separately
    const percentileResult = await db.execute(sql`
      SELECT totalLatencyMs
      FROM executionLatencyLogs
      WHERE userId = ${userId} AND createdAt >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
      ORDER BY totalLatencyMs ASC
    `);

    const latencies = ((percentileResult as any)[0] || []).map((r: any) => r.totalLatencyMs);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

    const stats = (result as any)[0]?.[0] || {};
    return {
      avgLatencyMs: Number(stats.avgLatencyMs) || 0,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      minLatencyMs: Number(stats.minLatencyMs) || 0,
      maxLatencyMs: Number(stats.maxLatencyMs) || 0,
      totalExecutions: Number(stats.totalExecutions) || 0,
      executedCount: Number(stats.executedCount) || 0,
      rejectedCount: Number(stats.rejectedCount) || 0,
      skippedCount: Number(stats.skippedCount) || 0,
      failedCount: Number(stats.failedCount) || 0,
      excellentCount: Number(stats.excellentCount) || 0,
      goodCount: Number(stats.goodCount) || 0,
      acceptableCount: Number(stats.acceptableCount) || 0,
      slowCount: Number(stats.slowCount) || 0,
      criticalCount: Number(stats.criticalCount) || 0,
    };
  }, DatabaseRetryPresets.STANDARD, "getLatencyMetrics");
}

export async function getRecentLatencyLogs(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get recent latency logs: database not available");
    return [];
  }

  return await withDatabaseRetry(async () => {
    const result = await db.execute(sql`
      SELECT * FROM executionLatencyLogs 
      WHERE userId = ${userId}
      ORDER BY createdAt DESC
      LIMIT ${limit}
    `);
    return (result as any)[0] || [];
  }, DatabaseRetryPresets.STANDARD, "getRecentLatencyLogs");
}


// ─── Price History Helpers (RL Training Pipeline) ───────────────────────────

import { priceHistory, InsertPriceHistory } from '../drizzle/schema';

/**
 * Save price history candles to the priceHistory table.
 * Uses ON DUPLICATE KEY UPDATE to handle re-inserts gracefully.
 * 
 * @param records Array of price history records to insert
 * @returns Number of records saved
 */
export async function savePriceHistory(records: InsertPriceHistory[]): Promise<number> {
  const db = await getDb();
  if (!db || records.length === 0) return 0;

  try {
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await db.insert(priceHistory).values(batch).onDuplicateKeyUpdate({
        set: {
          open: sql`VALUES(open)`,
          high: sql`VALUES(high)`,
          low: sql`VALUES(low)`,
          close: sql`VALUES(close)`,
          volume: sql`VALUES(volume)`,
        },
      });
      totalInserted += batch.length;
    }

    return totalInserted;
  } catch (error) {
    console.error('[Database] Failed to save price history:', error);
    return 0;
  }
}

/**
 * Load price history candles for a symbol within a time range.
 * 
 * @param symbol Trading symbol (e.g., "BTC-USD")
 * @param startMs Start timestamp in milliseconds
 * @param endMs End timestamp in milliseconds
 * @param limit Max records to return (default 10000)
 * @returns Array of price history rows
 */
export async function loadPriceHistory(
  symbol: string,
  startMs: number,
  endMs: number,
  limit: number = 10000
) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          gte(priceHistory.timestamp, startMs),
          lte(priceHistory.timestamp, endMs)
        )
      )
      .orderBy(asc(priceHistory.timestamp))
      .limit(limit);
  } catch (error) {
    console.error('[Database] Failed to load price history:', error);
    return [];
  }
}

/**
 * Get the latest price history timestamp for a symbol.
 * Used to determine where to start fetching new data.
 * 
 * @param symbol Trading symbol
 * @returns Latest timestamp in ms or null if no data
 */
export async function getLatestPriceHistoryTimestamp(symbol: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .select({ ts: priceHistory.timestamp })
      .from(priceHistory)
      .where(eq(priceHistory.symbol, symbol))
      .orderBy(desc(priceHistory.timestamp))
      .limit(1);

    return result.length > 0 ? result[0].ts : null;
  } catch (error) {
    console.error('[Database] Failed to get latest price history timestamp:', error);
    return null;
  }
}

/**
 * Get total count of price history records for a symbol.
 * 
 * @param symbol Trading symbol
 * @returns Number of records
 */
export async function getPriceHistoryCount(symbol: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(priceHistory)
      .where(eq(priceHistory.symbol, symbol));

    return result[0]?.count ?? 0;
  } catch (error) {
    console.error('[Database] Failed to count price history:', error);
    return 0;
  }
}
