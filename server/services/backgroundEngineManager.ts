/**
 * Background Engine Manager — Phase 14D
 *
 * Phase 13B: Complete rewrite to eliminate the restart loop.
 * Phase 14D: Migrated from legacy SEERMultiEngine to EngineAdapter.
 *
 * NEW DESIGN:
 * - Poll every 5 minutes — engine's own health monitoring handles crash recovery
 * - Uses EngineAdapter (wraps UserTradingSession + GlobalMarketEngine) instead of legacy engine
 * - Exponential backoff per user on repeated failures
 * - Log ONLY on state changes (start, stop, failure) — not on every poll
 */

import { getDb } from '../db';
import { exchanges, tradingModeConfig, tradingSymbols, apiKeys, engineState } from '../../drizzle/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

// Track which users have engines running
const activeUserEngines = new Set<number>();

// Phase 13B: Track failure counts for exponential backoff
const userFailureCounts = new Map<number, { count: number; lastAttemptMs: number }>();

// Phase 13B: Increased from 60s to 5 minutes.
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Query timeout (10 seconds)
const QUERY_TIMEOUT = 10000;

// Phase 13B: Max backoff = 30 minutes.
const MAX_BACKOFF_MS = 30 * 60 * 1000;

let checkInterval: NodeJS.Timeout | null = null;
let isInitialized = false;
let checkCount = 0;

/**
 * Execute a database query with timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T | null> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<null>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: ${operation}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    console.error(`[BackgroundEngineManager] Query failed: ${operation}`, (error as Error)?.message);
    return null;
  }
}

/**
 * Get all users who need engines (single combined query approach)
 */
async function getUsersNeedingEngines(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];

  const userIds = new Set<number>();

  try {
    // Priority 1: Users with engine state marked as running
    const stateResult = await withTimeout(
      db.select({ userId: engineState.userId }).from(engineState).where(eq(engineState.isRunning, true)),
      QUERY_TIMEOUT, 'engineState'
    );
    if (stateResult) stateResult.forEach(r => userIds.add(r.userId));

    // Priority 2: Users with configured exchanges
    const exchangeResult = await withTimeout(
      db.select({ userId: exchanges.userId }).from(exchanges)
        .innerJoin(apiKeys, eq(apiKeys.exchangeId, exchanges.id))
        .where(and(eq(exchanges.isActive, true), isNotNull(apiKeys.encryptedApiKey)))
        .groupBy(exchanges.userId),
      QUERY_TIMEOUT, 'exchanges'
    );
    if (exchangeResult) exchangeResult.forEach(r => userIds.add(r.userId));

    // Priority 3: Users with paper trading enabled
    const paperResult = await withTimeout(
      db.select({ userId: tradingModeConfig.userId }).from(tradingModeConfig)
        .where(and(eq(tradingModeConfig.mode, 'paper'), eq(tradingModeConfig.autoTradeEnabled, true))),
      QUERY_TIMEOUT, 'paperTrading'
    );
    if (paperResult) paperResult.forEach(r => userIds.add(r.userId));
  } catch (error) {
    console.error('[BackgroundEngineManager] Error querying users:', (error as Error)?.message);
  }

  return Array.from(userIds);
}

/**
 * Phase 13B: Check if we should skip this user due to backoff
 */
function shouldSkipDueToBackoff(userId: number): boolean {
  const failure = userFailureCounts.get(userId);
  if (!failure || failure.count === 0) return false;

  const backoffMs = Math.min(CHECK_INTERVAL * Math.pow(2, failure.count - 1), MAX_BACKOFF_MS);
  const elapsed = Date.now() - failure.lastAttemptMs;

  if (elapsed < backoffMs) {
    return true;
  }
  return false;
}

/**
 * Record a start failure for backoff tracking
 */
function recordFailure(userId: number): void {
  const existing = userFailureCounts.get(userId) || { count: 0, lastAttemptMs: 0 };
  userFailureCounts.set(userId, { count: existing.count + 1, lastAttemptMs: Date.now() });
}

/**
 * Clear failure tracking on success
 */
function clearFailure(userId: number): void {
  userFailureCounts.delete(userId);
}

/**
 * Start engine for a specific user
 * Phase 14D: Uses EngineAdapter instead of legacy SEERMultiEngine
 */
async function startEngineForUser(userId: number): Promise<boolean> {
  try {
    const { getEngineAdapter, getExistingAdapter } = await import('./EngineAdapter');

    // Check if adapter already exists and is running
    const existing = getExistingAdapter(userId);
    if (existing) {
      const status = existing.getStatus();
      if (status.isRunning) {
        if (!activeUserEngines.has(userId)) {
          activeUserEngines.add(userId);
        }
        clearFailure(userId);
        return true;
      }
    }

    // Create adapter (this also creates the UserTradingSession)
    console.log(`[BackgroundEngineManager] Starting engine adapter for user ${userId}`);
    const adapter = await getEngineAdapter(userId);
    await adapter.start();
    activeUserEngines.add(userId);
    clearFailure(userId);
    console.log(`[BackgroundEngineManager] Engine adapter started for user ${userId}`);
    return true;
  } catch (error) {
    recordFailure(userId);
    const failure = userFailureCounts.get(userId)!;
    console.error(`[BackgroundEngineManager] Failed to start engine adapter for user ${userId} (attempt ${failure.count}):`, (error as Error)?.message);
    activeUserEngines.delete(userId);
    return false;
  }
}

/**
 * Phase 13B: Verify engines that we think are running actually ARE running.
 * Phase 14D: Uses EngineAdapter instead of legacy engine.
 */
async function verifyActiveEngines(): Promise<void> {
  if (activeUserEngines.size === 0) return;

  try {
    const { getExistingAdapter } = await import('./EngineAdapter');

    for (const userId of Array.from(activeUserEngines)) {
      const adapter = getExistingAdapter(userId);
      if (!adapter || !adapter.getStatus().isRunning) {
        activeUserEngines.delete(userId);
      }
    }
  } catch {
    // If we can't even import EngineAdapter, something is very wrong
    // Don't clear the set — next poll will retry
  }
}

/**
 * Check for users needing engines and start them
 */
async function checkAndStartEngines(): Promise<void> {
  checkCount++;

  await verifyActiveEngines();

  const allUsers = await getUsersNeedingEngines();

  if (allUsers.length === 0) return;

  let startedCount = 0;
  let failedCount = 0;
  let skippedBackoff = 0;

  for (const userId of allUsers) {
    if (activeUserEngines.has(userId)) continue;

    if (shouldSkipDueToBackoff(userId)) {
      skippedBackoff++;
      continue;
    }

    const success = await startEngineForUser(userId);
    if (success) {
      startedCount++;
    } else {
      failedCount++;
    }
  }

  // Phase 13B: Only log if something interesting happened, or every 12th check (~1 hour)
  if (startedCount > 0 || failedCount > 0 || checkCount % 12 === 0) {
    console.log(`[BackgroundEngineManager] Check #${checkCount}: users=${allUsers.length}, active=${activeUserEngines.size}, started=${startedCount}, failed=${failedCount}, backoff=${skippedBackoff}`);
  }
}

/**
 * Initialize the background engine manager
 */
export async function initBackgroundEngineManager(): Promise<void> {
  if (isInitialized) return;

  console.log('[BackgroundEngineManager] Initializing (check interval: 5 minutes)');

  await checkAndStartEngines();

  checkInterval = setInterval(checkAndStartEngines, CHECK_INTERVAL);

  isInitialized = true;
  console.log(`[BackgroundEngineManager] Initialized. Active engines: ${activeUserEngines.size}`);
}

/**
 * Stop the background engine manager
 * Phase 14D: Uses stopAllAdapters instead of legacy stopAllEngines
 */
export async function stopBackgroundEngineManager(): Promise<void> {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  try {
    const { stopAllAdapters } = await import('./EngineAdapter');
    console.log('[BackgroundEngineManager] Stopping all active engine adapters...');
    await stopAllAdapters();
    console.log('[BackgroundEngineManager] All engine adapters stopped');
  } catch (error) {
    console.error('[BackgroundEngineManager] Failed to stop engine adapters:', (error as Error)?.message);
  }

  isInitialized = false;
  activeUserEngines.clear();
  userFailureCounts.clear();
  console.log('[BackgroundEngineManager] Stopped');
}

/**
 * Get list of users with active engines
 */
export function getActiveEngineUsers(): number[] {
  return Array.from(activeUserEngines);
}

/**
 * Manually trigger engine start for a specific user
 */
export async function triggerEngineStartForUser(userId: number): Promise<boolean> {
  clearFailure(userId);
  return startEngineForUser(userId);
}

/**
 * Force restart engine for a specific user
 */
export async function forceRestartEngineForUser(userId: number): Promise<boolean> {
  console.log(`[BackgroundEngineManager] Force restarting engine adapter for user ${userId}`);
  activeUserEngines.delete(userId);
  clearFailure(userId);
  return startEngineForUser(userId);
}
