/**
 * Database Cleanup Service
 * 
 * Automated cleanup of high-volume tables to prevent database bloat.
 * Runs on a configurable schedule to maintain optimal database performance.
 * 
 * CRITICAL FIX (2026-02-01): 
 * - Fixed ticks cleanup to use 'timestampMs' (bigint) instead of 'timestamp'
 * - Fixed agentSignals cleanup to use 'timestamp' instead of 'createdAt'
 * - Added comprehensive logging for debugging
 * - Added disk usage monitoring
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

interface CleanupConfig {
  ticksRetentionHours: number;
  agentSignalsRetentionDays: number;
  cleanupIntervalHours: number;
  enableDiskMonitoring: boolean;
  diskAlertThresholdPercent: number;
}

interface CleanupStats {
  tableName: string;
  deletedRows: number;
  durationMs: number;
  timestamp: Date;
  error?: string;
  rowsBeforeCleanup?: number;
  rowsAfterCleanup?: number;
}

interface DiskUsageStats {
  totalSizeMB: number;
  usedSizeMB: number;
  usagePercent: number;
  tableSizes: { tableName: string; sizeMB: number; rowCount: number }[];
  timestamp: Date;
}

interface CleanupHistory {
  stats: CleanupStats[];
  diskUsage?: DiskUsageStats;
  timestamp: Date;
}

class DatabaseCleanupService {
  private static instance: DatabaseCleanupService;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastCleanupStats: CleanupStats[] = [];
  private cleanupHistory: CleanupHistory[] = [];
  private lastDiskUsage: DiskUsageStats | null = null;
  
  private config: CleanupConfig = {
    ticksRetentionHours: 24,           // Keep ticks for 24 hours
    agentSignalsRetentionDays: 7,      // Keep signals for 7 days
    cleanupIntervalHours: 1,           // Run cleanup every 1 hour (more frequent)
    enableDiskMonitoring: true,        // Enable disk usage monitoring
    diskAlertThresholdPercent: 80,     // Alert at 80% disk usage
  };

  private constructor() {}

  public static getInstance(): DatabaseCleanupService {
    if (!DatabaseCleanupService.instance) {
      DatabaseCleanupService.instance = new DatabaseCleanupService();
    }
    return DatabaseCleanupService.instance;
  }

  /**
   * Start the automated cleanup scheduler
   */
  public start(): void {
    if (this.cleanupInterval) {
      console.log('[DatabaseCleanup] Already running');
      return;
    }

    console.log('[DatabaseCleanup] ========================================');
    console.log('[DatabaseCleanup] Starting automated cleanup service');
    console.log('[DatabaseCleanup] Config:');
    console.log(`[DatabaseCleanup]   - Ticks retention: ${this.config.ticksRetentionHours} hours`);
    console.log(`[DatabaseCleanup]   - Signals retention: ${this.config.agentSignalsRetentionDays} days`);
    console.log(`[DatabaseCleanup]   - Cleanup interval: ${this.config.cleanupIntervalHours} hours`);
    console.log(`[DatabaseCleanup]   - Disk monitoring: ${this.config.enableDiskMonitoring ? 'enabled' : 'disabled'}`);
    console.log(`[DatabaseCleanup]   - Disk alert threshold: ${this.config.diskAlertThresholdPercent}%`);
    console.log('[DatabaseCleanup] ========================================');

    // Run initial cleanup after 1 minute (let system stabilize first)
    setTimeout(() => {
      console.log('[DatabaseCleanup] Running initial cleanup...');
      this.runCleanup().catch(err => {
        console.error('[DatabaseCleanup] Initial cleanup failed:', err);
      });
    }, 1 * 60 * 1000);

    // Schedule regular cleanups
    this.cleanupInterval = setInterval(() => {
      console.log('[DatabaseCleanup] Running scheduled cleanup...');
      this.runCleanup().catch(err => {
        console.error('[DatabaseCleanup] Scheduled cleanup failed:', err);
      });
    }, this.config.cleanupIntervalHours * 60 * 60 * 1000);

    console.log('[DatabaseCleanup] Scheduler started successfully');
  }

  /**
   * Stop the automated cleanup scheduler
   */
  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[DatabaseCleanup] Scheduler stopped');
    }
  }

  /**
   * Run all cleanup tasks
   */
  public async runCleanup(): Promise<CleanupStats[]> {
    if (this.isRunning) {
      console.log('[DatabaseCleanup] Cleanup already in progress, skipping');
      return this.lastCleanupStats;
    }

    this.isRunning = true;
    const stats: CleanupStats[] = [];
    const startTime = Date.now();
    
    console.log('[DatabaseCleanup] ========================================');
    console.log('[DatabaseCleanup] Starting cleanup run at', new Date().toISOString());
    console.log('[DatabaseCleanup] ========================================');

    try {
      // 0. Check disk usage first
      if (this.config.enableDiskMonitoring) {
        const diskUsage = await this.checkDiskUsage();
        this.lastDiskUsage = diskUsage;
        
        if (diskUsage.usagePercent >= this.config.diskAlertThresholdPercent) {
          console.error('[DatabaseCleanup] ⚠️ DISK USAGE ALERT ⚠️');
          console.error(`[DatabaseCleanup] Current usage: ${diskUsage.usagePercent.toFixed(1)}% (${diskUsage.usedSizeMB.toFixed(2)} MB / ${diskUsage.totalSizeMB.toFixed(2)} MB)`);
          console.error('[DatabaseCleanup] Threshold: ' + this.config.diskAlertThresholdPercent + '%');
        }
      }

      // 1. Clean up ticks table (FIXED: use timestampMs)
      const ticksStats = await this.cleanupTicks();
      stats.push(ticksStats);

      // 2. Clean up old agent signals (FIXED: use timestamp column)
      const signalsStats = await this.cleanupAgentSignals();
      stats.push(signalsStats);

      // 3. Clean up old service health history
      const healthStats = await this.cleanupServiceHealthHistory();
      stats.push(healthStats);

      // 4. Clean up old consensus history
      const consensusStats = await this.cleanupConsensusHistory();
      stats.push(consensusStats);

      // 5. Clean up old execution latency logs
      const latencyStats = await this.cleanupLatencyLogs();
      stats.push(latencyStats);

      // 6. Clean up old trade decision logs
      const decisionStats = await this.cleanupTradeDecisionLogs();
      stats.push(decisionStats);

      this.lastCleanupStats = stats;

      // Store in history (keep last 24 entries)
      this.cleanupHistory.push({
        stats: [...stats],
        diskUsage: this.lastDiskUsage || undefined,
        timestamp: new Date(),
      });
      if (this.cleanupHistory.length > 24) {
        this.cleanupHistory.shift();
      }

      // Log summary
      const totalDeleted = stats.reduce((sum, s) => sum + s.deletedRows, 0);
      const totalDuration = Date.now() - startTime;
      const successCount = stats.filter(s => !s.error).length;
      const failCount = stats.filter(s => s.error).length;

      console.log('[DatabaseCleanup] ========================================');
      console.log('[DatabaseCleanup] Cleanup Summary:');
      console.log(`[DatabaseCleanup]   - Total rows deleted: ${totalDeleted.toLocaleString()}`);
      console.log(`[DatabaseCleanup]   - Total duration: ${totalDuration}ms`);
      console.log(`[DatabaseCleanup]   - Successful tasks: ${successCount}/${stats.length}`);
      if (failCount > 0) {
        console.log(`[DatabaseCleanup]   - Failed tasks: ${failCount}`);
        stats.filter(s => s.error).forEach(s => {
          console.log(`[DatabaseCleanup]     - ${s.tableName}: ${s.error}`);
        });
      }
      console.log('[DatabaseCleanup] ========================================');

      return stats;
    } catch (error) {
      console.error('[DatabaseCleanup] Cleanup failed with error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check database disk usage
   */
  private async checkDiskUsage(): Promise<DiskUsageStats> {
    const db = await getDb();
    
    if (!db) {
      return {
        totalSizeMB: 0,
        usedSizeMB: 0,
        usagePercent: 0,
        tableSizes: [],
        timestamp: new Date(),
      };
    }

    try {
      // Get table sizes
      const [tableSizes] = await db.execute(sql`
        SELECT 
          TABLE_NAME as tableName,
          ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as sizeMB,
          TABLE_ROWS as rowCount
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
      `) as any;

      const totalSizeMB = tableSizes.reduce((sum: number, t: any) => sum + parseFloat(t.sizeMB || 0), 0);
      
      // Estimate total available space (assume 100GB limit for cloud DB)
      const estimatedTotalMB = 100 * 1024; // 100GB
      const usagePercent = (totalSizeMB / estimatedTotalMB) * 100;

      const result: DiskUsageStats = {
        totalSizeMB: estimatedTotalMB,
        usedSizeMB: totalSizeMB,
        usagePercent,
        tableSizes: tableSizes.map((t: any) => ({
          tableName: t.tableName,
          sizeMB: parseFloat(t.sizeMB || 0),
          rowCount: parseInt(t.rowCount || 0),
        })),
        timestamp: new Date(),
      };

      console.log('[DatabaseCleanup] Disk Usage Report:');
      console.log(`[DatabaseCleanup]   - Total used: ${totalSizeMB.toFixed(2)} MB`);
      console.log('[DatabaseCleanup]   - Top 5 tables by size:');
      result.tableSizes.slice(0, 5).forEach(t => {
        console.log(`[DatabaseCleanup]     - ${t.tableName}: ${t.sizeMB.toFixed(2)} MB (${t.rowCount.toLocaleString()} rows)`);
      });

      return result;
    } catch (error) {
      console.error('[DatabaseCleanup] Failed to check disk usage:', error);
      return {
        totalSizeMB: 0,
        usedSizeMB: 0,
        usagePercent: 0,
        tableSizes: [],
        timestamp: new Date(),
      };
    }
  }

  /**
   * Clean up old ticks (older than retention period)
   * CRITICAL FIX: Uses 'timestampMs' (bigint milliseconds) instead of 'timestamp'
   */
  private async cleanupTicks(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      console.log('[DatabaseCleanup] Ticks: Database not available');
      return { tableName: 'ticks', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      // Calculate cutoff time in milliseconds (timestampMs is bigint milliseconds)
      const cutoffTimeMs = Date.now() - (this.config.ticksRetentionHours * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] Ticks: Deleting rows older than ${this.config.ticksRetentionHours}h`);
      console.log(`[DatabaseCleanup] Ticks: Cutoff timestampMs = ${cutoffTimeMs} (${new Date(cutoffTimeMs).toISOString()})`);
      
      // Count rows before cleanup
      const [countBefore] = await db.execute(sql`SELECT COUNT(*) as count FROM ticks`) as any;
      const rowsBefore = parseInt(countBefore[0]?.count || 0);
      console.log(`[DatabaseCleanup] Ticks: Current row count = ${rowsBefore.toLocaleString()}`);
      
      // Count rows to delete
      const [countToDelete] = await db.execute(sql`
        SELECT COUNT(*) as count FROM ticks WHERE timestampMs < ${cutoffTimeMs}
      `) as any;
      const rowsToDelete = parseInt(countToDelete[0]?.count || 0);
      console.log(`[DatabaseCleanup] Ticks: Rows to delete = ${rowsToDelete.toLocaleString()}`);
      
      if (rowsToDelete === 0) {
        console.log('[DatabaseCleanup] Ticks: No rows to delete');
        return { 
          tableName: 'ticks', 
          deletedRows: 0, 
          durationMs: Date.now() - startTime, 
          timestamp: new Date(),
          rowsBeforeCleanup: rowsBefore,
          rowsAfterCleanup: rowsBefore,
        };
      }
      
      // Delete in batches to avoid locking
      let totalDeleted = 0;
      const batchSize = 50000; // Reduced batch size for stability
      let batchCount = 0;
      
      while (true) {
        batchCount++;
        const batchStart = Date.now();
        
        const result = await db.execute(sql`
          DELETE FROM ticks 
          WHERE timestampMs < ${cutoffTimeMs}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        const batchDuration = Date.now() - batchStart;
        console.log(`[DatabaseCleanup] Ticks: Batch ${batchCount} deleted ${deleted.toLocaleString()} rows in ${batchDuration}ms`);
        
        if (deleted < batchSize) {
          break; // No more rows to delete
        }
        
        // Small delay between batches to reduce load
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Count rows after cleanup
      const [countAfter] = await db.execute(sql`SELECT COUNT(*) as count FROM ticks`) as any;
      const rowsAfter = parseInt(countAfter[0]?.count || 0);

      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] Ticks: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      console.log(`[DatabaseCleanup] Ticks: Row count: ${rowsBefore.toLocaleString()} → ${rowsAfter.toLocaleString()}`);
      
      return { 
        tableName: 'ticks', 
        deletedRows: totalDeleted, 
        durationMs, 
        timestamp: new Date(),
        rowsBeforeCleanup: rowsBefore,
        rowsAfterCleanup: rowsAfter,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] Ticks: ❌ Failed to cleanup:', errorMsg);
      return { 
        tableName: 'ticks', 
        deletedRows: 0, 
        durationMs: Date.now() - startTime, 
        timestamp: new Date(),
        error: errorMsg,
      };
    }
  }

  /**
   * Clean up old agent signals (older than retention period)
   * CRITICAL FIX: Uses 'timestamp' column (not 'createdAt')
   */
  private async cleanupAgentSignals(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      console.log('[DatabaseCleanup] AgentSignals: Database not available');
      return { tableName: 'agentSignals', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      const cutoffTime = new Date(Date.now() - this.config.agentSignalsRetentionDays * 24 * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] AgentSignals: Deleting rows older than ${this.config.agentSignalsRetentionDays} days`);
      console.log(`[DatabaseCleanup] AgentSignals: Cutoff timestamp = ${cutoffTime.toISOString()}`);
      
      // Count rows before cleanup
      const [countBefore] = await db.execute(sql`SELECT COUNT(*) as count FROM agentSignals`) as any;
      const rowsBefore = parseInt(countBefore[0]?.count || 0);
      console.log(`[DatabaseCleanup] AgentSignals: Current row count = ${rowsBefore.toLocaleString()}`);
      
      // Count rows to delete (using 'timestamp' column, not 'createdAt')
      const [countToDelete] = await db.execute(sql`
        SELECT COUNT(*) as count FROM agentSignals WHERE timestamp < ${cutoffTime}
      `) as any;
      const rowsToDelete = parseInt(countToDelete[0]?.count || 0);
      console.log(`[DatabaseCleanup] AgentSignals: Rows to delete = ${rowsToDelete.toLocaleString()}`);
      
      if (rowsToDelete === 0) {
        console.log('[DatabaseCleanup] AgentSignals: No rows to delete');
        return { 
          tableName: 'agentSignals', 
          deletedRows: 0, 
          durationMs: Date.now() - startTime, 
          timestamp: new Date(),
          rowsBeforeCleanup: rowsBefore,
          rowsAfterCleanup: rowsBefore,
        };
      }

      // Delete old signals in batches (using 'timestamp' column)
      // Phase 15D: Increased from 50K to 200K per batch — audit showed 4.93GB table growing
      // 46M rows/day net. 50K batches were not keeping up with growth rate.
      let totalDeleted = 0;
      const batchSize = 200000;
      let batchCount = 0;
      
      while (true) {
        batchCount++;
        const batchStart = Date.now();
        
        const result = await db.execute(sql`
          DELETE FROM agentSignals 
          WHERE timestamp < ${cutoffTime}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        const batchDuration = Date.now() - batchStart;
        console.log(`[DatabaseCleanup] AgentSignals: Batch ${batchCount} deleted ${deleted.toLocaleString()} rows in ${batchDuration}ms`);
        
        if (deleted < batchSize) {
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Count rows after cleanup
      const [countAfter] = await db.execute(sql`SELECT COUNT(*) as count FROM agentSignals`) as any;
      const rowsAfter = parseInt(countAfter[0]?.count || 0);

      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] AgentSignals: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      console.log(`[DatabaseCleanup] AgentSignals: Row count: ${rowsBefore.toLocaleString()} → ${rowsAfter.toLocaleString()}`);
      
      return { 
        tableName: 'agentSignals', 
        deletedRows: totalDeleted, 
        durationMs, 
        timestamp: new Date(),
        rowsBeforeCleanup: rowsBefore,
        rowsAfterCleanup: rowsAfter,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] AgentSignals: ❌ Failed to cleanup:', errorMsg);
      return { 
        tableName: 'agentSignals', 
        deletedRows: 0, 
        durationMs: Date.now() - startTime, 
        timestamp: new Date(),
        error: errorMsg,
      };
    }
  }

  /**
   * Clean up old service health history (keep 7 days)
   */
  private async cleanupServiceHealthHistory(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      return { tableName: 'serviceHealthHistory', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] ServiceHealthHistory: Deleting rows older than 7 days`);
      
      let totalDeleted = 0;
      const batchSize = 50000;
      
      while (true) {
        const result = await db.execute(sql`
          DELETE FROM serviceHealthHistory 
          WHERE checkedAt < ${cutoffTime}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        if (deleted < batchSize) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] ServiceHealthHistory: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      
      return { tableName: 'serviceHealthHistory', deletedRows: totalDeleted, durationMs, timestamp: new Date() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] ServiceHealthHistory: ❌ Failed:', errorMsg);
      return { tableName: 'serviceHealthHistory', deletedRows: 0, durationMs: Date.now() - startTime, timestamp: new Date(), error: errorMsg };
    }
  }

  /**
   * Clean up old consensus history (keep 14 days)
   */
  private async cleanupConsensusHistory(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      return { tableName: 'consensusHistory', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      const { consensusHistory } = await import('../../drizzle/schema');
      const { lt } = await import('drizzle-orm');
      const cutoffTime = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] ConsensusHistory: Deleting rows older than 14 days`);
      
      // Drizzle delete doesn't support LIMIT, so use batch via raw SQL for large deletes
      let totalDeleted = 0;
      const batchSize = 50000;
      
      while (true) {
        const result = await db.execute(sql`
          DELETE FROM ${consensusHistory}
          WHERE ${consensusHistory.createdAt} < ${cutoffTime}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        if (deleted < batchSize) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] ConsensusHistory: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      
      return { tableName: 'consensusHistory', deletedRows: totalDeleted, durationMs, timestamp: new Date() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] ConsensusHistory: ❌ Failed:', errorMsg);
      return { tableName: 'consensusHistory', deletedRows: 0, durationMs: Date.now() - startTime, timestamp: new Date(), error: errorMsg };
    }
  }

  /**
   * Clean up old execution latency logs (keep 30 days)
   */
  private async cleanupLatencyLogs(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      return { tableName: 'executionLatencyLogs', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      const cutoffTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] ExecutionLatencyLogs: Deleting rows older than 30 days`);
      
      let totalDeleted = 0;
      const batchSize = 10000;
      
      while (true) {
        const result = await db.execute(sql`
          DELETE FROM executionLatencyLogs 
          WHERE createdAt < ${cutoffTime}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        if (deleted < batchSize) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] ExecutionLatencyLogs: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      
      return { tableName: 'executionLatencyLogs', deletedRows: totalDeleted, durationMs, timestamp: new Date() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] ExecutionLatencyLogs: ❌ Failed:', errorMsg);
      return { tableName: 'executionLatencyLogs', deletedRows: 0, durationMs: Date.now() - startTime, timestamp: new Date(), error: errorMsg };
    }
  }

  /**
   * Clean up old trade decision logs (keep 90 days)
   */
  private async cleanupTradeDecisionLogs(): Promise<CleanupStats> {
    const startTime = Date.now();
    const db = await getDb();
    
    if (!db) {
      return { tableName: 'tradeDecisionLogs', deletedRows: 0, durationMs: 0, timestamp: new Date(), error: 'Database not available' };
    }

    try {
      const cutoffTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      
      console.log(`[DatabaseCleanup] TradeDecisionLogs: Deleting rows older than 90 days`);
      
      let totalDeleted = 0;
      const batchSize = 10000;
      
      while (true) {
        const result = await db.execute(sql`
          DELETE FROM tradeDecisionLogs 
          WHERE createdAt < ${cutoffTime}
          LIMIT ${batchSize}
        `);
        
        const deleted = (result as any)[0]?.affectedRows || 0;
        totalDeleted += deleted;
        
        if (deleted < batchSize) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const durationMs = Date.now() - startTime;
      console.log(`[DatabaseCleanup] TradeDecisionLogs: ✅ Deleted ${totalDeleted.toLocaleString()} rows in ${durationMs}ms`);
      
      return { tableName: 'tradeDecisionLogs', deletedRows: totalDeleted, durationMs, timestamp: new Date() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DatabaseCleanup] TradeDecisionLogs: ❌ Failed:', errorMsg);
      return { tableName: 'tradeDecisionLogs', deletedRows: 0, durationMs: Date.now() - startTime, timestamp: new Date(), error: errorMsg };
    }
  }

  /**
   * Get the last cleanup statistics
   */
  public getLastCleanupStats(): CleanupStats[] {
    return this.lastCleanupStats;
  }

  /**
   * Get cleanup history
   */
  public getCleanupHistory(): CleanupHistory[] {
    return this.cleanupHistory;
  }

  /**
   * Get last disk usage stats
   */
  public getLastDiskUsage(): DiskUsageStats | null {
    return this.lastDiskUsage;
  }

  /**
   * Get current configuration
   */
  public getConfig(): CleanupConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[DatabaseCleanup] Config updated:', this.config);
  }

  /**
   * Check if cleanup is currently running
   */
  public isCleanupRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Force run cleanup immediately (for manual trigger)
   */
  public async forceCleanup(): Promise<CleanupStats[]> {
    console.log('[DatabaseCleanup] Force cleanup triggered');
    return this.runCleanup();
  }

  /**
   * Get comprehensive status report
   */
  public getStatus(): {
    isRunning: boolean;
    config: CleanupConfig;
    lastCleanup: CleanupStats[];
    lastDiskUsage: DiskUsageStats | null;
    historyCount: number;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      lastCleanup: this.lastCleanupStats,
      lastDiskUsage: this.lastDiskUsage,
      historyCount: this.cleanupHistory.length,
    };
  }
}

export const databaseCleanupService = DatabaseCleanupService.getInstance();
