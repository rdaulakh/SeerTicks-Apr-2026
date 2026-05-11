/**
 * Agent Health Monitor
 * 
 * PURPOSE: Detect agent bias, track signal distribution, and alert on unhealthy patterns
 * DATE: February 6, 2026
 * 
 * MONITORS:
 * - Signal direction distribution per agent (bullish/bearish/neutral ratios)
 * - Confidence score distribution (are agents always high confidence?)
 * - Agent staleness (is an agent not producing signals?)
 * - Bias alerts when any agent exceeds 80% in one direction over rolling window
 */

import { getDb } from '../db';
import { getActiveClock } from '../_core/clock';
import { agentSignals } from '../../drizzle/schema';
import { sql, desc, gte, and } from 'drizzle-orm';

export interface AgentHealthReport {
  agentName: string;
  totalSignals: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  avgConfidence: number;
  biasDetected: boolean;
  biasDirection: 'bullish' | 'bearish' | 'neutral' | 'none';
  biasSeverity: 'critical' | 'warning' | 'healthy';
  lastSignalAge: number; // minutes since last signal
  isStale: boolean;
}

export interface SystemHealthSummary {
  timestamp: Date;
  totalAgents: number;
  healthyAgents: number;
  biasedAgents: number;
  staleAgents: number;
  overallBias: 'bullish' | 'bearish' | 'balanced';
  agents: AgentHealthReport[];
  alerts: string[];
}

// Bias thresholds
const BIAS_CRITICAL_THRESHOLD = 0.85; // >85% in one direction = critical
const BIAS_WARNING_THRESHOLD = 0.70;  // >70% in one direction = warning
const STALE_THRESHOLD_MINUTES = 30;   // No signal for 30+ minutes = stale
const ROLLING_WINDOW_HOURS = 1;       // Check last 1 hour of signals

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastHealthReport: SystemHealthSummary | null = null;

/**
 * Analyze a single agent's signal distribution over the rolling window
 */
async function analyzeAgent(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  agentName: string,
  windowStart: Date
): Promise<AgentHealthReport> {
  try {
    // Get signal distribution for this agent in the rolling window
    const signals = await db
      .select({
        signalType: agentSignals.signalType,
        confidence: agentSignals.confidence,
        timestamp: agentSignals.timestamp,
      })
      .from(agentSignals)
      .where(
        and(
          sql`${agentSignals.agentName} = ${agentName}`,
          gte(agentSignals.timestamp, windowStart)
        )
      )
      .orderBy(desc(agentSignals.timestamp));

    const totalSignals = signals.length;
    
    // Count directions
    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const sig of signals) {
      const type = (sig.signalType || '').toLowerCase();
      if (type.includes('bull') || type === 'buy' || type === 'long') {
        bullishCount++;
      } else if (type.includes('bear') || type === 'sell' || type === 'short') {
        bearishCount++;
      } else {
        neutralCount++;
      }
      
      if (sig.confidence) {
        const conf = parseFloat(String(sig.confidence));
        if (!isNaN(conf)) {
          totalConfidence += conf;
          confidenceCount++;
        }
      }
    }

    const bullishPercent = totalSignals > 0 ? (bullishCount / totalSignals) * 100 : 0;
    const bearishPercent = totalSignals > 0 ? (bearishCount / totalSignals) * 100 : 0;
    const neutralPercent = totalSignals > 0 ? (neutralCount / totalSignals) * 100 : 0;
    const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    // Detect bias
    let biasDetected = false;
    let biasDirection: 'bullish' | 'bearish' | 'neutral' | 'none' = 'none';
    let biasSeverity: 'critical' | 'warning' | 'healthy' = 'healthy';

    if (totalSignals >= 5) { // Need minimum signals to detect bias
      if (bullishPercent / 100 >= BIAS_CRITICAL_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'bullish';
        biasSeverity = 'critical';
      } else if (bearishPercent / 100 >= BIAS_CRITICAL_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'bearish';
        biasSeverity = 'critical';
      } else if (neutralPercent / 100 >= BIAS_CRITICAL_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'neutral';
        biasSeverity = 'critical';
      } else if (bullishPercent / 100 >= BIAS_WARNING_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'bullish';
        biasSeverity = 'warning';
      } else if (bearishPercent / 100 >= BIAS_WARNING_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'bearish';
        biasSeverity = 'warning';
      } else if (neutralPercent / 100 >= BIAS_WARNING_THRESHOLD) {
        biasDetected = true;
        biasDirection = 'neutral';
        biasSeverity = 'warning';
      }
    }

    // Check staleness
    const lastSignalTime = signals.length > 0 ? new Date(signals[0].timestamp).getTime() : 0;
    const lastSignalAge = lastSignalTime > 0 ? (getActiveClock().now() - lastSignalTime) / 60000 : Infinity;
    const isStale = lastSignalAge > STALE_THRESHOLD_MINUTES;

    return {
      agentName,
      totalSignals,
      bullishCount,
      bearishCount,
      neutralCount,
      bullishPercent: Math.round(bullishPercent * 100) / 100,
      bearishPercent: Math.round(bearishPercent * 100) / 100,
      neutralPercent: Math.round(neutralPercent * 100) / 100,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      biasDetected,
      biasDirection,
      biasSeverity,
      lastSignalAge: Math.round(lastSignalAge * 10) / 10,
      isStale,
    };
  } catch (error) {
    console.error(`[AgentHealthMonitor] Error analyzing ${agentName}:`, error);
    return {
      agentName,
      totalSignals: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      bullishPercent: 0,
      bearishPercent: 0,
      neutralPercent: 0,
      avgConfidence: 0,
      biasDetected: false,
      biasDirection: 'none',
      biasSeverity: 'healthy',
      lastSignalAge: Infinity,
      isStale: true,
    };
  }
}

/**
 * Run a full health check across all agents
 */
export async function runAgentHealthCheck(): Promise<SystemHealthSummary | null> {
  const db = await getDb();
  if (!db) {
    console.warn('[AgentHealthMonitor] Database not available');
    return null;
  }

  try {
    const windowStart = new Date(getActiveClock().now() - ROLLING_WINDOW_HOURS * 60 * 60 * 1000);

    // Get distinct agent names from recent signals
    const agentNames = await db
      .selectDistinct({ agentName: agentSignals.agentName })
      .from(agentSignals)
      .where(gte(agentSignals.timestamp, windowStart));

    // Known agents that should always be monitored
    const knownAgents = [
      'SentimentAnalyst',
      'TechnicalAnalyst',
      'PatternMatcher',
      'OnChainFlowAnalyst',
      'FundingRateAnalyst',
      'MacroAnalyst',
      'ForexCorrelationAgent',
    ];

    // Merge known agents with discovered agents
    const allAgentNames = new Set([
      ...knownAgents,
      ...agentNames.map(a => a.agentName),
    ]);

    // Analyze each agent
    const agentReports: AgentHealthReport[] = [];
    for (const name of allAgentNames) {
      const report = await analyzeAgent(db, name, windowStart);
      agentReports.push(report);
    }

    // Generate alerts
    const alerts: string[] = [];
    let healthyCount = 0;
    let biasedCount = 0;
    let staleCount = 0;

    for (const report of agentReports) {
      if (report.biasDetected) {
        biasedCount++;
        const severity = report.biasSeverity === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING';
        alerts.push(
          `${severity}: ${report.agentName} is ${report.biasDirection} biased ` +
          `(${report.bullishPercent}% bull / ${report.bearishPercent}% bear / ${report.neutralPercent}% neutral)`
        );
      }
      if (report.isStale) {
        staleCount++;
        alerts.push(
          `⚪ STALE: ${report.agentName} has not produced signals for ${report.lastSignalAge.toFixed(0)} minutes`
        );
      }
      if (!report.biasDetected && !report.isStale) {
        healthyCount++;
      }
    }

    // Determine overall system bias
    const totalBullish = agentReports.reduce((sum, r) => sum + r.bullishCount, 0);
    const totalBearish = agentReports.reduce((sum, r) => sum + r.bearishCount, 0);
    const totalAll = agentReports.reduce((sum, r) => sum + r.totalSignals, 0);
    let overallBias: 'bullish' | 'bearish' | 'balanced' = 'balanced';
    if (totalAll > 0) {
      if (totalBullish / totalAll > 0.65) overallBias = 'bullish';
      else if (totalBearish / totalAll > 0.65) overallBias = 'bearish';
    }

    const summary: SystemHealthSummary = {
      timestamp: new Date(),
      totalAgents: agentReports.length,
      healthyAgents: healthyCount,
      biasedAgents: biasedCount,
      staleAgents: staleCount,
      overallBias,
      agents: agentReports,
      alerts,
    };

    lastHealthReport = summary;

    // Log summary
    console.log(`[AgentHealthMonitor] Health Check: ${healthyCount}/${agentReports.length} healthy, ${biasedCount} biased, ${staleCount} stale. Overall: ${overallBias}`);
    if (alerts.length > 0) {
      for (const alert of alerts) {
        console.log(`[AgentHealthMonitor] ${alert}`);
      }
    }

    return summary;
  } catch (error) {
    console.error('[AgentHealthMonitor] Health check failed:', error);
    return null;
  }
}

/**
 * Get the last health report without running a new check
 */
export function getLastHealthReport(): SystemHealthSummary | null {
  return lastHealthReport;
}

/**
 * Start the agent health monitor (runs every hour)
 */
export function startAgentHealthMonitor(intervalMinutes: number = 60): void {
  if (monitorInterval) {
    console.log('[AgentHealthMonitor] Already running, skipping start');
    return;
  }

  console.log(`[AgentHealthMonitor] Starting with ${intervalMinutes}-minute interval`);
  
  // Run initial check after 2 minutes (let agents warm up)
  setTimeout(async () => {
    await runAgentHealthCheck();
  }, 2 * 60 * 1000);

  // Then run on interval
  monitorInterval = setInterval(async () => {
    await runAgentHealthCheck();
  }, intervalMinutes * 60 * 1000);
}

/**
 * Stop the agent health monitor
 */
export function stopAgentHealthMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[AgentHealthMonitor] Stopped');
  }
}

export default {
  runAgentHealthCheck,
  getLastHealthReport,
  startAgentHealthMonitor,
  stopAgentHealthMonitor,
};
