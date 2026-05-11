import { EventEmitter } from "events";
import { getActiveClock } from '../_core/clock';
import { notifyOwner } from "../_core/notification";

/**
 * Automated Alert System
 * 
 * Sends notifications to the owner about system events and trading activity.
 * NO user action required - all notifications are informational only.
 * 
 * Features:
 * - Trade execution alerts
 * - Position closure alerts
 * - Risk limit warnings
 * - System health alerts
 * - Daily performance summaries
 * 
 * @fires alert_sent - When an alert is successfully sent
 * @fires alert_failed - When an alert fails to send
 */
export class AutomatedAlertSystem extends EventEmitter {
  private userId: number;
  private enabled: boolean = true;
  
  // Alert throttling to avoid spam
  private lastAlertTime: Map<string, number> = new Map();
  private readonly ALERT_THROTTLE_MS = 60000; // 1 minute between similar alerts
  
  // Daily summary tracking
  private lastDailySummaryTime: number = 0;
  private readonly DAILY_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(userId: number, config?: {
    enabled?: boolean;
  }) {
    super();
    this.userId = userId;
    
    if (config) {
      if (config.enabled !== undefined) this.enabled = config.enabled;
    }
    
    console.log(`[AutomatedAlertSystem] Initialized for user ${userId}`);
    console.log(`[AutomatedAlertSystem] Alerts: ${this.enabled ? 'Enabled' : 'Disabled'}`);
    
    // Schedule daily summaries
    this.scheduleDailySummaries();
  }

  /**
   * Send trade execution alert
   */
  async alertTradeExecuted(data: {
    symbol: string;
    action: 'buy' | 'sell';
    quantity: number;
    entryPrice: number;
    positionSize: number;
    confidence: number;
    reasoning: string;
  }): Promise<void> {
    if (!this.enabled) return;
    
    const alertKey = `trade_executed_${data.symbol}`;
    if (!this.shouldSendAlert(alertKey)) return;

    try {
      const success = await notifyOwner({
        title: `🤖 Automated Trade Executed: ${data.symbol}`,
        content: `
**Action:** ${data.action.toUpperCase()}
**Symbol:** ${data.symbol}
**Entry Price:** $${data.entryPrice.toFixed(2)}
**Quantity:** ${data.quantity.toFixed(8)}
**Position Size:** $${data.positionSize.toFixed(2)}
**Confidence:** ${(data.confidence * 100).toFixed(1)}%

**Reasoning:**
${data.reasoning}

*This trade was executed automatically by the SEER trading system. No action required.*
        `.trim(),
      });

      if (success) {
        this.markAlertSent(alertKey);
        this.emit('alert_sent', { type: 'trade_executed', data });
        console.log(`[AutomatedAlertSystem] ✅ Trade execution alert sent for ${data.symbol}`);
      } else {
        this.emit('alert_failed', { type: 'trade_executed', data, reason: 'Notification service unavailable' });
        console.warn(`[AutomatedAlertSystem] ⚠️ Trade execution alert failed for ${data.symbol}`);
      }
    } catch (error) {
      this.emit('alert_failed', { type: 'trade_executed', data, error });
      console.error(`[AutomatedAlertSystem] ❌ Error sending trade execution alert:`, error);
    }
  }

  /**
   * Send position closure alert
   */
  async alertPositionClosed(data: {
    symbol: string;
    reason: 'stop_loss' | 'take_profit' | 'manual' | 'veto';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    duration: number; // milliseconds
  }): Promise<void> {
    if (!this.enabled) return;
    
    const alertKey = `position_closed_${data.symbol}`;
    if (!this.shouldSendAlert(alertKey)) return;

    const emoji = data.pnl >= 0 ? '🎯' : '🛑';
    const reasonText = {
      stop_loss: 'Stop-Loss Hit',
      take_profit: 'Take-Profit Hit',
      manual: 'Manual Close',
      veto: 'Veto Exit',
    }[data.reason];

    try {
      const success = await notifyOwner({
        title: `${emoji} Position Closed: ${data.symbol} (${reasonText})`,
        content: `
**Symbol:** ${data.symbol}
**Reason:** ${reasonText}
**Entry Price:** $${data.entryPrice.toFixed(2)}
**Exit Price:** $${data.exitPrice.toFixed(2)}
**P&L:** ${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(2)} (${data.pnlPercent >= 0 ? '+' : ''}${data.pnlPercent.toFixed(2)}%)
**Duration:** ${this.formatDuration(data.duration)}

*This position was closed automatically by the SEER trading system. No action required.*
        `.trim(),
      });

      if (success) {
        this.markAlertSent(alertKey);
        this.emit('alert_sent', { type: 'position_closed', data });
        console.log(`[AutomatedAlertSystem] ✅ Position closure alert sent for ${data.symbol}`);
      } else {
        this.emit('alert_failed', { type: 'position_closed', data, reason: 'Notification service unavailable' });
      }
    } catch (error) {
      this.emit('alert_failed', { type: 'position_closed', data, error });
      console.error(`[AutomatedAlertSystem] ❌ Error sending position closure alert:`, error);
    }
  }

  /**
   * Send risk limit warning
   */
  async alertRiskLimitWarning(data: {
    type: 'max_positions' | 'daily_loss' | 'position_size' | 'circuit_breaker';
    message: string;
    currentValue: number;
    limitValue: number;
  }): Promise<void> {
    if (!this.enabled) return;
    
    const alertKey = `risk_warning_${data.type}`;
    if (!this.shouldSendAlert(alertKey)) return;

    try {
      const success = await notifyOwner({
        title: `⚠️ Risk Limit Warning: ${data.type.replace(/_/g, ' ').toUpperCase()}`,
        content: `
**Type:** ${data.type.replace(/_/g, ' ').toUpperCase()}
**Current Value:** ${data.currentValue}
**Limit:** ${data.limitValue}
**Message:** ${data.message}

*The SEER trading system has automatically enforced risk limits. No action required unless you want to adjust limits.*
        `.trim(),
      });

      if (success) {
        this.markAlertSent(alertKey);
        this.emit('alert_sent', { type: 'risk_warning', data });
        console.log(`[AutomatedAlertSystem] ✅ Risk warning alert sent: ${data.type}`);
      }
    } catch (error) {
      this.emit('alert_failed', { type: 'risk_warning', data, error });
      console.error(`[AutomatedAlertSystem] ❌ Error sending risk warning alert:`, error);
    }
  }

  /**
   * Send system health alert
   */
  async alertSystemHealth(data: {
    status: 'degraded' | 'critical' | 'recovered';
    component: string;
    message: string;
  }): Promise<void> {
    if (!this.enabled) return;
    
    const alertKey = `system_health_${data.component}`;
    
    // Don't throttle critical alerts
    if (data.status !== 'critical' && !this.shouldSendAlert(alertKey)) {
      return;
    }

    const emoji = {
      degraded: '⚠️',
      critical: '🚨',
      recovered: '✅',
    }[data.status];

    try {
      const success = await notifyOwner({
        title: `${emoji} System Health: ${data.status.toUpperCase()}`,
        content: `
**Component:** ${data.component}
**Status:** ${data.status.toUpperCase()}
**Message:** ${data.message}

*The SEER trading system is monitoring the situation. ${data.status === 'critical' ? 'Trading may be paused until recovery.' : 'No action required.'}*
        `.trim(),
      });

      if (success) {
        this.markAlertSent(alertKey);
        this.emit('alert_sent', { type: 'system_health', data });
        console.log(`[AutomatedAlertSystem] ✅ System health alert sent: ${data.component} - ${data.status}`);
      }
    } catch (error) {
      this.emit('alert_failed', { type: 'system_health', data, error });
      console.error(`[AutomatedAlertSystem] ❌ Error sending system health alert:`, error);
    }
  }

  /**
   * Send daily performance summary
   */
  async sendDailySummary(data: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    winRate: number;
    bestTrade: { symbol: string; pnl: number };
    worstTrade: { symbol: string; pnl: number };
    activePositions: number;
  }): Promise<void> {
    if (!this.enabled) return;

    try {
      const success = await notifyOwner({
        title: `📊 Daily Trading Summary`,
        content: `
**Total Trades:** ${data.totalTrades}
**Winning Trades:** ${data.winningTrades} (${data.winRate.toFixed(1)}%)
**Losing Trades:** ${data.losingTrades}
**Total P&L:** ${data.totalPnL >= 0 ? '+' : ''}$${data.totalPnL.toFixed(2)}

**Best Trade:** ${data.bestTrade.symbol} (+$${data.bestTrade.pnl.toFixed(2)})
**Worst Trade:** ${data.worstTrade.symbol} (-$${Math.abs(data.worstTrade.pnl).toFixed(2)})

**Active Positions:** ${data.activePositions}

*This is an automated daily summary from the SEER trading system. No action required.*
        `.trim(),
      });

      if (success) {
        this.emit('alert_sent', { type: 'daily_summary', data });
        console.log(`[AutomatedAlertSystem] ✅ Daily summary sent`);
      }
    } catch (error) {
      this.emit('alert_failed', { type: 'daily_summary', data, error });
      console.error(`[AutomatedAlertSystem] ❌ Error sending daily summary:`, error);
    }
  }

  /**
   * Check if an alert should be sent (throttling)
   */
  private shouldSendAlert(alertKey: string): boolean {
    const lastTime = this.lastAlertTime.get(alertKey) || 0;
    const now = getActiveClock().now();
    
    if (now - lastTime < this.ALERT_THROTTLE_MS) {
      return false; // Throttled
    }
    
    return true;
  }

  /**
   * Mark an alert as sent
   */
  private markAlertSent(alertKey: string): void {
    this.lastAlertTime.set(alertKey, getActiveClock().now());
  }

  /**
   * Schedule daily summaries
   */
  private scheduleDailySummaries(): void {
    setInterval(() => {
      const now = getActiveClock().now();
      if (now - this.lastDailySummaryTime >= this.DAILY_SUMMARY_INTERVAL_MS) {
        this.emit('daily_summary_due');
        this.lastDailySummaryTime = now;
      }
    }, 60 * 60 * 1000); // Check every hour
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Enable/disable alerts
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[AutomatedAlertSystem] Alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get alert system status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      throttleMs: this.ALERT_THROTTLE_MS,
      lastDailySummaryTime: this.lastDailySummaryTime,
      pendingAlerts: this.lastAlertTime.size,
    };
  }
}
