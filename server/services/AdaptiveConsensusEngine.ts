/**
 * Phase 16: AdaptiveConsensusEngine — Performance-Driven Consensus Weighting
 *
 * Replaces the static threshold-based consensus (Phase 15B) with a system that
 * dynamically adjusts agent weights based on proven alpha from AgentAlphaValidator.
 *
 * Key improvements over Phase 15B:
 * 1. Agents with no proven alpha get their weight reduced to 0.1× (near zero influence)
 * 2. Agents with proven alpha get boosted up to 2× based on Sharpe ratio
 * 3. Weights update every 6 hours from validation results (not just every 10 trades)
 * 4. Dead/stale agents automatically get zero weight
 * 5. Rolling performance window: recent performance matters more than historical
 *
 * This integrates with the existing AgentWeightManager to update weights,
 * rather than replacing it. The AgentWeightManager remains the single source
 * of truth for weights; this engine just feeds better data into it.
 */

import { EventEmitter } from 'events';
import { getActiveClock } from '../_core/clock';
import { getAgentAlphaValidator, AlphaValidationResult, AgentAlphaReport } from './AgentAlphaValidator';
import { getAgentWeightManager, AgentName, ALL_AGENTS } from './AgentWeightManager';

export interface AdaptiveWeight {
  agentName: string;
  baseWeight: number;        // From AgentWeightManager defaults
  alphaMultiplier: number;   // From alpha validation (0.1 to 2.0)
  rollingMultiplier: number; // From recent performance (0.5 to 1.5)
  finalWeight: number;       // baseWeight × alphaMultiplier × rollingMultiplier
  reason: string;
}

export interface ConsensusEngineStatus {
  isActive: boolean;
  lastUpdate: number;
  totalUpdates: number;
  currentWeights: AdaptiveWeight[];
  prunedAgents: string[];
  boostedAgents: string[];
}

class AdaptiveConsensusEngine extends EventEmitter {
  private isActive: boolean = false;
  private lastUpdate: number = 0;
  private totalUpdates: number = 0;
  private currentWeights: AdaptiveWeight[] = [];
  private prunedAgents: Set<string> = new Set();
  private boostedAgents: Set<string> = new Set();
  private userId: number = 1;

  // Multiplier bounds
  private readonly MIN_ALPHA_MULTIPLIER = 0.1;  // Near-zero for agents with no alpha
  private readonly MAX_ALPHA_MULTIPLIER = 2.0;   // Double weight for best agents
  private readonly PRUNE_MULTIPLIER = 0.05;      // Effectively disabled

  constructor(userId: number = 1) {
    super();
    this.userId = userId;
  }

  /**
   * Start listening for alpha validation results
   */
  start(): void {
    if (this.isActive) return;

    console.log('[AdaptiveConsensusEngine] Starting...');
    this.isActive = true;

    // Listen for validation results from AgentAlphaValidator
    const validator = getAgentAlphaValidator();
    validator.on('validation_complete', (result: AlphaValidationResult) => {
      this.onValidationResult(result);
    });

    // Apply from last validation if available
    const lastValidation = validator.getLastValidation();
    if (lastValidation) {
      this.onValidationResult(lastValidation);
    }

    console.log('[AdaptiveConsensusEngine] ✅ Started');
  }

  stop(): void {
    this.isActive = false;
    console.log('[AdaptiveConsensusEngine] Stopped');
  }

  getStatus(): ConsensusEngineStatus {
    return {
      isActive: this.isActive,
      lastUpdate: this.lastUpdate,
      totalUpdates: this.totalUpdates,
      currentWeights: [...this.currentWeights],
      prunedAgents: [...this.prunedAgents],
      boostedAgents: [...this.boostedAgents],
    };
  }

  /**
   * Handle new validation results — update all agent weights
   */
  private onValidationResult(result: AlphaValidationResult): void {
    if (!this.isActive) return;

    console.log('[AdaptiveConsensusEngine] Processing alpha validation results...');

    try {
      const weightManager = getAgentWeightManager(this.userId);
      const newWeights: AdaptiveWeight[] = [];
      this.prunedAgents.clear();
      this.boostedAgents.clear();

      // Build a lookup for agent reports
      const reportMap = new Map<string, AgentAlphaReport>();
      for (const report of result.agentReports) {
        reportMap.set(report.agentName, report);
      }

      // Process each known agent
      for (const agentName of ALL_AGENTS) {
        const report = reportMap.get(agentName);
        const baseScore = weightManager.calculateAgentWeight(agentName);
        const baseWeight = baseScore?.baseWeight || 0;

        if (baseWeight === 0) {
          // Agent is disabled by default — skip
          newWeights.push({
            agentName,
            baseWeight: 0,
            alphaMultiplier: 0,
            rollingMultiplier: 0,
            finalWeight: 0,
            reason: 'Disabled by default',
          });
          continue;
        }

        const alphaData = this.computeAlphaMultiplier(report);
        const rollingData = this.computeRollingMultiplier(report);

        const finalWeight = baseWeight * alphaData.multiplier * rollingData.multiplier;

        newWeights.push({
          agentName,
          baseWeight,
          alphaMultiplier: alphaData.multiplier,
          rollingMultiplier: rollingData.multiplier,
          finalWeight,
          reason: `${alphaData.reason}; ${rollingData.reason}`,
        });

        // Track pruned/boosted
        if (alphaData.multiplier <= this.PRUNE_MULTIPLIER) {
          this.prunedAgents.add(agentName);
        }
        if (alphaData.multiplier >= 1.5) {
          this.boostedAgents.add(agentName);
        }

        // Update the weight in AgentWeightManager
        // Scale finalWeight back to the 0-100 range AgentWeightManager expects
        const scaledWeight = Math.max(0, Math.min(100, finalWeight));
        weightManager.setAgentWeight(agentName as AgentName, scaledWeight);
      }

      // Also process any agents in validation results that aren't in ALL_AGENTS
      // (e.g., new agents, audit agents)
      for (const report of result.agentReports) {
        if (!ALL_AGENTS.includes(report.agentName as any)) {
          newWeights.push({
            agentName: report.agentName,
            baseWeight: 0,
            alphaMultiplier: 0,
            rollingMultiplier: 0,
            finalWeight: 0,
            reason: `Not in agent registry (${report.recommendation})`,
          });
        }
      }

      this.currentWeights = newWeights;
      this.lastUpdate = getActiveClock().now();
      this.totalUpdates++;

      // Save updated weights to database
      weightManager.saveToDatabase().catch(err => {
        console.error('[AdaptiveConsensusEngine] Failed to persist weights:', (err as Error)?.message);
      });

      // Emit event for logging/monitoring
      this.emit('weights_updated', {
        timestamp: this.lastUpdate,
        weights: newWeights,
        prunedAgents: [...this.prunedAgents],
        boostedAgents: [...this.boostedAgents],
      });

      // Log changes
      this.logWeightChanges(newWeights);
    } catch (error) {
      console.error('[AdaptiveConsensusEngine] Error processing validation results:', (error as Error)?.message);
    }
  }

  /**
   * Compute alpha multiplier from validation report
   * Maps agent grade + recommendation to a multiplier
   */
  private computeAlphaMultiplier(report: AgentAlphaReport | undefined): { multiplier: number; reason: string } {
    if (!report) {
      // Phase 22 fix: Return neutral 1.0x — don't penalize agents just because
      // no trade data exists yet. Previous 0.5x was halving ALL agent weights
      // at startup, degrading consensus quality before any trades execute.
      return { multiplier: 1.0, reason: 'No validation data — neutral' };
    }

    if (report.totalTrades < 10) {
      return { multiplier: 0.8, reason: `Only ${report.totalTrades} trades (need 30+)` };
    }

    switch (report.recommendation) {
      case 'prune':
        return {
          multiplier: this.PRUNE_MULTIPLIER,
          reason: `PRUNED: grade=${report.alphaGrade}, accuracy=${(report.directionalAccuracy * 100).toFixed(1)}%`,
        };

      case 'reduce':
        return {
          multiplier: 0.3,
          reason: `Reduced: grade=${report.alphaGrade}, accuracy=${(report.directionalAccuracy * 100).toFixed(1)}%`,
        };

      case 'keep':
        // Scale 0.5-1.0 based on accuracy
        const keepMultiplier = 0.5 + (report.directionalAccuracy - 0.45) * 5; // 0.45→0.5, 0.55→1.0
        return {
          multiplier: Math.max(0.5, Math.min(1.0, keepMultiplier)),
          reason: `Keep: grade=${report.alphaGrade}, accuracy=${(report.directionalAccuracy * 100).toFixed(1)}%`,
        };

      case 'boost':
        // Scale 1.2-2.0 based on Sharpe ratio
        const boostBase = 1.2;
        const sharpeBonus = Math.min(0.8, report.sharpeRatio * 0.2); // Sharpe 1→+0.2, Sharpe 4→+0.8
        return {
          multiplier: Math.min(this.MAX_ALPHA_MULTIPLIER, boostBase + sharpeBonus),
          reason: `BOOSTED: grade=${report.alphaGrade}, Sharpe=${report.sharpeRatio.toFixed(2)}`,
        };

      default:
        return { multiplier: 1.0, reason: 'Default' };
    }
  }

  /**
   * Compute rolling performance multiplier
   * Rewards agents whose recent performance (last 50 trades) is improving
   */
  private computeRollingMultiplier(report: AgentAlphaReport | undefined): { multiplier: number; reason: string } {
    if (!report || report.totalTrades < 20) {
      return { multiplier: 1.0, reason: 'Insufficient rolling data' };
    }

    // Compare rolling win rate to overall win rate
    const improvement = report.rollingWinRate - report.directionalAccuracy;

    if (improvement > 0.05) {
      // Agent is improving — boost slightly
      return {
        multiplier: 1.2,
        reason: `Improving: rolling ${(report.rollingWinRate * 100).toFixed(1)}% > overall ${(report.directionalAccuracy * 100).toFixed(1)}%`,
      };
    } else if (improvement < -0.05) {
      // Agent is degrading — reduce
      return {
        multiplier: 0.8,
        reason: `Degrading: rolling ${(report.rollingWinRate * 100).toFixed(1)}% < overall ${(report.directionalAccuracy * 100).toFixed(1)}%`,
      };
    }

    return { multiplier: 1.0, reason: 'Stable performance' };
  }

  /**
   * Log weight changes summary
   */
  private logWeightChanges(weights: AdaptiveWeight[]): void {
    const active = weights.filter(w => w.finalWeight > 0);
    const pruned = weights.filter(w => w.alphaMultiplier <= this.PRUNE_MULTIPLIER && w.baseWeight > 0);
    const boosted = weights.filter(w => w.alphaMultiplier >= 1.5);

    console.log(`[AdaptiveConsensusEngine] Updated ${active.length} agent weights:`);
    console.log(`  ⬆️  Boosted (${boosted.length}): ${boosted.map(w => `${w.agentName}(×${w.alphaMultiplier.toFixed(1)})`).join(', ') || 'none'}`);
    console.log(`  ❌ Pruned (${pruned.length}): ${pruned.map(w => w.agentName).join(', ') || 'none'}`);
    console.log(`  📊 Active agents: ${active.filter(w => w.alphaMultiplier > this.PRUNE_MULTIPLIER).length}/${active.length}`);
  }
}

// Singleton
let instance: AdaptiveConsensusEngine | null = null;

export function getAdaptiveConsensusEngine(userId: number = 1): AdaptiveConsensusEngine {
  if (!instance) {
    instance = new AdaptiveConsensusEngine(userId);
  }
  return instance;
}

export { AdaptiveConsensusEngine };
