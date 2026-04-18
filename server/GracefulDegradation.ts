/**
 * Graceful Degradation System
 * Handles agent failures and ensures system continues operating with reduced functionality
 * 
 * Per AGENT_RULEBOOK Section 8.1:
 * - System must continue operating even if agents fail
 * - Minimum 3 agents required for consensus
 * - Fallback to conservative strategy if critical agents fail
 * - Automatic recovery when agents come back online
 */

export interface AgentHealthStatus {
  agentName: string;
  isHealthy: boolean;
  lastSuccessTime: number;
  consecutiveFailures: number;
  errorMessage?: string;
}

export interface SystemHealthStatus {
  overallHealth: 'healthy' | 'degraded' | 'critical';
  healthyAgents: number;
  totalAgents: number;
  degradedAgents: string[];
  failedAgents: string[];
  canTrade: boolean;
  reason?: string;
}

export class GracefulDegradation {
  private agentHealth: Map<string, AgentHealthStatus> = new Map();
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly RECOVERY_TIMEOUT = 300000; // 5 minutes
  private readonly CRITICAL_AGENTS = ['TechnicalAnalyst', 'OrderFlowAnalyst', 'MacroAnalyst'];
  private readonly MIN_AGENTS_REQUIRED = 3;

  constructor() {
    // Initialize health status for all agents
    const allAgents = [
      'TechnicalAnalyst',
      'PatternMatcher',
      'OrderFlowAnalyst',
      'SentimentAnalyst',
      'NewsSentinel',
      'MacroAnalyst',
      'OnChainAnalyst',
    ];

    for (const agent of allAgents) {
      this.agentHealth.set(agent, {
        agentName: agent,
        isHealthy: true,
        lastSuccessTime: Date.now(),
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Record successful agent execution
   */
  recordSuccess(agentName: string): void {
    const health = this.agentHealth.get(agentName);
    if (!health) return;

    health.isHealthy = true;
    health.lastSuccessTime = Date.now();
    health.consecutiveFailures = 0;
    health.errorMessage = undefined;

    console.log(`[GracefulDegradation] ${agentName} recovered successfully`);
  }

  /**
   * Record agent failure
   */
  recordFailure(agentName: string, error: string): void {
    const health = this.agentHealth.get(agentName);
    if (!health) return;

    health.consecutiveFailures++;
    health.errorMessage = error;

    if (health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      health.isHealthy = false;
      console.error(`[GracefulDegradation] ${agentName} marked as UNHEALTHY after ${health.consecutiveFailures} failures`);
    } else {
      console.warn(`[GracefulDegradation] ${agentName} failed (${health.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}): ${error}`);
    }
  }

  /**
   * Get health status for a specific agent
   */
  getAgentHealth(agentName: string): AgentHealthStatus | undefined {
    return this.agentHealth.get(agentName);
  }

  /**
   * Get overall system health status
   */
  getSystemHealth(): SystemHealthStatus {
    const allAgents = Array.from(this.agentHealth.values());
    const healthyAgents = allAgents.filter(a => a.isHealthy);
    const degradedAgents = allAgents.filter(a => !a.isHealthy && a.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES);
    const failedAgents = allAgents.filter(a => !a.isHealthy && a.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES);

    // Check if critical agents are healthy
    const criticalAgentsHealthy = this.CRITICAL_AGENTS.every(name => {
      const health = this.agentHealth.get(name);
      return health?.isHealthy ?? false;
    });

    // Determine overall health
    let overallHealth: 'healthy' | 'degraded' | 'critical';
    let canTrade = true;
    let reason: string | undefined;

    if (healthyAgents.length < this.MIN_AGENTS_REQUIRED) {
      overallHealth = 'critical';
      canTrade = false;
      reason = `Only ${healthyAgents.length}/${allAgents.length} agents healthy (minimum ${this.MIN_AGENTS_REQUIRED} required)`;
    } else if (!criticalAgentsHealthy) {
      overallHealth = 'degraded';
      canTrade = false;
      reason = 'One or more critical agents (TechnicalAnalyst, OrderFlowAnalyst, MacroAnalyst) are unhealthy';
    } else if (failedAgents.length > 0) {
      overallHealth = 'degraded';
      canTrade = true; // Can still trade with reduced functionality
      reason = `${failedAgents.length} agent(s) failed: ${failedAgents.map(a => a.agentName).join(', ')}`;
    } else {
      overallHealth = 'healthy';
    }

    return {
      overallHealth,
      healthyAgents: healthyAgents.length,
      totalAgents: allAgents.length,
      degradedAgents: degradedAgents.map(a => a.agentName),
      failedAgents: failedAgents.map(a => a.agentName),
      canTrade,
      reason,
    };
  }

  /**
   * Check if trading should be allowed based on system health
   */
  canTrade(): boolean {
    return this.getSystemHealth().canTrade;
  }

  /**
   * Get fallback strategy when system is degraded
   */
  getFallbackStrategy(): {
    useConservativePositionSizing: boolean;
    increaseStopLoss: boolean;
    requireHigherConfidence: boolean;
    disableAlphaSignals: boolean;
  } {
    const health = this.getSystemHealth();

    if (health.overallHealth === 'critical') {
      return {
        useConservativePositionSizing: true,
        increaseStopLoss: true,
        requireHigherConfidence: true,
        disableAlphaSignals: true,
      };
    }

    if (health.overallHealth === 'degraded') {
      return {
        useConservativePositionSizing: true,
        increaseStopLoss: false,
        requireHigherConfidence: true,
        disableAlphaSignals: false,
      };
    }

    return {
      useConservativePositionSizing: false,
      increaseStopLoss: false,
      requireHigherConfidence: false,
      disableAlphaSignals: false,
    };
  }

  /**
   * Attempt to recover failed agents
   */
  async attemptRecovery(): Promise<void> {
    const now = Date.now();
    
    for (const [agentName, health] of Array.from(this.agentHealth.entries())) {
      if (!health.isHealthy && (now - health.lastSuccessTime) > this.RECOVERY_TIMEOUT) {
        console.log(`[GracefulDegradation] Attempting recovery for ${agentName}...`);
        
        // Reset failure count to give agent another chance
        health.consecutiveFailures = 0;
        health.isHealthy = true;
        
        console.log(`[GracefulDegradation] ${agentName} recovery attempt initiated`);
      }
    }
  }

  /**
   * Get detailed health report
   */
  getHealthReport(): string {
    const health = this.getSystemHealth();
    const fallback = this.getFallbackStrategy();

    let report = `=== System Health Report ===\n`;
    report += `Overall Health: ${health.overallHealth.toUpperCase()}\n`;
    report += `Healthy Agents: ${health.healthyAgents}/${health.totalAgents}\n`;
    
    if (health.degradedAgents.length > 0) {
      report += `Degraded Agents: ${health.degradedAgents.join(', ')}\n`;
    }
    
    if (health.failedAgents.length > 0) {
      report += `Failed Agents: ${health.failedAgents.join(', ')}\n`;
    }
    
    report += `Can Trade: ${health.canTrade ? 'YES' : 'NO'}\n`;
    
    if (health.reason) {
      report += `Reason: ${health.reason}\n`;
    }
    
    if (fallback.useConservativePositionSizing || fallback.requireHigherConfidence) {
      report += `\nFallback Strategy Active:\n`;
      if (fallback.useConservativePositionSizing) report += `- Conservative position sizing (50% reduction)\n`;
      if (fallback.increaseStopLoss) report += `- Tighter stop-loss (1.5x multiplier)\n`;
      if (fallback.requireHigherConfidence) report += `- Higher confidence threshold (0.8 → 0.85)\n`;
      if (fallback.disableAlphaSignals) report += `- Alpha signals disabled\n`;
    }

    return report;
  }
}

// Singleton instance
let degradationInstance: GracefulDegradation | null = null;

/**
 * Get Graceful Degradation singleton instance
 */
export function getGracefulDegradation(): GracefulDegradation {
  if (!degradationInstance) {
    degradationInstance = new GracefulDegradation();
  }
  return degradationInstance;
}
