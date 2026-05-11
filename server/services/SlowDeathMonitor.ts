/**
 * Slow Death Monitor Service
 * 
 * Detects gradual system degradation that may not trigger immediate alerts
 * but indicates impending failure ("slow death" scenarios).
 * 
 * Monitors:
 * - Memory trends (heap growth over time)
 * - Latency trends (gradual increase in response times)
 * - Queue depth trends (sustained growth indicating backpressure)
 * 
 * Created: 2026-02-01
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';

// ============================================
// TYPES AND INTERFACES
// ============================================

interface MemorySnapshot {
  timestamp: Date;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rss: number;
}

interface LatencySnapshot {
  timestamp: Date;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  sampleCount: number;
}

interface QueueSnapshot {
  timestamp: Date;
  queueName: string;
  depth: number;
  processedPerSecond: number;
}

interface TrendAnalysis {
  metric: string;
  currentValue: number;
  valueOneHourAgo: number;
  valueSixHoursAgo: number;
  value24HoursAgo: number;
  growthRatePerHour: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  severity: 'normal' | 'warning' | 'critical';
  projectedValue24h: number;
}

interface SlowDeathAlert {
  id: string;
  type: 'memory_leak' | 'latency_degradation' | 'queue_buildup' | 'sustained_growth';
  severity: 'warning' | 'critical';
  metric: string;
  message: string;
  currentValue: number;
  threshold: number;
  growthRate: number;
  detectedAt: Date;
  acknowledgedAt?: Date;
}

interface MonitorConfig {
  checkIntervalMinutes: number;
  memoryGrowthAlertThresholdMBPerHour: number;
  memoryGrowthSustainedHours: number;
  latencyIncreaseAlertPercent: number;
  latencyIncreaseWindowMinutes: number;
  queueDepthGrowthAlertPercent: number;
  queueDepthSustainedMinutes: number;
  retentionHours: number;
}

// ============================================
// SLOW DEATH MONITOR CLASS
// ============================================

class SlowDeathMonitor extends EventEmitter {
  private static instance: SlowDeathMonitor;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  // Data stores (24h rolling windows)
  private memorySnapshots: MemorySnapshot[] = [];
  private latencySnapshots: LatencySnapshot[] = [];
  private queueSnapshots: Map<string, QueueSnapshot[]> = new Map();
  
  // Alert tracking
  private activeAlerts: Map<string, SlowDeathAlert> = new Map();
  private alertHistory: SlowDeathAlert[] = [];
  
  // Latency tracking for external reporting
  private latencyBuffer: number[] = [];
  
  private config: MonitorConfig = {
    checkIntervalMinutes: 5,                    // Check every 5 minutes
    memoryGrowthAlertThresholdMBPerHour: 10,    // Alert if growing >10MB/hour
    memoryGrowthSustainedHours: 2,              // For 2+ hours sustained
    latencyIncreaseAlertPercent: 20,            // Alert if latency increases >20%
    latencyIncreaseWindowMinutes: 60,           // Over 1 hour window
    queueDepthGrowthAlertPercent: 50,           // Alert if queue grows >50%
    queueDepthSustainedMinutes: 30,             // For 30+ minutes sustained
    retentionHours: 24,                         // Keep 24 hours of data
  };

  private constructor() {
    super();
  }

  public static getInstance(): SlowDeathMonitor {
    if (!SlowDeathMonitor.instance) {
      SlowDeathMonitor.instance = new SlowDeathMonitor();
    }
    return SlowDeathMonitor.instance;
  }

  // ============================================
  // LIFECYCLE METHODS
  // ============================================

  public start(): void {
    if (this.checkInterval) {
      console.log('[SlowDeathMonitor] Already running');
      return;
    }

    console.log('[SlowDeathMonitor] ========================================');
    console.log('[SlowDeathMonitor] Starting slow death detection service');
    console.log('[SlowDeathMonitor] Config:');
    console.log(`[SlowDeathMonitor]   - Check interval: ${this.config.checkIntervalMinutes} minutes`);
    console.log(`[SlowDeathMonitor]   - Memory growth alert: >${this.config.memoryGrowthAlertThresholdMBPerHour} MB/hour for ${this.config.memoryGrowthSustainedHours}h`);
    console.log(`[SlowDeathMonitor]   - Latency increase alert: >${this.config.latencyIncreaseAlertPercent}% over ${this.config.latencyIncreaseWindowMinutes}min`);
    console.log(`[SlowDeathMonitor]   - Queue growth alert: >${this.config.queueDepthGrowthAlertPercent}% for ${this.config.queueDepthSustainedMinutes}min`);
    console.log('[SlowDeathMonitor] ========================================');

    this.isRunning = true;

    // Take initial snapshot
    this.takeMemorySnapshot();

    // Schedule regular checks
    this.checkInterval = setInterval(() => {
      this.runAnalysis();
    }, this.config.checkIntervalMinutes * 60 * 1000);

    console.log('[SlowDeathMonitor] Service started');
  }

  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.isRunning = false;
      console.log('[SlowDeathMonitor] Service stopped');
    }
  }

  // ============================================
  // DATA COLLECTION METHODS
  // ============================================

  /**
   * Take a memory snapshot
   */
  private takeMemorySnapshot(): void {
    const memUsage = process.memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp: new Date(),
      heapUsedMB: memUsage.heapUsed / (1024 * 1024),
      heapTotalMB: memUsage.heapTotal / (1024 * 1024),
      externalMB: memUsage.external / (1024 * 1024),
      rss: memUsage.rss / (1024 * 1024),
    };

    this.memorySnapshots.push(snapshot);
    this.pruneOldData();
  }

  /**
   * Record a latency measurement (called externally)
   */
  public recordLatency(latencyMs: number): void {
    this.latencyBuffer.push(latencyMs);
    
    // Aggregate every 100 samples or every minute
    if (this.latencyBuffer.length >= 100) {
      this.aggregateLatencyBuffer();
    }
  }

  /**
   * Aggregate latency buffer into a snapshot
   */
  private aggregateLatencyBuffer(): void {
    if (this.latencyBuffer.length === 0) return;

    const sorted = [...this.latencyBuffer].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    const snapshot: LatencySnapshot = {
      timestamp: new Date(),
      avgLatencyMs: avg,
      p95LatencyMs: sorted[p95Index] || avg,
      p99LatencyMs: sorted[p99Index] || avg,
      sampleCount: sorted.length,
    };

    this.latencySnapshots.push(snapshot);
    this.latencyBuffer = [];
    this.pruneOldData();
  }

  /**
   * Record queue depth (called externally)
   */
  public recordQueueDepth(queueName: string, depth: number, processedPerSecond: number = 0): void {
    const snapshot: QueueSnapshot = {
      timestamp: new Date(),
      queueName,
      depth,
      processedPerSecond,
    };

    if (!this.queueSnapshots.has(queueName)) {
      this.queueSnapshots.set(queueName, []);
    }
    this.queueSnapshots.get(queueName)!.push(snapshot);
    this.pruneOldData();
  }

  /**
   * Remove data older than retention period
   */
  private pruneOldData(): void {
    const cutoff = getActiveClock().now() - (this.config.retentionHours * 60 * 60 * 1000);

    this.memorySnapshots = this.memorySnapshots.filter(s => s.timestamp.getTime() > cutoff);
    this.latencySnapshots = this.latencySnapshots.filter(s => s.timestamp.getTime() > cutoff);
    
    for (const [name, snapshots] of this.queueSnapshots) {
      this.queueSnapshots.set(name, snapshots.filter(s => s.timestamp.getTime() > cutoff));
    }
  }

  // ============================================
  // ANALYSIS METHODS
  // ============================================

  /**
   * Run full analysis
   */
  private runAnalysis(): void {
    console.log('[SlowDeathMonitor] Running trend analysis...');
    
    // Take fresh memory snapshot
    this.takeMemorySnapshot();
    
    // Aggregate any pending latency data
    if (this.latencyBuffer.length > 0) {
      this.aggregateLatencyBuffer();
    }

    // Analyze each metric type
    this.analyzeMemoryTrend();
    this.analyzeLatencyTrend();
    this.analyzeQueueTrends();

    // Log summary
    const activeCount = this.activeAlerts.size;
    if (activeCount > 0) {
      console.log(`[SlowDeathMonitor] ⚠️ ${activeCount} active slow death alerts`);
    } else {
      console.log('[SlowDeathMonitor] ✅ No slow death patterns detected');
    }
  }

  /**
   * Analyze memory trend for leaks
   */
  private analyzeMemoryTrend(): void {
    if (this.memorySnapshots.length < 2) return;

    const analysis = this.calculateTrend(
      this.memorySnapshots.map(s => ({ timestamp: s.timestamp, value: s.heapUsedMB })),
      'heap_used_mb'
    );

    // Check for sustained memory growth
    if (analysis.trend === 'increasing' && 
        analysis.growthRatePerHour > this.config.memoryGrowthAlertThresholdMBPerHour) {
      
      // Check if growth has been sustained
      const hoursOfData = (getActiveClock().now() - this.memorySnapshots[0].timestamp.getTime()) / (1000 * 60 * 60);
      
      if (hoursOfData >= this.config.memoryGrowthSustainedHours) {
        this.raiseAlert({
          type: 'memory_leak',
          metric: 'heap_used_mb',
          message: `Sustained memory growth detected: ${analysis.growthRatePerHour.toFixed(1)} MB/hour for ${hoursOfData.toFixed(1)} hours. Current: ${analysis.currentValue.toFixed(0)} MB, Projected 24h: ${analysis.projectedValue24h.toFixed(0)} MB`,
          currentValue: analysis.currentValue,
          threshold: this.config.memoryGrowthAlertThresholdMBPerHour,
          growthRate: analysis.growthRatePerHour,
          severity: analysis.growthRatePerHour > this.config.memoryGrowthAlertThresholdMBPerHour * 2 ? 'critical' : 'warning',
        });
      }
    } else {
      // Clear memory leak alert if growth has stopped
      this.clearAlert('memory_leak_heap_used_mb');
    }

    // Log memory status
    const current = this.memorySnapshots[this.memorySnapshots.length - 1];
    console.log(`[SlowDeathMonitor] Memory: ${current.heapUsedMB.toFixed(0)}/${current.heapTotalMB.toFixed(0)} MB heap, ${current.rss.toFixed(0)} MB RSS, trend: ${analysis.trend} (${analysis.growthRatePerHour.toFixed(1)} MB/h)`);
  }

  /**
   * Analyze latency trend for degradation
   */
  private analyzeLatencyTrend(): void {
    if (this.latencySnapshots.length < 2) return;

    const analysis = this.calculateTrend(
      this.latencySnapshots.map(s => ({ timestamp: s.timestamp, value: s.avgLatencyMs })),
      'avg_latency_ms'
    );

    // Check for latency increase over the window
    const windowMs = this.config.latencyIncreaseWindowMinutes * 60 * 1000;
    const windowStart = getActiveClock().now() - windowMs;
    const recentSnapshots = this.latencySnapshots.filter(s => s.timestamp.getTime() > windowStart);
    
    if (recentSnapshots.length >= 2) {
      const oldestInWindow = recentSnapshots[0].avgLatencyMs;
      const newest = recentSnapshots[recentSnapshots.length - 1].avgLatencyMs;
      const increasePercent = ((newest - oldestInWindow) / oldestInWindow) * 100;

      if (increasePercent > this.config.latencyIncreaseAlertPercent) {
        this.raiseAlert({
          type: 'latency_degradation',
          metric: 'avg_latency_ms',
          message: `Latency degradation detected: ${increasePercent.toFixed(0)}% increase over ${this.config.latencyIncreaseWindowMinutes} minutes. Current: ${newest.toFixed(1)}ms, Was: ${oldestInWindow.toFixed(1)}ms`,
          currentValue: newest,
          threshold: this.config.latencyIncreaseAlertPercent,
          growthRate: increasePercent,
          severity: increasePercent > this.config.latencyIncreaseAlertPercent * 2 ? 'critical' : 'warning',
        });
      } else {
        this.clearAlert('latency_degradation_avg_latency_ms');
      }
    }
  }

  /**
   * Analyze queue trends for buildup
   */
  private analyzeQueueTrends(): void {
    for (const [queueName, snapshots] of this.queueSnapshots) {
      if (snapshots.length < 2) continue;

      const analysis = this.calculateTrend(
        snapshots.map(s => ({ timestamp: s.timestamp, value: s.depth })),
        `queue_${queueName}`
      );

      // Check for sustained queue growth
      const windowMs = this.config.queueDepthSustainedMinutes * 60 * 1000;
      const windowStart = getActiveClock().now() - windowMs;
      const recentSnapshots = snapshots.filter(s => s.timestamp.getTime() > windowStart);

      if (recentSnapshots.length >= 2) {
        const oldestInWindow = recentSnapshots[0].depth;
        const newest = recentSnapshots[recentSnapshots.length - 1].depth;
        
        if (oldestInWindow > 0) {
          const growthPercent = ((newest - oldestInWindow) / oldestInWindow) * 100;

          if (growthPercent > this.config.queueDepthGrowthAlertPercent && newest > 100) {
            this.raiseAlert({
              type: 'queue_buildup',
              metric: `queue_${queueName}`,
              message: `Queue buildup detected in ${queueName}: ${growthPercent.toFixed(0)}% growth over ${this.config.queueDepthSustainedMinutes} minutes. Current depth: ${newest}, Was: ${oldestInWindow}`,
              currentValue: newest,
              threshold: this.config.queueDepthGrowthAlertPercent,
              growthRate: growthPercent,
              severity: newest > 1000 ? 'critical' : 'warning',
            });
          } else {
            this.clearAlert(`queue_buildup_queue_${queueName}`);
          }
        }
      }
    }
  }

  /**
   * Calculate trend from time series data
   */
  private calculateTrend(
    data: { timestamp: Date; value: number }[],
    metricName: string
  ): TrendAnalysis {
    if (data.length < 2) {
      return {
        metric: metricName,
        currentValue: data[0]?.value || 0,
        valueOneHourAgo: 0,
        valueSixHoursAgo: 0,
        value24HoursAgo: 0,
        growthRatePerHour: 0,
        trend: 'stable',
        severity: 'normal',
        projectedValue24h: data[0]?.value || 0,
      };
    }

    const now = getActiveClock().now();
    const currentValue = data[data.length - 1].value;
    
    // Find values at different time points
    const findValueAt = (hoursAgo: number): number => {
      const targetTime = now - (hoursAgo * 60 * 60 * 1000);
      const closest = data.reduce((prev, curr) => {
        return Math.abs(curr.timestamp.getTime() - targetTime) < Math.abs(prev.timestamp.getTime() - targetTime) ? curr : prev;
      });
      return closest.value;
    };

    const valueOneHourAgo = findValueAt(1);
    const valueSixHoursAgo = findValueAt(6);
    const value24HoursAgo = findValueAt(24);

    // Calculate growth rate using linear regression
    const xValues = data.map(d => (d.timestamp.getTime() - data[0].timestamp.getTime()) / (1000 * 60 * 60)); // hours
    const yValues = data.map(d => d.value);
    
    const n = xValues.length;
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const growthRatePerHour = isNaN(slope) ? 0 : slope;

    // Determine trend
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    const significantChange = Math.abs(growthRatePerHour) > 0.5; // More than 0.5 units per hour
    if (significantChange) {
      trend = growthRatePerHour > 0 ? 'increasing' : 'decreasing';
    }

    // Determine severity
    let severity: 'normal' | 'warning' | 'critical' = 'normal';
    if (trend === 'increasing' && growthRatePerHour > this.config.memoryGrowthAlertThresholdMBPerHour) {
      severity = growthRatePerHour > this.config.memoryGrowthAlertThresholdMBPerHour * 2 ? 'critical' : 'warning';
    }

    // Project 24h value
    const projectedValue24h = currentValue + (growthRatePerHour * 24);

    return {
      metric: metricName,
      currentValue,
      valueOneHourAgo,
      valueSixHoursAgo,
      value24HoursAgo,
      growthRatePerHour,
      trend,
      severity,
      projectedValue24h,
    };
  }

  // ============================================
  // ALERT MANAGEMENT
  // ============================================

  /**
   * Raise or update an alert
   */
  private raiseAlert(params: {
    type: SlowDeathAlert['type'];
    metric: string;
    message: string;
    currentValue: number;
    threshold: number;
    growthRate: number;
    severity: 'warning' | 'critical';
  }): void {
    const alertId = `${params.type}_${params.metric}`;
    
    const existingAlert = this.activeAlerts.get(alertId);
    if (existingAlert) {
      // Update existing alert
      existingAlert.currentValue = params.currentValue;
      existingAlert.growthRate = params.growthRate;
      existingAlert.message = params.message;
      existingAlert.severity = params.severity;
    } else {
      // Create new alert
      const alert: SlowDeathAlert = {
        id: alertId,
        type: params.type,
        severity: params.severity,
        metric: params.metric,
        message: params.message,
        currentValue: params.currentValue,
        threshold: params.threshold,
        growthRate: params.growthRate,
        detectedAt: new Date(),
      };

      this.activeAlerts.set(alertId, alert);
      this.alertHistory.push(alert);

      // Keep only last 100 alerts in history
      if (this.alertHistory.length > 100) {
        this.alertHistory.shift();
      }

      // Log and emit
      const prefix = params.severity === 'critical' ? '🚨' : '⚠️';
      console.log(`[SlowDeathMonitor] ${prefix} ALERT: ${params.message}`);
      this.emit('alert', alert);
    }
  }

  /**
   * Clear an alert
   */
  private clearAlert(alertId: string): void {
    if (this.activeAlerts.has(alertId)) {
      const alert = this.activeAlerts.get(alertId)!;
      console.log(`[SlowDeathMonitor] ✅ Alert cleared: ${alert.type} - ${alert.metric}`);
      this.activeAlerts.delete(alertId);
      this.emit('alert_cleared', alert);
    }
  }

  /**
   * Acknowledge an alert
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledgedAt = new Date();
      return true;
    }
    return false;
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Get current status
   */
  public getStatus(): {
    isRunning: boolean;
    config: MonitorConfig;
    memorySnapshotCount: number;
    latencySnapshotCount: number;
    queueCount: number;
    activeAlerts: SlowDeathAlert[];
    recentAlertCount: number;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      memorySnapshotCount: this.memorySnapshots.length,
      latencySnapshotCount: this.latencySnapshots.length,
      queueCount: this.queueSnapshots.size,
      activeAlerts: Array.from(this.activeAlerts.values()),
      recentAlertCount: this.alertHistory.length,
    };
  }

  /**
   * Get memory trend analysis
   */
  public getMemoryTrend(): TrendAnalysis | null {
    if (this.memorySnapshots.length < 2) return null;
    
    return this.calculateTrend(
      this.memorySnapshots.map(s => ({ timestamp: s.timestamp, value: s.heapUsedMB })),
      'heap_used_mb'
    );
  }

  /**
   * Get memory snapshots
   */
  public getMemorySnapshots(): MemorySnapshot[] {
    return [...this.memorySnapshots];
  }

  /**
   * Get latency trend analysis
   */
  public getLatencyTrend(): TrendAnalysis | null {
    if (this.latencySnapshots.length < 2) return null;
    
    return this.calculateTrend(
      this.latencySnapshots.map(s => ({ timestamp: s.timestamp, value: s.avgLatencyMs })),
      'avg_latency_ms'
    );
  }

  /**
   * Get all active alerts
   */
  public getActiveAlerts(): SlowDeathAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  public getAlertHistory(): SlowDeathAlert[] {
    return [...this.alertHistory];
  }

  /**
   * Get comprehensive report
   */
  public getReport(): {
    status: 'healthy' | 'degrading' | 'critical';
    memoryTrend: TrendAnalysis | null;
    latencyTrend: TrendAnalysis | null;
    activeAlerts: SlowDeathAlert[];
    recommendations: string[];
  } {
    const memoryTrend = this.getMemoryTrend();
    const latencyTrend = this.getLatencyTrend();
    const activeAlerts = this.getActiveAlerts();

    // Determine overall status
    let status: 'healthy' | 'degrading' | 'critical' = 'healthy';
    if (activeAlerts.some(a => a.severity === 'critical')) {
      status = 'critical';
    } else if (activeAlerts.length > 0) {
      status = 'degrading';
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (memoryTrend && memoryTrend.trend === 'increasing' && memoryTrend.growthRatePerHour > 5) {
      recommendations.push(`Memory growing at ${memoryTrend.growthRatePerHour.toFixed(1)} MB/hour. Consider investigating for memory leaks or increasing cleanup frequency.`);
    }

    if (latencyTrend && latencyTrend.trend === 'increasing') {
      recommendations.push(`Latency trending upward. Check for resource contention, database performance, or increased load.`);
    }

    for (const alert of activeAlerts) {
      if (alert.type === 'queue_buildup') {
        recommendations.push(`Queue buildup detected. Consider scaling consumers or reducing producer rate.`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('System health is stable. No immediate action required.');
    }

    return {
      status,
      memoryTrend,
      latencyTrend,
      activeAlerts,
      recommendations,
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[SlowDeathMonitor] Config updated:', this.config);
  }

  /**
   * Force analysis run
   */
  public forceAnalysis(): void {
    console.log('[SlowDeathMonitor] Force analysis triggered');
    this.runAnalysis();
  }
}

export const slowDeathMonitor = SlowDeathMonitor.getInstance();
