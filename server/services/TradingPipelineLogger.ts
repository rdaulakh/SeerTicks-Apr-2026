/**
 * TradingPipelineLogger — Dedicated logging for all trading pipeline decisions.
 *
 * Writes to:
 * 1. A dedicated file (trading-pipeline.log) with size-based rotation (immune to dev server log truncation)
 * 2. The tradingPipelineLog DB table for permanent audit trail and dashboard queries
 * 3. Console (for dev server log, best-effort)
 *
 * Event types:
 * - CONSENSUS: Agent consensus computation result
 * - SIGNAL_APPROVED: Signal passed all filters and approved for execution
 * - SIGNAL_REJECTED: Signal failed filters (low confidence, combined score, etc.)
 * - TRADE_EXECUTED: Trade successfully placed
 * - TRADE_REJECTED: Trade blocked by risk checks (position limit, VaR, circuit breaker)
 * - POSITION_OPENED: New position opened
 * - POSITION_CLOSED: Position closed (any reason)
 * - EXIT_BREAKEVEN: Breakeven stop activated
 * - EXIT_PARTIAL: Partial profit taken
 * - EXIT_EMERGENCY: Emergency exit triggered (max loss)
 * - EXIT_TRAILING: Trailing stop triggered
 * - EXIT_AGENT_CONSENSUS: Exit triggered by agent consensus flip
 * - EXIT_TIME_DECAY: Exit triggered by time-based decay
 * - POSITION_FLIP: Existing position closed and reversed
 * - RISK_CHECK: Risk check result (VaR, circuit breaker)
 * - SYSTEM_START: Pipeline system started
 * - SYSTEM_STOP: Pipeline system stopped
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────
export type PipelineEventType =
  | 'CONSENSUS'
  | 'SIGNAL_APPROVED'
  | 'SIGNAL_REJECTED'
  | 'TRADE_EXECUTED'
  | 'TRADE_REJECTED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'EXIT_BREAKEVEN'
  | 'EXIT_PARTIAL'
  | 'EXIT_EMERGENCY'
  | 'EXIT_TRAILING'
  | 'EXIT_AGENT_CONSENSUS'
  | 'EXIT_TIME_DECAY'
  | 'POSITION_FLIP'
  | 'RISK_CHECK'
  | 'SYSTEM_START'
  | 'SYSTEM_STOP';

export interface PipelineLogEntry {
  timestamp: string;
  eventType: PipelineEventType;
  userId?: number;
  symbol?: string;
  direction?: string;
  action?: string;
  confidence?: number;
  price?: number;
  quantity?: number;
  pnl?: number;
  pnlPercent?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// ─── File Logger with Rotation ────────────────────────────────────────
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'trading-pipeline.log');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED_FILES = 7; // Keep 7 days of rotated logs

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Silently fail — file logging is best-effort
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_FILE_SIZE) return;

    // Rotate: trading-pipeline.log → trading-pipeline.1.log → ... → trading-pipeline.7.log
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const from = path.join(LOG_DIR, `trading-pipeline.${i}.log`);
      const to = path.join(LOG_DIR, `trading-pipeline.${i + 1}.log`);
      if (fs.existsSync(from)) {
        if (i === MAX_ROTATED_FILES - 1) {
          fs.unlinkSync(from); // Delete oldest
        } else {
          fs.renameSync(from, to);
        }
      }
    }
    fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'trading-pipeline.1.log'));
  } catch {
    // Silently fail — rotation is best-effort
  }
}

function writeToFile(entry: PipelineLogEntry): void {
  try {
    rotateIfNeeded();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Silently fail — file logging is best-effort
  }
}

// ─── DB Writer (async, non-blocking) ──────────────────────────────────
let dbWriteQueue: PipelineLogEntry[] = [];
let dbFlushTimer: ReturnType<typeof setInterval> | null = null;

async function flushToDb(): Promise<void> {
  if (dbWriteQueue.length === 0) return;
  const batch = dbWriteQueue.splice(0, 50); // Flush up to 50 at a time

  try {
    const { getDb } = await import('../db');
    const { tradingPipelineLog } = await import('../../drizzle/schema');
    const db = await getDb();
    if (!db) return;

    const rows = batch.map(entry => ({
      userId: entry.userId ?? null,
      eventType: entry.eventType,
      symbol: entry.symbol ?? null,
      direction: entry.direction ?? null,
      action: entry.action ?? null,
      confidence: entry.confidence?.toString() ?? null,
      price: entry.price?.toString() ?? null,
      quantity: entry.quantity?.toString() ?? null,
      pnl: entry.pnl?.toString() ?? null,
      pnlPercent: entry.pnlPercent?.toString() ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? null,
    }));

    await db.insert(tradingPipelineLog).values(rows);
  } catch (err) {
    // Re-queue failed entries (up to 200 max to prevent memory leak)
    if (dbWriteQueue.length < 200) {
      dbWriteQueue.unshift(...batch);
    }
    console.error(`[TradingPipelineLogger] DB flush failed: ${err instanceof Error ? err.message : err}`);
  }
}

function startDbFlush(): void {
  if (dbFlushTimer) return;
  dbFlushTimer = setInterval(() => {
    flushToDb().catch(() => {});
  }, 5000); // Flush every 5 seconds
}

// ─── Console Writer ───────────────────────────────────────────────────
function writeToConsole(entry: PipelineLogEntry): void {
  const icon = getEventIcon(entry.eventType);
  const parts: string[] = [
    `[${entry.timestamp}]`,
    `[Pipeline]`,
    `${icon} ${entry.eventType}`,
  ];
  if (entry.symbol) parts.push(`symbol=${entry.symbol}`);
  if (entry.direction) parts.push(`dir=${entry.direction}`);
  if (entry.action) parts.push(`action=${entry.action}`);
  if (entry.confidence !== undefined) parts.push(`conf=${(entry.confidence * 100).toFixed(1)}%`);
  if (entry.price !== undefined) parts.push(`price=$${entry.price.toFixed(2)}`);
  if (entry.quantity !== undefined) parts.push(`qty=${entry.quantity}`);
  if (entry.pnl !== undefined) parts.push(`pnl=$${entry.pnl.toFixed(2)}`);
  if (entry.pnlPercent !== undefined) parts.push(`pnl%=${entry.pnlPercent.toFixed(2)}%`);
  if (entry.reason) parts.push(`reason="${entry.reason}"`);

  console.log(parts.join(' '));
}

function getEventIcon(eventType: PipelineEventType): string {
  switch (eventType) {
    case 'CONSENSUS': return '📊';
    case 'SIGNAL_APPROVED': return '✅';
    case 'SIGNAL_REJECTED': return '❌';
    case 'TRADE_EXECUTED': return '💰';
    case 'TRADE_REJECTED': return '🚫';
    case 'POSITION_OPENED': return '📈';
    case 'POSITION_CLOSED': return '📉';
    case 'EXIT_BREAKEVEN': return '⚖️';
    case 'EXIT_PARTIAL': return '💵';
    case 'EXIT_EMERGENCY': return '🚨';
    case 'EXIT_TRAILING': return '📏';
    case 'EXIT_AGENT_CONSENSUS': return '🤖';
    case 'EXIT_TIME_DECAY': return '⏰';
    case 'POSITION_FLIP': return '🔄';
    case 'RISK_CHECK': return '🛡️';
    case 'SYSTEM_START': return '🟢';
    case 'SYSTEM_STOP': return '🔴';
    default: return '📝';
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Log a trading pipeline event. Writes to file, DB, and console.
 * Non-blocking — DB writes are batched and flushed every 5s.
 */
export function logPipelineEvent(
  eventType: PipelineEventType,
  data: Omit<PipelineLogEntry, 'timestamp' | 'eventType'> = {}
): void {
  const entry: PipelineLogEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    ...data,
  };

  // 1. Write to dedicated file (synchronous, fast)
  writeToFile(entry);

  // 2. Queue for DB write (async, batched)
  dbWriteQueue.push(entry);

  // 3. Write to console (for dev server log, best-effort)
  writeToConsole(entry);
}

/**
 * Initialize the pipeline logger. Call once on server startup.
 */
export function initPipelineLogger(): void {
  ensureLogDir();
  startDbFlush();
  logPipelineEvent('SYSTEM_START', {
    reason: 'Trading pipeline logger initialized',
    metadata: {
      logFile: LOG_FILE,
      maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
      maxRotatedFiles: MAX_ROTATED_FILES,
      dbFlushInterval: '5s',
    },
  });
}

/**
 * Gracefully shutdown the pipeline logger. Flushes remaining DB writes.
 */
export async function shutdownPipelineLogger(): Promise<void> {
  if (dbFlushTimer) {
    clearInterval(dbFlushTimer);
    dbFlushTimer = null;
  }
  await flushToDb();
  logPipelineEvent('SYSTEM_STOP', { reason: 'Trading pipeline logger shutdown' });
}

/**
 * Get recent pipeline events from the log file (for dashboard display).
 * Returns the last N events, newest first.
 */
export function getRecentPipelineEvents(count: number = 100): PipelineLogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events: PipelineLogEntry[] = [];
    
    // Read from end for newest first
    for (let i = lines.length - 1; i >= 0 && events.length < count; i--) {
      try {
        events.push(JSON.parse(lines[i]));
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Get pipeline events filtered by type and/or symbol.
 */
export function getFilteredPipelineEvents(
  filters: {
    eventTypes?: PipelineEventType[];
    symbol?: string;
    userId?: number;
    since?: Date;
    limit?: number;
  } = {}
): PipelineLogEntry[] {
  const { eventTypes, symbol, userId, since, limit = 200 } = filters;
  
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events: PipelineLogEntry[] = [];
    
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        const entry: PipelineLogEntry = JSON.parse(lines[i]);
        
        if (eventTypes && !eventTypes.includes(entry.eventType)) continue;
        if (symbol && entry.symbol !== symbol) continue;
        if (userId !== undefined && entry.userId !== userId) continue;
        if (since && new Date(entry.timestamp) < since) break; // Entries are chronological
        
        events.push(entry);
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}
