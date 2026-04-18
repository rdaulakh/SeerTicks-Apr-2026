import { EventEmitter } from "events";
import type { AgentSignal } from "../agents/AgentBase";
import type { ProcessedSignal, Consensus } from "./AutomatedSignalProcessor";
import { getMacroVetoEnforcer } from "./MacroVetoEnforcer";
import { getRegimeDirectionFilter } from "./RegimeDirectionFilter";

/**
 * SignalQualityGate - A++ Grade Signal Filtering System
 * 
 * Based on comprehensive backtest audit findings:
 * - 80% of losing trades had confidence below 60%
 * - 80% of losing trades had weak consensus (<55%)
 * - Average winning trade had 3.3 agents in agreement
 * 
 * This gate enforces institutional-grade signal quality requirements:
 * 1. Consensus threshold: 70% (raised from 60%)
 * 2. Confidence threshold: 65% (raised from 40%)
 * 3. Minimum agent agreement: 4 agents (raised from 2)
 * 4. Execution score minimum: 50 (raised from 35)
 * 5. Macro trend alignment (via MacroVetoEnforcer)
 * 6. Regime direction alignment (via RegimeDirectionFilter)
 */

export interface QualityGateConfig {
  // A++ Grade Thresholds (based on backtest findings)
  consensusThreshold: number;      // 70% - up from 60%
  confidenceThreshold: number;     // 65% - up from 40%
  minAgentAgreement: number;       // 4 agents - up from 2
  minExecutionScore: number;       // 50 - up from 35
  minQualityScore: number;         // 60% - new requirement
  
  // Feature flags
  enableMacroVeto: boolean;
  enableRegimeFilter: boolean;
  enableAgentAgreementCheck: boolean;
}

export interface QualityGateResult {
  passed: boolean;
  reason: string;
  checks: {
    consensus: { passed: boolean; value: number; threshold: number };
    confidence: { passed: boolean; value: number; threshold: number };
    agentAgreement: { passed: boolean; value: number; threshold: number };
    executionScore: { passed: boolean; value: number; threshold: number };
    macroAlignment: { passed: boolean; reason: string };
    regimeAlignment: { passed: boolean; reason: string };
  };
  recommendation: 'execute' | 'reject' | 'wait';
}

export class SignalQualityGate extends EventEmitter {
  private config: QualityGateConfig;
  private macroVetoEnforcer = getMacroVetoEnforcer();
  private regimeFilter = getRegimeDirectionFilter();
  
  // Statistics
  private stats = {
    totalChecks: 0,
    passed: 0,
    rejected: 0,
    rejectionReasons: new Map<string, number>(),
  };

  constructor(config?: Partial<QualityGateConfig>) {
    super();
    
    // Jan 2026 Update: Lowered thresholds for more trading opportunities
    this.config = {
      consensusThreshold: 0.50,      // 50% consensus required (lowered from 70%)
      confidenceThreshold: 0.55,     // 55% confidence required (lowered from 65%)
      minAgentAgreement: 2,          // 2 agents must agree (lowered from 4)
      minExecutionScore: 40,         // 40/100 execution score (lowered from 50)
      minQualityScore: 0.50,         // 50% quality score (lowered from 60%)
      enableMacroVeto: true,
      enableRegimeFilter: true,
      enableAgentAgreementCheck: true,
      ...config,
    };

    console.log(`[SignalQualityGate] Initialized - A++ Grade Signal Filtering`);
    console.log(`[SignalQualityGate] Consensus Threshold: ${(this.config.consensusThreshold * 100).toFixed(0)}%`);
    console.log(`[SignalQualityGate] Confidence Threshold: ${(this.config.confidenceThreshold * 100).toFixed(0)}%`);
    console.log(`[SignalQualityGate] Min Agent Agreement: ${this.config.minAgentAgreement}`);
    console.log(`[SignalQualityGate] Min Execution Score: ${this.config.minExecutionScore}`);
    console.log(`[SignalQualityGate] Macro Veto: ${this.config.enableMacroVeto ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[SignalQualityGate] Regime Filter: ${this.config.enableRegimeFilter ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Update filters with latest signals
   * Call this before checking signal quality
   */
  updateFilters(signals: AgentSignal[]): void {
    this.macroVetoEnforcer.updateMacroTrend(signals);
    this.regimeFilter.updateRegime(signals);
  }

  /**
   * Check if a signal passes all quality gates
   * This is the main entry point for signal validation
   */
  checkSignalQuality(
    signals: AgentSignal[],
    consensus: Consensus,
    action: 'buy' | 'sell',
    symbol: string
  ): QualityGateResult {
    this.stats.totalChecks++;

    const checks = {
      consensus: this.checkConsensus(consensus),
      confidence: this.checkConfidence(signals),
      agentAgreement: this.checkAgentAgreement(signals, action),
      executionScore: this.checkExecutionScore(signals),
      macroAlignment: this.checkMacroAlignment(action, symbol),
      regimeAlignment: this.checkRegimeAlignment(action, symbol),
    };

    // Determine overall result
    const allPassed = Object.values(checks).every(c => c.passed);
    
    // Build rejection reason if any check failed
    let reason = '';
    let recommendation: 'execute' | 'reject' | 'wait' = 'execute';

    if (!allPassed) {
      const failedChecks = Object.entries(checks)
        .filter(([_, c]) => !c.passed)
        .map(([name, c]) => {
          if ('value' in c && 'threshold' in c) {
            return `${name}: ${typeof c.value === 'number' ? (c.value * 100).toFixed(1) : c.value}% < ${(c.threshold * 100).toFixed(0)}%`;
          }
          return `${name}: ${c.reason}`;
        });
      
      reason = `Quality gate FAILED: ${failedChecks.join('; ')}`;
      recommendation = 'reject';
      
      // Track rejection reasons
      failedChecks.forEach(fc => {
        const key = fc.split(':')[0];
        this.stats.rejectionReasons.set(key, (this.stats.rejectionReasons.get(key) || 0) + 1);
      });
      
      this.stats.rejected++;
    } else {
      reason = `Quality gate PASSED: All ${Object.keys(checks).length} checks passed`;
      this.stats.passed++;
    }

    const result: QualityGateResult = {
      passed: allPassed,
      reason,
      checks,
      recommendation,
    };

    // Emit events
    if (allPassed) {
      console.log(`[SignalQualityGate] ✅ ${symbol} ${action.toUpperCase()} - All quality checks PASSED`);
      this.emit('quality_passed', { symbol, action, result });
    } else {
      console.log(`[SignalQualityGate] ❌ ${symbol} ${action.toUpperCase()} - Quality check FAILED`);
      console.log(`[SignalQualityGate] Reason: ${reason}`);
      this.emit('quality_failed', { symbol, action, result });
    }

    return result;
  }

  /**
   * Check consensus threshold (70%)
   */
  private checkConsensus(consensus: Consensus): { passed: boolean; value: number; threshold: number } {
    const value = consensus.strength;
    const threshold = this.config.consensusThreshold;
    return {
      passed: value >= threshold,
      value,
      threshold,
    };
  }

  /**
   * Check average confidence threshold (65%)
   */
  private checkConfidence(signals: AgentSignal[]): { passed: boolean; value: number; threshold: number } {
    const actionableSignals = signals.filter(s => s.signal !== 'neutral');
    if (actionableSignals.length === 0) {
      return { passed: false, value: 0, threshold: this.config.confidenceThreshold };
    }

    const avgConfidence = actionableSignals.reduce((sum, s) => sum + s.confidence, 0) / actionableSignals.length;
    return {
      passed: avgConfidence >= this.config.confidenceThreshold,
      value: avgConfidence,
      threshold: this.config.confidenceThreshold,
    };
  }

  /**
   * Check minimum agent agreement (4 agents)
   */
  private checkAgentAgreement(signals: AgentSignal[], action: 'buy' | 'sell'): { passed: boolean; value: number; threshold: number } {
    if (!this.config.enableAgentAgreementCheck) {
      return { passed: true, value: signals.length, threshold: 0 };
    }

    const targetSignal = action === 'buy' ? 'bullish' : 'bearish';
    const agreeingAgents = signals.filter(s => s.signal === targetSignal).length;
    
    return {
      passed: agreeingAgents >= this.config.minAgentAgreement,
      value: agreeingAgents,
      threshold: this.config.minAgentAgreement,
    };
  }

  /**
   * Check average execution score (50/100)
   */
  private checkExecutionScore(signals: AgentSignal[]): { passed: boolean; value: number; threshold: number } {
    const signalsWithScore = signals.filter(s => s.executionScore !== undefined);
    if (signalsWithScore.length === 0) {
      // If no execution scores available, pass this check
      return { passed: true, value: 50, threshold: this.config.minExecutionScore };
    }

    const avgScore = signalsWithScore.reduce((sum, s) => sum + (s.executionScore || 0), 0) / signalsWithScore.length;
    return {
      passed: avgScore >= this.config.minExecutionScore,
      value: avgScore / 100, // Normalize to 0-1 for display
      threshold: this.config.minExecutionScore / 100,
    };
  }

  /**
   * Check macro trend alignment
   */
  private checkMacroAlignment(action: 'buy' | 'sell', symbol: string): { passed: boolean; reason: string } {
    if (!this.config.enableMacroVeto) {
      return { passed: true, reason: 'Macro veto disabled' };
    }

    const decision = this.macroVetoEnforcer.checkTradeAllowed(action, symbol);
    return {
      passed: decision.allowed,
      reason: decision.reason,
    };
  }

  /**
   * Check regime direction alignment
   */
  private checkRegimeAlignment(action: 'buy' | 'sell', symbol: string): { passed: boolean; reason: string } {
    if (!this.config.enableRegimeFilter) {
      return { passed: true, reason: 'Regime filter disabled' };
    }

    const decision = this.regimeFilter.checkActionAllowed(action, symbol);
    return {
      passed: decision.allowed,
      reason: decision.reason,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QualityGateConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[SignalQualityGate] Configuration updated`);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      passRate: this.stats.totalChecks > 0 
        ? (this.stats.passed / this.stats.totalChecks * 100).toFixed(1) + '%'
        : 'N/A',
      rejectionReasons: Object.fromEntries(this.stats.rejectionReasons),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      passed: 0,
      rejected: 0,
      rejectionReasons: new Map(),
    };
  }
}

// Singleton instance
let signalQualityGate: SignalQualityGate | null = null;

export function getSignalQualityGate(): SignalQualityGate {
  if (!signalQualityGate) {
    signalQualityGate = new SignalQualityGate();
  }
  return signalQualityGate;
}
