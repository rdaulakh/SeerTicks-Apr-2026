/**
 * AI-Powered Loss Root Cause Analyzer
 * 
 * Uses LLM to analyze losing trades and identify:
 * 1. Pattern recognition in losses
 * 2. Common failure modes
 * 3. Parameter optimization suggestions
 * 4. Strategy improvements
 * 
 * This is the core of the continuous improvement cycle:
 * Backtest → Analyze Losses → Fix → Retest
 */

import { invokeLLM } from '../_core/llm';
import type { BacktestTrade, BacktestResult } from '../backtest/APlusPlusBacktestEngine';

export interface LossPattern {
  name: string;
  description: string;
  frequency: number;
  avgLoss: number;
  trades: string[];
  suggestedFix: string;
}

export interface RootCauseAnalysis {
  // Summary
  totalLosses: number;
  totalLossAmount: number;
  avgLossPerTrade: number;
  
  // Pattern Analysis
  patterns: LossPattern[];
  
  // Key Findings
  topCauses: string[];
  
  // Recommendations
  parameterChanges: {
    parameter: string;
    currentValue: number | string;
    suggestedValue: number | string;
    expectedImprovement: string;
  }[];
  
  // Strategy Changes
  strategyRecommendations: string[];
  
  // Priority Actions
  priorityActions: {
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    expectedImpact: string;
  }[];
  
  // AI Analysis
  aiAnalysis: string;
  
  // Grade Improvement Estimate
  currentGrade: string;
  projectedGrade: string;
  improvementPath: string;
}

export class LossRootCauseAnalyzer {
  
  /**
   * Analyze backtest results and identify root causes of losses
   */
  async analyze(result: BacktestResult): Promise<RootCauseAnalysis> {
    console.log('\n========================================');
    console.log('LOSS ROOT CAUSE ANALYSIS');
    console.log('========================================');
    
    const losingTrades = result.trades.filter(t => t.pnl < 0);
    
    if (losingTrades.length === 0) {
      console.log('No losing trades to analyze!');
      return this.createEmptyAnalysis(result);
    }
    
    console.log(`Analyzing ${losingTrades.length} losing trades...`);
    
    // Step 1: Statistical Pattern Analysis
    const patterns = this.identifyPatterns(losingTrades);
    
    // Step 2: Get AI Analysis
    const aiAnalysis = await this.getAIAnalysis(result, losingTrades, patterns);
    
    // Step 3: Generate Recommendations
    const recommendations = this.generateRecommendations(patterns, result);
    
    // Step 4: Calculate Priority Actions
    const priorityActions = this.calculatePriorityActions(patterns, result);
    
    const analysis: RootCauseAnalysis = {
      totalLosses: losingTrades.length,
      totalLossAmount: Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0)),
      avgLossPerTrade: Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length),
      
      patterns,
      topCauses: this.extractTopCauses(patterns),
      parameterChanges: recommendations.parameterChanges,
      strategyRecommendations: recommendations.strategyRecommendations,
      priorityActions,
      
      aiAnalysis,
      
      currentGrade: result.grade,
      projectedGrade: this.projectGrade(result, patterns),
      improvementPath: this.generateImprovementPath(result, patterns),
    };
    
    this.printAnalysis(analysis);
    
    return analysis;
  }

  /**
   * Identify patterns in losing trades
   */
  private identifyPatterns(losingTrades: BacktestTrade[]): LossPattern[] {
    const patterns: LossPattern[] = [];
    
    // Pattern 1: Counter-Trend Trades (Against Macro)
    const counterTrendTrades = losingTrades.filter(t => !t.wasAlignedWithMacro);
    if (counterTrendTrades.length > 0) {
      patterns.push({
        name: 'Counter-Trend Trading',
        description: 'Trades taken against the macro trend direction',
        frequency: counterTrendTrades.length / losingTrades.length,
        avgLoss: Math.abs(counterTrendTrades.reduce((sum, t) => sum + t.pnl, 0) / counterTrendTrades.length),
        trades: counterTrendTrades.map(t => t.id),
        suggestedFix: 'Enable MacroVetoEnforcer to block counter-trend trades. This alone would have prevented ' +
                      `${(counterTrendTrades.length / losingTrades.length * 100).toFixed(0)}% of losses.`,
      });
    }
    
    // Pattern 2: Wrong Regime Trades
    const wrongRegimeTrades = losingTrades.filter(t => !t.wasAlignedWithRegime);
    if (wrongRegimeTrades.length > 0) {
      patterns.push({
        name: 'Wrong Regime Trading',
        description: 'Trades taken in unfavorable market regime',
        frequency: wrongRegimeTrades.length / losingTrades.length,
        avgLoss: Math.abs(wrongRegimeTrades.reduce((sum, t) => sum + t.pnl, 0) / wrongRegimeTrades.length),
        trades: wrongRegimeTrades.map(t => t.id),
        suggestedFix: 'Enable RegimeDirectionFilter to only allow longs in uptrend and shorts in downtrend.',
      });
    }
    
    // Pattern 3: Low Consensus Trades
    const lowConsensusTrades = losingTrades.filter(t => t.consensus < 0.70);
    if (lowConsensusTrades.length > 0) {
      patterns.push({
        name: 'Low Consensus Entries',
        description: 'Trades entered with weak agent consensus (<70%)',
        frequency: lowConsensusTrades.length / losingTrades.length,
        avgLoss: Math.abs(lowConsensusTrades.reduce((sum, t) => sum + t.pnl, 0) / lowConsensusTrades.length),
        trades: lowConsensusTrades.map(t => t.id),
        suggestedFix: 'Raise consensus threshold to 70% to filter out weak signals.',
      });
    }
    
    // Pattern 4: Low Confidence Trades
    const lowConfidenceTrades = losingTrades.filter(t => t.confidence < 0.65);
    if (lowConfidenceTrades.length > 0) {
      patterns.push({
        name: 'Low Confidence Entries',
        description: 'Trades entered with low average confidence (<65%)',
        frequency: lowConfidenceTrades.length / losingTrades.length,
        avgLoss: Math.abs(lowConfidenceTrades.reduce((sum, t) => sum + t.pnl, 0) / lowConfidenceTrades.length),
        trades: lowConfidenceTrades.map(t => t.id),
        suggestedFix: 'Raise confidence threshold to 65% to ensure higher quality signals.',
      });
    }
    
    // Pattern 5: Insufficient Agent Agreement
    const lowAgreementTrades = losingTrades.filter(t => t.agentAgreement < 4);
    if (lowAgreementTrades.length > 0) {
      patterns.push({
        name: 'Insufficient Agent Agreement',
        description: 'Trades entered with fewer than 4 agents in agreement',
        frequency: lowAgreementTrades.length / losingTrades.length,
        avgLoss: Math.abs(lowAgreementTrades.reduce((sum, t) => sum + t.pnl, 0) / lowAgreementTrades.length),
        trades: lowAgreementTrades.map(t => t.id),
        suggestedFix: 'Require minimum 4 agents in agreement before entry.',
      });
    }
    
    // Pattern 6: Stop Loss Hit
    const stopLossTrades = losingTrades.filter(t => t.exitReason === 'stop_loss');
    if (stopLossTrades.length > 0) {
      patterns.push({
        name: 'Stop Loss Exits',
        description: 'Trades that hit stop loss',
        frequency: stopLossTrades.length / losingTrades.length,
        avgLoss: Math.abs(stopLossTrades.reduce((sum, t) => sum + t.pnl, 0) / stopLossTrades.length),
        trades: stopLossTrades.map(t => t.id),
        suggestedFix: 'Consider ATR-based dynamic stop losses instead of fixed percentage.',
      });
    }
    
    // Pattern 7: Time Exit Losses
    const timeExitTrades = losingTrades.filter(t => t.exitReason === 'time_exit');
    if (timeExitTrades.length > 0) {
      patterns.push({
        name: 'Time-Based Exit Losses',
        description: 'Trades that were closed due to time limit while in loss',
        frequency: timeExitTrades.length / losingTrades.length,
        avgLoss: Math.abs(timeExitTrades.reduce((sum, t) => sum + t.pnl, 0) / timeExitTrades.length),
        trades: timeExitTrades.map(t => t.id),
        suggestedFix: 'Implement trailing stops to lock in profits before time exit.',
      });
    }
    
    // Sort patterns by frequency
    patterns.sort((a, b) => b.frequency - a.frequency);
    
    return patterns;
  }

  /**
   * Get AI analysis of the losses
   */
  private async getAIAnalysis(
    result: BacktestResult,
    losingTrades: BacktestTrade[],
    patterns: LossPattern[]
  ): Promise<string> {
    try {
      const prompt = `You are an expert quantitative trading analyst. Analyze these backtest results and provide actionable insights.

BACKTEST SUMMARY:
- Total Trades: ${result.totalTrades}
- Win Rate: ${(result.winRate * 100).toFixed(1)}%
- Profit Factor: ${result.profitFactor.toFixed(2)}
- Total P&L: $${result.totalPnL.toFixed(2)}
- Max Drawdown: ${result.maxDrawdownPercent.toFixed(2)}%
- Current Grade: ${result.grade}

LOSING TRADES ANALYSIS:
- Total Losing Trades: ${losingTrades.length}
- Total Loss Amount: $${Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0)).toFixed(2)}
- Average Loss: $${Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length).toFixed(2)}

IDENTIFIED PATTERNS:
${patterns.map(p => `
- ${p.name}: ${(p.frequency * 100).toFixed(0)}% of losses
  Description: ${p.description}
  Average Loss: $${p.avgLoss.toFixed(2)}
  Suggested Fix: ${p.suggestedFix}
`).join('')}

QUALITY GATE STATISTICS:
- Trades Blocked by Macro Veto: ${result.tradesBlockedByMacroVeto}
- Trades Blocked by Regime Filter: ${result.tradesBlockedByRegimeFilter}
- Trades Blocked by Consensus: ${result.tradesBlockedByConsensus}
- Trades Blocked by Confidence: ${result.tradesBlockedByConfidence}
- Trades Blocked by Agent Agreement: ${result.tradesBlockedByAgentAgreement}

Provide a concise analysis (max 500 words) covering:
1. The single most impactful change to improve performance
2. Why the current system is losing money
3. Specific parameter adjustments with expected impact
4. Path to achieving A++ grade (>65% win rate, >2.0 profit factor)

Be specific and quantitative. Focus on actionable improvements.`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are an expert quantitative trading analyst specializing in crypto markets.' },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      return typeof content === 'string' ? content : 'AI analysis unavailable';
    } catch (error) {
      console.error('AI analysis failed:', error);
      return 'AI analysis unavailable due to error';
    }
  }

  /**
   * Generate parameter and strategy recommendations
   */
  private generateRecommendations(patterns: LossPattern[], result: BacktestResult): {
    parameterChanges: RootCauseAnalysis['parameterChanges'];
    strategyRecommendations: string[];
  } {
    const parameterChanges: RootCauseAnalysis['parameterChanges'] = [];
    const strategyRecommendations: string[] = [];
    
    // Based on patterns, suggest parameter changes
    const counterTrendPattern = patterns.find(p => p.name === 'Counter-Trend Trading');
    if (counterTrendPattern && counterTrendPattern.frequency > 0.3) {
      parameterChanges.push({
        parameter: 'enableMacroVeto',
        currentValue: 'false',
        suggestedValue: 'true',
        expectedImprovement: `Prevent ${(counterTrendPattern.frequency * 100).toFixed(0)}% of losses`,
      });
    }
    
    const lowConsensusPattern = patterns.find(p => p.name === 'Low Consensus Entries');
    if (lowConsensusPattern && lowConsensusPattern.frequency > 0.2) {
      parameterChanges.push({
        parameter: 'consensusThreshold',
        currentValue: '60%',
        suggestedValue: '70%',
        expectedImprovement: `Filter out ${(lowConsensusPattern.frequency * 100).toFixed(0)}% of weak signals`,
      });
    }
    
    const lowConfidencePattern = patterns.find(p => p.name === 'Low Confidence Entries');
    if (lowConfidencePattern && lowConfidencePattern.frequency > 0.2) {
      parameterChanges.push({
        parameter: 'confidenceThreshold',
        currentValue: '40%',
        suggestedValue: '65%',
        expectedImprovement: `Improve signal quality by filtering ${(lowConfidencePattern.frequency * 100).toFixed(0)}% of low-confidence trades`,
      });
    }
    
    const lowAgreementPattern = patterns.find(p => p.name === 'Insufficient Agent Agreement');
    if (lowAgreementPattern && lowAgreementPattern.frequency > 0.2) {
      parameterChanges.push({
        parameter: 'minAgentAgreement',
        currentValue: '2',
        suggestedValue: '4',
        expectedImprovement: `Require stronger consensus, filtering ${(lowAgreementPattern.frequency * 100).toFixed(0)}% of weak signals`,
      });
    }
    
    // Strategy recommendations
    if (result.winRate < 0.50) {
      strategyRecommendations.push('Focus on quality over quantity - take fewer, higher-conviction trades');
    }
    
    if (result.profitFactor < 1.0) {
      strategyRecommendations.push('Implement stricter entry criteria to improve profit factor');
    }
    
    if (result.maxDrawdownPercent > 20) {
      strategyRecommendations.push('Reduce position sizes and implement portfolio-level risk limits');
    }
    
    strategyRecommendations.push('Enable all A++ grade filters: MacroVeto, RegimeFilter, SignalQualityGate');
    strategyRecommendations.push('Run continuous backtests after each parameter change to validate improvements');
    
    return { parameterChanges, strategyRecommendations };
  }

  /**
   * Calculate priority actions
   */
  private calculatePriorityActions(patterns: LossPattern[], result: BacktestResult): RootCauseAnalysis['priorityActions'] {
    const actions: RootCauseAnalysis['priorityActions'] = [];
    
    // Critical: Counter-trend trading (93% of losses in audit)
    const counterTrendPattern = patterns.find(p => p.name === 'Counter-Trend Trading');
    if (counterTrendPattern && counterTrendPattern.frequency > 0.5) {
      actions.push({
        priority: 'critical',
        action: 'Enable MacroVetoEnforcer immediately',
        expectedImpact: `Prevent ${(counterTrendPattern.frequency * 100).toFixed(0)}% of losses`,
      });
    }
    
    // High: Regime filter
    const wrongRegimePattern = patterns.find(p => p.name === 'Wrong Regime Trading');
    if (wrongRegimePattern && wrongRegimePattern.frequency > 0.3) {
      actions.push({
        priority: 'high',
        action: 'Enable RegimeDirectionFilter',
        expectedImpact: `Prevent ${(wrongRegimePattern.frequency * 100).toFixed(0)}% of regime-misaligned losses`,
      });
    }
    
    // High: Consensus threshold
    const lowConsensusPattern = patterns.find(p => p.name === 'Low Consensus Entries');
    if (lowConsensusPattern && lowConsensusPattern.frequency > 0.3) {
      actions.push({
        priority: 'high',
        action: 'Raise consensus threshold to 70%',
        expectedImpact: 'Filter weak signals, improve win rate',
      });
    }
    
    // Medium: Confidence threshold
    const lowConfidencePattern = patterns.find(p => p.name === 'Low Confidence Entries');
    if (lowConfidencePattern && lowConfidencePattern.frequency > 0.2) {
      actions.push({
        priority: 'medium',
        action: 'Raise confidence threshold to 65%',
        expectedImpact: 'Improve signal quality',
      });
    }
    
    // Medium: Agent agreement
    const lowAgreementPattern = patterns.find(p => p.name === 'Insufficient Agent Agreement');
    if (lowAgreementPattern && lowAgreementPattern.frequency > 0.2) {
      actions.push({
        priority: 'medium',
        action: 'Require minimum 4 agents in agreement',
        expectedImpact: 'Ensure stronger consensus before entry',
      });
    }
    
    // Low: Stop loss optimization
    const stopLossPattern = patterns.find(p => p.name === 'Stop Loss Exits');
    if (stopLossPattern && stopLossPattern.frequency > 0.4) {
      actions.push({
        priority: 'low',
        action: 'Implement ATR-based dynamic stop losses',
        expectedImpact: 'Reduce premature stop-outs in volatile markets',
      });
    }
    
    return actions;
  }

  /**
   * Extract top causes from patterns
   */
  private extractTopCauses(patterns: LossPattern[]): string[] {
    return patterns
      .slice(0, 3)
      .map(p => `${p.name} (${(p.frequency * 100).toFixed(0)}% of losses)`);
  }

  /**
   * Project grade after implementing fixes
   */
  private projectGrade(result: BacktestResult, patterns: LossPattern[]): string {
    // Estimate improvement from fixing top patterns
    const counterTrendPattern = patterns.find(p => p.name === 'Counter-Trend Trading');
    const potentialWinRateImprovement = counterTrendPattern 
      ? counterTrendPattern.frequency * 0.5 // Assume fixing this improves win rate by half the pattern frequency
      : 0;
    
    const projectedWinRate = result.winRate + potentialWinRateImprovement;
    const projectedProfitFactor = result.profitFactor * (1 + potentialWinRateImprovement);
    
    if (projectedWinRate >= 0.65 && projectedProfitFactor >= 2.0) return 'A++';
    if (projectedWinRate >= 0.60 && projectedProfitFactor >= 1.5) return 'A+';
    if (projectedWinRate >= 0.55 && projectedProfitFactor >= 1.2) return 'A';
    if (projectedWinRate >= 0.50 && projectedProfitFactor >= 1.0) return 'B';
    return 'C';
  }

  /**
   * Generate improvement path
   */
  private generateImprovementPath(result: BacktestResult, patterns: LossPattern[]): string {
    const steps: string[] = [];
    
    if (result.grade === 'F' || result.grade === 'D') {
      steps.push('1. Enable MacroVetoEnforcer to prevent counter-trend trades');
      steps.push('2. Enable RegimeDirectionFilter for trend alignment');
      steps.push('3. Raise consensus threshold to 70%');
      steps.push('4. Raise confidence threshold to 65%');
      steps.push('5. Require 4 agents in agreement');
      steps.push('6. Run backtest to validate improvements');
      steps.push('7. Iterate until A++ grade achieved');
    } else if (result.grade === 'C' || result.grade === 'B') {
      steps.push('1. Fine-tune consensus threshold (try 75%)');
      steps.push('2. Optimize stop-loss with ATR-based calculation');
      steps.push('3. Add trailing stops for profit protection');
      steps.push('4. Run backtest to validate');
    } else {
      steps.push('1. Maintain current parameters');
      steps.push('2. Monitor for regime changes');
      steps.push('3. Continuous optimization through backtesting');
    }
    
    return steps.join('\n');
  }

  /**
   * Create empty analysis when no losses
   */
  private createEmptyAnalysis(result: BacktestResult): RootCauseAnalysis {
    return {
      totalLosses: 0,
      totalLossAmount: 0,
      avgLossPerTrade: 0,
      patterns: [],
      topCauses: [],
      parameterChanges: [],
      strategyRecommendations: ['Maintain current strategy - no losses to analyze'],
      priorityActions: [],
      aiAnalysis: 'No losing trades to analyze. Current strategy is performing well.',
      currentGrade: result.grade,
      projectedGrade: result.grade,
      improvementPath: 'Continue monitoring and maintain current parameters.',
    };
  }

  /**
   * Print analysis report
   */
  private printAnalysis(analysis: RootCauseAnalysis): void {
    console.log('\n========================================');
    console.log('ROOT CAUSE ANALYSIS REPORT');
    console.log('========================================');
    console.log(`Total Losses: ${analysis.totalLosses}`);
    console.log(`Total Loss Amount: $${analysis.totalLossAmount.toFixed(2)}`);
    console.log(`Average Loss: $${analysis.avgLossPerTrade.toFixed(2)}`);
    console.log('');
    console.log('TOP CAUSES:');
    analysis.topCauses.forEach((cause, i) => {
      console.log(`  ${i + 1}. ${cause}`);
    });
    console.log('');
    console.log('PRIORITY ACTIONS:');
    analysis.priorityActions.forEach(action => {
      console.log(`  [${action.priority.toUpperCase()}] ${action.action}`);
      console.log(`    Expected Impact: ${action.expectedImpact}`);
    });
    console.log('');
    console.log('PARAMETER CHANGES:');
    analysis.parameterChanges.forEach(change => {
      console.log(`  ${change.parameter}: ${change.currentValue} → ${change.suggestedValue}`);
      console.log(`    Expected: ${change.expectedImprovement}`);
    });
    console.log('');
    console.log(`Current Grade: ${analysis.currentGrade}`);
    console.log(`Projected Grade: ${analysis.projectedGrade}`);
    console.log('');
    console.log('IMPROVEMENT PATH:');
    console.log(analysis.improvementPath);
    console.log('========================================\n');
  }
}

// Export singleton
export const lossRootCauseAnalyzer = new LossRootCauseAnalyzer();
