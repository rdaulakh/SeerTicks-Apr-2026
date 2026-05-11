/**
 * Disk Usage Monitor Service
 * 
 * Monitors database disk usage and table growth rates.
 * Provides alerts when usage exceeds thresholds.
 * Tracks daily growth rate for capacity planning.
 * 
 * Created: 2026-02-01
 */

import { getDb } from '../db';
import { getActiveClock } from '../_core/clock';
import { sql } from 'drizzle-orm';
import { EventEmitter } from 'events';

interface TableSizeInfo {
  tableName: string;
  sizeMB: number;
  rowCount: number;
  avgRowSizeBytes: number;
}

interface DiskUsageSnapshot {
  timestamp: Date;
  totalSizeMB: number;
  tableSizes: TableSizeInfo[];
}

interface GrowthMetrics {
  tableName: string;
  currentSizeMB: number;
  sizeMB24hAgo: number;
  growthMB24h: number;
  growthPercent24h: number;
  projectedSizeMB7d: number;
  projectedSizeMB30d: number;
}

interface DiskAlert {
  type: 'warning' | 'critical' | 'info';
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

interface MonitorConfig {
  checkIntervalMinutes: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  estimatedMaxSizeMB: number;
  enableAlerts: boolean;
  retentionHours: number;
}

class DiskUsageMonitor extends EventEmitter {
  private static instance: DiskUsageMonitor;
  private checkInterval: NodeJS.Timeout | null = null;
  private snapshots: DiskUsageSnapshot[] = [];
  private alerts: DiskAlert[] = [];
  private isRunning = false;
  
  private config: MonitorConfig = {
    checkIntervalMinutes: 30,           // Check every 30 minutes
    warningThresholdPercent: 70,        // Warning at 70%
    criticalThresholdPercent: 85,       // Critical at 85%
    estimatedMaxSizeMB: 100 * 1024,     // 100GB estimated limit
    enableAlerts: true,
    retentionHours: 48,                 // Keep 48 hours of snapshots
  };

  private constructor() {
    super();
  }

  public static getInstance(): DiskUsageMonitor {
    if (!DiskUsageMonitor.instance) {
      DiskUsageMonitor.instance = new DiskUsageMonitor();
    }
    return DiskUsageMonitor.instance;
  }

  /**
   * Start the disk usage monitor
   */
  public start(): void {
    if (this.checkInterval) {
      console.log('[DiskUsageMonitor] Already running');
      return;
    }

    console.log('[DiskUsageMonitor] ========================================');
    console.log('[DiskUsageMonitor] Starting disk usage monitor');
    console.log('[DiskUsageMonitor] Config:');
    console.log(`[DiskUsageMonitor]   - Check interval: ${this.config.checkIntervalMinutes} minutes`);
    console.log(`[DiskUsageMonitor]   - Warning threshold: ${this.config.warningThresholdPercent}%`);
    console.log(`[DiskUsageMonitor]   - Critical threshold: ${this.config.criticalThresholdPercent}%`);
    console.log(`[DiskUsageMonitor]   - Estimated max size: ${(this.config.estimatedMaxSizeMB / 1024).toFixed(0)} GB`);
    console.log('[DiskUsageMonitor] ========================================');

    this.isRunning = true;

    // Run initial check after 30 seconds
    setTimeout(() => {
      this.checkDiskUsage().catch(err => {
        console.error('[DiskUsageMonitor] Initial check failed:', err);
      });
    }, 30 * 1000);

    // Schedule regular checks
    this.checkInterval = setInterval(() => {
      this.checkDiskUsage().catch(err => {
        console.error('[DiskUsageMonitor] Scheduled check failed:', err);
      });
    }, this.config.checkIntervalMinutes * 60 * 1000);

    console.log('[DiskUsageMonitor] Monitor started');
  }

  /**
   * Stop the disk usage monitor
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.isRunning = false;
      console.log('[DiskUsageMonitor] Monitor stopped');
    }
  }

  /**
   * Check current disk usage
   */
  public async checkDiskUsage(): Promise<DiskUsageSnapshot> {
    const db = await getDb();
    
    if (!db) {
      console.warn('[DiskUsageMonitor] Database not available');
      return {
        timestamp: new Date(),
        totalSizeMB: 0,
        tableSizes: [],
      };
    }

    try {
      // Get table sizes from information_schema
      const [tableSizes] = await db.execute(sql`
        SELECT 
          TABLE_NAME as tableName,
          ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 4) as sizeMB,
          TABLE_ROWS as rowCount,
          CASE WHEN TABLE_ROWS > 0 
            THEN ROUND((DATA_LENGTH + INDEX_LENGTH) / TABLE_ROWS, 2) 
            ELSE 0 
          END as avgRowSizeBytes
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
      `) as any;

      const tableInfos: TableSizeInfo[] = tableSizes.map((t: any) => ({
        tableName: t.tableName,
        sizeMB: parseFloat(t.sizeMB || 0),
        rowCount: parseInt(t.rowCount || 0),
        avgRowSizeBytes: parseFloat(t.avgRowSizeBytes || 0),
      }));

      const totalSizeMB = tableInfos.reduce((sum, t) => sum + t.sizeMB, 0);

      const snapshot: DiskUsageSnapshot = {
        timestamp: new Date(),
        totalSizeMB,
        tableSizes: tableInfos,
      };

      // Store snapshot
      this.snapshots.push(snapshot);
      
      // Clean up old snapshots
      const cutoffTime = getActiveClock().now() - (this.config.retentionHours * 60 * 60 * 1000);
      this.snapshots = this.snapshots.filter(s => s.timestamp.getTime() > cutoffTime);

      // Calculate usage percentage
      const usagePercent = (totalSizeMB / this.config.estimatedMaxSizeMB) * 100;

      // Log current status
      console.log('[DiskUsageMonitor] ----------------------------------------');
      console.log(`[DiskUsageMonitor] Disk Usage Check at ${new Date().toISOString()}`);
      console.log(`[DiskUsageMonitor] Total size: ${totalSizeMB.toFixed(2)} MB (${usagePercent.toFixed(1)}%)`);
      console.log('[DiskUsageMonitor] Top 5 tables by size:');
      tableInfos.slice(0, 5).forEach((t, i) => {
        console.log(`[DiskUsageMonitor]   ${i + 1}. ${t.tableName}: ${t.sizeMB.toFixed(2)} MB (${t.rowCount.toLocaleString()} rows)`);
      });

      // Check thresholds and generate alerts
      if (this.config.enableAlerts) {
        this.checkThresholds(totalSizeMB, usagePercent, tableInfos);
      }

      // Calculate and log growth metrics
      const growthMetrics = this.calculateGrowthMetrics();
      if (growthMetrics.length > 0) {
        console.log('[DiskUsageMonitor] Growth metrics (24h):');
        growthMetrics.slice(0, 5).forEach(g => {
          if (g.growthMB24h > 0) {
            console.log(`[DiskUsageMonitor]   - ${g.tableName}: +${g.growthMB24h.toFixed(2)} MB (${g.growthPercent24h.toFixed(1)}%)`);
          }
        });
      }

      console.log('[DiskUsageMonitor] ----------------------------------------');

      // Emit event
      this.emit('usage_checked', snapshot);

      return snapshot;
    } catch (error) {
      console.error('[DiskUsageMonitor] Failed to check disk usage:', error);
      throw error;
    }
  }

  /**
   * Check thresholds and generate alerts
   */
  private checkThresholds(totalSizeMB: number, usagePercent: number, tableSizes: TableSizeInfo[]): void {
    // Check overall usage
    if (usagePercent >= this.config.criticalThresholdPercent) {
      this.addAlert({
        type: 'critical',
        message: `CRITICAL: Database usage at ${usagePercent.toFixed(1)}% - immediate action required!`,
        metric: 'disk_usage_percent',
        value: usagePercent,
        threshold: this.config.criticalThresholdPercent,
        timestamp: new Date(),
      });
    } else if (usagePercent >= this.config.warningThresholdPercent) {
      this.addAlert({
        type: 'warning',
        message: `WARNING: Database usage at ${usagePercent.toFixed(1)}% - approaching limit`,
        metric: 'disk_usage_percent',
        value: usagePercent,
        threshold: this.config.warningThresholdPercent,
        timestamp: new Date(),
      });
    }

    // Check individual table growth
    const growthMetrics = this.calculateGrowthMetrics();
    for (const metric of growthMetrics) {
      // Alert if table is growing more than 100MB/day
      if (metric.growthMB24h > 100) {
        this.addAlert({
          type: 'warning',
          message: `Table ${metric.tableName} growing rapidly: +${metric.growthMB24h.toFixed(0)} MB in 24h`,
          metric: `table_growth_${metric.tableName}`,
          value: metric.growthMB24h,
          threshold: 100,
          timestamp: new Date(),
        });
      }

      // Alert if projected 30-day size exceeds 50GB
      if (metric.projectedSizeMB30d > 50 * 1024) {
        this.addAlert({
          type: 'warning',
          message: `Table ${metric.tableName} projected to reach ${(metric.projectedSizeMB30d / 1024).toFixed(0)} GB in 30 days`,
          metric: `table_projection_${metric.tableName}`,
          value: metric.projectedSizeMB30d,
          threshold: 50 * 1024,
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * Add an alert
   */
  private addAlert(alert: DiskAlert): void {
    // Avoid duplicate alerts within 1 hour
    const recentAlert = this.alerts.find(a => 
      a.metric === alert.metric && 
      a.type === alert.type &&
      (getActiveClock().now() - a.timestamp.getTime()) < 60 * 60 * 1000
    );

    if (!recentAlert) {
      this.alerts.push(alert);
      
      // Keep only last 100 alerts
      if (this.alerts.length > 100) {
        this.alerts.shift();
      }

      // Log alert
      const prefix = alert.type === 'critical' ? '🚨' : alert.type === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`[DiskUsageMonitor] ${prefix} ALERT: ${alert.message}`);

      // Emit alert event
      this.emit('alert', alert);
    }
  }

  /**
   * Calculate growth metrics based on historical snapshots
   */
  public calculateGrowthMetrics(): GrowthMetrics[] {
    if (this.snapshots.length < 2) {
      return [];
    }

    const currentSnapshot = this.snapshots[this.snapshots.length - 1];
    
    // Find snapshot from ~24 hours ago
    const targetTime = getActiveClock().now() - (24 * 60 * 60 * 1000);
    const oldSnapshot = this.snapshots.reduce((closest, s) => {
      const closestDiff = Math.abs(closest.timestamp.getTime() - targetTime);
      const currentDiff = Math.abs(s.timestamp.getTime() - targetTime);
      return currentDiff < closestDiff ? s : closest;
    }, this.snapshots[0]);

    // Calculate hours between snapshots
    const hoursDiff = (currentSnapshot.timestamp.getTime() - oldSnapshot.timestamp.getTime()) / (1000 * 60 * 60);
    if (hoursDiff < 1) {
      return []; // Not enough time difference
    }

    const metrics: GrowthMetrics[] = [];

    for (const currentTable of currentSnapshot.tableSizes) {
      const oldTable = oldSnapshot.tableSizes.find(t => t.tableName === currentTable.tableName);
      const oldSizeMB = oldTable?.sizeMB || 0;
      
      const growthMB = currentTable.sizeMB - oldSizeMB;
      const growthPercent = oldSizeMB > 0 ? (growthMB / oldSizeMB) * 100 : 0;
      
      // Normalize to 24h growth
      const growthMB24h = (growthMB / hoursDiff) * 24;
      const growthPercent24h = (growthPercent / hoursDiff) * 24;
      
      // Project future sizes
      const dailyGrowthMB = growthMB24h;
      const projectedSizeMB7d = currentTable.sizeMB + (dailyGrowthMB * 7);
      const projectedSizeMB30d = currentTable.sizeMB + (dailyGrowthMB * 30);

      metrics.push({
        tableName: currentTable.tableName,
        currentSizeMB: currentTable.sizeMB,
        sizeMB24hAgo: oldSizeMB,
        growthMB24h,
        growthPercent24h,
        projectedSizeMB7d,
        projectedSizeMB30d,
      });
    }

    // Sort by growth rate
    return metrics.sort((a, b) => b.growthMB24h - a.growthMB24h);
  }

  /**
   * Get current status
   */
  public getStatus(): {
    isRunning: boolean;
    config: MonitorConfig;
    currentUsage: DiskUsageSnapshot | null;
    recentAlerts: DiskAlert[];
    snapshotCount: number;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      currentUsage: this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null,
      recentAlerts: this.alerts.slice(-10),
      snapshotCount: this.snapshots.length,
    };
  }

  /**
   * Get all alerts
   */
  public getAlerts(): DiskAlert[] {
    return [...this.alerts];
  }

  /**
   * Get growth metrics
   */
  public getGrowthMetrics(): GrowthMetrics[] {
    return this.calculateGrowthMetrics();
  }

  /**
   * Get all snapshots
   */
  public getSnapshots(): DiskUsageSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[DiskUsageMonitor] Config updated:', this.config);
  }

  /**
   * Force a check immediately
   */
  public async forceCheck(): Promise<DiskUsageSnapshot> {
    console.log('[DiskUsageMonitor] Force check triggered');
    return this.checkDiskUsage();
  }

  /**
   * Get comprehensive report
   */
  public async getReport(): Promise<{
    currentUsage: DiskUsageSnapshot;
    growthMetrics: GrowthMetrics[];
    alerts: DiskAlert[];
    recommendations: string[];
  }> {
    const currentUsage = await this.checkDiskUsage();
    const growthMetrics = this.calculateGrowthMetrics();
    const recommendations: string[] = [];

    // Generate recommendations
    const usagePercent = (currentUsage.totalSizeMB / this.config.estimatedMaxSizeMB) * 100;
    
    if (usagePercent > 80) {
      recommendations.push('URGENT: Disk usage exceeds 80%. Run cleanup immediately and consider archiving old data.');
    } else if (usagePercent > 60) {
      recommendations.push('Disk usage above 60%. Monitor closely and ensure cleanup service is running.');
    }

    // Check for rapidly growing tables
    const fastGrowingTables = growthMetrics.filter(g => g.growthMB24h > 50);
    for (const table of fastGrowingTables) {
      recommendations.push(`Table '${table.tableName}' is growing at ${table.growthMB24h.toFixed(0)} MB/day. Consider reducing retention period.`);
    }

    // Check for tables that will exceed limits
    const problematicTables = growthMetrics.filter(g => g.projectedSizeMB30d > 30 * 1024);
    for (const table of problematicTables) {
      recommendations.push(`Table '${table.tableName}' projected to reach ${(table.projectedSizeMB30d / 1024).toFixed(0)} GB in 30 days. Action required.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Disk usage is healthy. No immediate action required.');
    }

    return {
      currentUsage,
      growthMetrics,
      alerts: this.alerts.slice(-20),
      recommendations,
    };
  }
}

export const diskUsageMonitor = DiskUsageMonitor.getInstance();
