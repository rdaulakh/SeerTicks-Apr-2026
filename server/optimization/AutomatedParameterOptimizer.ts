/**
 * Automated Parameter Optimizer
 * 
 * Implements the continuous improvement cycle:
 * 1. Run backtest with current parameters
 * 2. Analyze losses and identify root causes
 * 3. Generate parameter adjustments
 * 4. Run backtest with new parameters
 * 5. Compare results and keep improvements
 * 6. Repeat until A++ grade achieved
 * 
 * This is the core of the "backtest → fix → retest" loop.
 */

import { EventEmitter } from 'events';
import { APlusPlusBacktestEngine, BacktestConfig, BacktestResult } from '../backtest/APlusPlusBacktestEngine';
import { LossRootCauseAnalyzer, RootCauseAnalysis } from '../analysis/LossRootCauseAnalyzer';

export interface OptimizationConfig {
  // Target metrics
  targetWinRate: number;           // 65% for A++
  targetProfitFactor: number;      // 2.0 for A++
  targetSharpeRatio: number;       // 1.5 for A++
  targetMaxDrawdown: number;       // 10% for A++
  
  // Optimization bounds
  consensusThresholdRange: [number, number];    // [0.50, 0.90]
  confidenceThresholdRange: [number, number];   // [0.40, 0.80]
  minAgentAgreementRange: [number, number];     // [2, 6]
  
  // Iteration limits
  maxIterations: number;
  improvementThreshold: number;    // Minimum improvement to continue
  
  // Backtest config
  backtestConfig: Partial<BacktestConfig>;
}

export interface OptimizationIteration {
  iteration: number;
  parameters: {
    consensusThreshold: number;
    confidenceThreshold: number;
    minAgentAgreement: number;
    enableMacroVeto: boolean;
    enableRegimeFilter: boolean;
  };
  result: BacktestResult;
  analysis: RootCauseAnalysis;
  improvement: number;
  grade: string;
}

export interface OptimizationResult {
  success: boolean;
  finalGrade: string;
  iterations: OptimizationIteration[];
  bestIteration: OptimizationIteration;
  totalImprovement: number;
  optimizedParameters: OptimizationIteration['parameters'];
  summary: string;
}

export class AutomatedParameterOptimizer extends EventEmitter {
  private config: OptimizationConfig;
  private analyzer = new LossRootCauseAnalyzer();
  private iterations: OptimizationIteration[] = [];
  private bestIteration: OptimizationIteration | null = null;

  constructor(config?: Partial<OptimizationConfig>) {
    super();
    
    // A++ Grade Target Configuration
    this.config = {
      targetWinRate: 0.65,
      targetProfitFactor: 2.0,
      targetSharpeRatio: 1.5,
      targetMaxDrawdown: 0.10,
      
      consensusThresholdRange: [0.50, 0.90],
      confidenceThresholdRange: [0.40, 0.80],
      minAgentAgreementRange: [2, 6],
      
      maxIterations: 10,
      improvementThreshold: 0.01,
      
      backtestConfig: {},
      
      ...config,
    };
  }

  /**
   * Run the optimization loop
   */
  async optimize(): Promise<OptimizationResult> {
    console.log('\n========================================');
    console.log('AUTOMATED PARAMETER OPTIMIZATION');
    console.log('========================================');
    console.log('Target Metrics:');
    console.log(`  Win Rate: ${(this.config.targetWinRate * 100).toFixed(0)}%`);
    console.log(`  Profit Factor: ${this.config.targetProfitFactor.toFixed(1)}`);
    console.log(`  Sharpe Ratio: ${this.config.targetSharpeRatio.toFixed(1)}`);
    console.log(`  Max Drawdown: ${(this.config.targetMaxDrawdown * 100).toFixed(0)}%`);
    console.log(`  Max Iterations: ${this.config.maxIterations}`);
    console.log('========================================\n');

    this.iterations = [];
    this.bestIteration = null;

    // Start with A++ grade default parameters
    let currentParams = {
      consensusThreshold: 0.70,
      confidenceThreshold: 0.65,
      minAgentAgreement: 4,
      enableMacroVeto: true,
      enableRegimeFilter: true,
    };

    for (let i = 1; i <= this.config.maxIterations; i++) {
      console.log(`\n--- ITERATION ${i}/${this.config.maxIterations} ---`);
      
      // Run backtest with current parameters
      const backtestEngine = new APlusPlusBacktestEngine({
        ...this.config.backtestConfig,
        consensusThreshold: currentParams.consensusThreshold,
        confidenceThreshold: currentParams.confidenceThreshold,
        minAgentAgreement: currentParams.minAgentAgreement,
        enableMacroVeto: currentParams.enableMacroVeto,
        enableRegimeFilter: currentParams.enableRegimeFilter,
      });

      const result = await backtestEngine.run();
      
      // Analyze losses
      const analysis = await this.analyzer.analyze(result);
      
      // Calculate improvement from previous iteration
      const improvement = this.calculateImprovement(result);
      
      // Store iteration
      const iteration: OptimizationIteration = {
        iteration: i,
        parameters: { ...currentParams },
        result,
        analysis,
        improvement,
        grade: result.grade,
      };
      
      this.iterations.push(iteration);
      
      // Update best iteration
      if (!this.bestIteration || this.isBetter(result, this.bestIteration.result)) {
        this.bestIteration = iteration;
        console.log(`\n✅ NEW BEST: Grade ${result.grade}, Win Rate ${(result.winRate * 100).toFixed(1)}%`);
      }
      
      // Emit progress
      this.emit('iteration_complete', iteration);
      
      // Check if we've reached A++ grade
      if (this.isTargetReached(result)) {
        console.log(`\n🎉 TARGET REACHED! Grade ${result.grade}`);
        break;
      }
      
      // Check if improvement is too small
      if (i > 1 && improvement < this.config.improvementThreshold) {
        console.log(`\n⚠️ Improvement below threshold (${(improvement * 100).toFixed(2)}% < ${(this.config.improvementThreshold * 100).toFixed(0)}%)`);
        // Continue anyway - might find better parameters
      }
      
      // Generate new parameters based on analysis
      currentParams = this.generateNewParameters(currentParams, analysis);
      
      console.log(`\nNext iteration parameters:`);
      console.log(`  Consensus: ${(currentParams.consensusThreshold * 100).toFixed(0)}%`);
      console.log(`  Confidence: ${(currentParams.confidenceThreshold * 100).toFixed(0)}%`);
      console.log(`  Min Agents: ${currentParams.minAgentAgreement}`);
      console.log(`  Macro Veto: ${currentParams.enableMacroVeto}`);
      console.log(`  Regime Filter: ${currentParams.enableRegimeFilter}`);
    }

    // Generate final result
    const finalResult = this.generateFinalResult();
    
    this.printFinalReport(finalResult);
    
    return finalResult;
  }

  /**
   * Calculate improvement from previous iteration
   */
  private calculateImprovement(result: BacktestResult): number {
    if (this.iterations.length === 0) {
      return 0;
    }
    
    const previousResult = this.iterations[this.iterations.length - 1].result;
    
    // Weighted improvement score
    const winRateImprovement = (result.winRate - previousResult.winRate) / previousResult.winRate;
    const profitFactorImprovement = (result.profitFactor - previousResult.profitFactor) / Math.max(previousResult.profitFactor, 0.01);
    const drawdownImprovement = (previousResult.maxDrawdownPercent - result.maxDrawdownPercent) / Math.max(previousResult.maxDrawdownPercent, 0.01);
    
    return (winRateImprovement * 0.4 + profitFactorImprovement * 0.4 + drawdownImprovement * 0.2);
  }

  /**
   * Check if one result is better than another
   */
  private isBetter(result: BacktestResult, previous: BacktestResult): boolean {
    // Grade-based comparison first
    const gradeOrder = ['F', 'D', 'C', 'B', 'A', 'A+', 'A++'];
    const resultGradeIndex = gradeOrder.indexOf(result.grade);
    const previousGradeIndex = gradeOrder.indexOf(previous.grade);
    
    if (resultGradeIndex > previousGradeIndex) return true;
    if (resultGradeIndex < previousGradeIndex) return false;
    
    // Same grade - compare metrics
    const resultScore = result.winRate * 0.3 + result.profitFactor * 0.3 + 
                        result.sharpeRatio * 0.2 + (1 - result.maxDrawdownPercent / 100) * 0.2;
    const previousScore = previous.winRate * 0.3 + previous.profitFactor * 0.3 + 
                          previous.sharpeRatio * 0.2 + (1 - previous.maxDrawdownPercent / 100) * 0.2;
    
    return resultScore > previousScore;
  }

  /**
   * Check if target metrics are reached
   */
  private isTargetReached(result: BacktestResult): boolean {
    return (
      result.winRate >= this.config.targetWinRate &&
      result.profitFactor >= this.config.targetProfitFactor &&
      result.sharpeRatio >= this.config.targetSharpeRatio &&
      result.maxDrawdownPercent / 100 <= this.config.targetMaxDrawdown
    );
  }

  /**
   * Generate new parameters based on analysis
   */
  private generateNewParameters(
    currentParams: OptimizationIteration['parameters'],
    analysis: RootCauseAnalysis
  ): OptimizationIteration['parameters'] {
    const newParams = { ...currentParams };
    
    // Apply parameter changes from analysis
    for (const change of analysis.parameterChanges) {
      switch (change.parameter) {
        case 'consensusThreshold':
          const suggestedConsensus = parseFloat(String(change.suggestedValue).replace('%', '')) / 100;
          newParams.consensusThreshold = this.clamp(
            suggestedConsensus,
            this.config.consensusThresholdRange[0],
            this.config.consensusThresholdRange[1]
          );
          break;
          
        case 'confidenceThreshold':
          const suggestedConfidence = parseFloat(String(change.suggestedValue).replace('%', '')) / 100;
          newParams.confidenceThreshold = this.clamp(
            suggestedConfidence,
            this.config.confidenceThresholdRange[0],
            this.config.confidenceThresholdRange[1]
          );
          break;
          
        case 'minAgentAgreement':
          newParams.minAgentAgreement = this.clamp(
            parseInt(String(change.suggestedValue)),
            this.config.minAgentAgreementRange[0],
            this.config.minAgentAgreementRange[1]
          );
          break;
          
        case 'enableMacroVeto':
          newParams.enableMacroVeto = String(change.suggestedValue) === 'true';
          break;
          
        case 'enableRegimeFilter':
          newParams.enableRegimeFilter = String(change.suggestedValue) === 'true';
          break;
      }
    }
    
    // If no specific changes, try incremental improvements
    if (analysis.parameterChanges.length === 0) {
      // Slightly increase thresholds if win rate is low
      if (analysis.currentGrade === 'F' || analysis.currentGrade === 'D') {
        newParams.consensusThreshold = Math.min(
          newParams.consensusThreshold + 0.05,
          this.config.consensusThresholdRange[1]
        );
        newParams.confidenceThreshold = Math.min(
          newParams.confidenceThreshold + 0.05,
          this.config.confidenceThresholdRange[1]
        );
      }
    }
    
    return newParams;
  }

  /**
   * Clamp value to range
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Generate final optimization result
   */
  private generateFinalResult(): OptimizationResult {
    const firstIteration = this.iterations[0];
    const lastIteration = this.iterations[this.iterations.length - 1];
    
    const totalImprovement = firstIteration && lastIteration
      ? (lastIteration.result.winRate - firstIteration.result.winRate) / Math.max(firstIteration.result.winRate, 0.01)
      : 0;
    
    const success = this.bestIteration 
      ? this.isTargetReached(this.bestIteration.result)
      : false;
    
    return {
      success,
      finalGrade: this.bestIteration?.grade || 'F',
      iterations: this.iterations,
      bestIteration: this.bestIteration!,
      totalImprovement,
      optimizedParameters: this.bestIteration?.parameters || {
        consensusThreshold: 0.70,
        confidenceThreshold: 0.65,
        minAgentAgreement: 4,
        enableMacroVeto: true,
        enableRegimeFilter: true,
      },
      summary: this.generateSummary(),
    };
  }

  /**
   * Generate summary text
   */
  private generateSummary(): string {
    if (!this.bestIteration) {
      return 'Optimization failed - no valid iterations completed.';
    }
    
    const best = this.bestIteration;
    const first = this.iterations[0];
    
    const lines = [
      `Optimization completed after ${this.iterations.length} iterations.`,
      '',
      `Starting Grade: ${first.grade}`,
      `Final Grade: ${best.grade}`,
      '',
      `Starting Win Rate: ${(first.result.winRate * 100).toFixed(1)}%`,
      `Final Win Rate: ${(best.result.winRate * 100).toFixed(1)}%`,
      '',
      `Starting Profit Factor: ${first.result.profitFactor.toFixed(2)}`,
      `Final Profit Factor: ${best.result.profitFactor.toFixed(2)}`,
      '',
      'Optimized Parameters:',
      `  Consensus Threshold: ${(best.parameters.consensusThreshold * 100).toFixed(0)}%`,
      `  Confidence Threshold: ${(best.parameters.confidenceThreshold * 100).toFixed(0)}%`,
      `  Min Agent Agreement: ${best.parameters.minAgentAgreement}`,
      `  Macro Veto: ${best.parameters.enableMacroVeto ? 'ENABLED' : 'DISABLED'}`,
      `  Regime Filter: ${best.parameters.enableRegimeFilter ? 'ENABLED' : 'DISABLED'}`,
    ];
    
    if (this.isTargetReached(best.result)) {
      lines.push('', '🎉 A++ GRADE TARGET ACHIEVED!');
    } else {
      lines.push('', '⚠️ Target not reached. Consider:');
      lines.push('  - Extending backtest period');
      lines.push('  - Adding more data sources');
      lines.push('  - Fine-tuning agent weights');
    }
    
    return lines.join('\n');
  }

  /**
   * Print final report
   */
  private printFinalReport(result: OptimizationResult): void {
    console.log('\n========================================');
    console.log('OPTIMIZATION COMPLETE');
    console.log('========================================');
    console.log(result.summary);
    console.log('========================================\n');
  }
}

// Export convenience function
export async function runParameterOptimization(
  config?: Partial<OptimizationConfig>
): Promise<OptimizationResult> {
  const optimizer = new AutomatedParameterOptimizer(config);
  return optimizer.optimize();
}
