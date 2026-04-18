/**
 * StrategyCompetenceTracker - Measures and tracks strategy competence scores
 * Target: +13 points improvement for Phase 3
 */
import { EventEmitter } from 'events';

export interface StrategyScore { strategyName: string; category: 'orderflow' | 'smartmoney' | 'statistical' | 'grid'; accuracy: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number; winRate: number; avgWin: number; avgLoss: number; totalTrades: number; score: number; lastUpdate: number; }
export interface CompetenceReport { timestamp: number; overallScore: number; targetScore: number; improvement: number; categoryScores: { category: string; score: number; weight: number }[]; strategyScores: StrategyScore[]; recommendations: string[]; }
export interface CompetenceConfig { baselineScore: number; targetImprovement: number; weights: { accuracy: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number; winRate: number }; }

export class StrategyCompetenceTracker extends EventEmitter {
  private config: CompetenceConfig;
  private strategyScores: Map<string, StrategyScore> = new Map();
  private tradeHistory: Map<string, { profit: number; timestamp: number }[]> = new Map();
  private baselineScore: number;
  
  constructor(config?: Partial<CompetenceConfig>) {
    super();
    this.config = { baselineScore: 50, targetImprovement: 13, weights: { accuracy: 0.2, profitFactor: 0.25, sharpeRatio: 0.2, maxDrawdown: 0.15, winRate: 0.2 }, ...config };
    this.baselineScore = this.config.baselineScore;
  }
  
  recordTrade(strategyName: string, category: 'orderflow' | 'smartmoney' | 'statistical' | 'grid', result: { profit: number; prediction: 'bullish' | 'bearish' | 'neutral'; actual: 'bullish' | 'bearish' | 'neutral' }): void {
    const history = this.tradeHistory.get(strategyName) || [];
    history.push({ profit: result.profit, timestamp: Date.now() });
    if (history.length > 1000) history.shift();
    this.tradeHistory.set(strategyName, history);
    this.updateStrategyScore(strategyName, category);
  }
  
  private updateStrategyScore(strategyName: string, category: 'orderflow' | 'smartmoney' | 'statistical' | 'grid'): void {
    const history = this.tradeHistory.get(strategyName) || [];
    if (history.length < 5) return;
    const profits = history.map(h => h.profit);
    const wins = profits.filter(p => p > 0), losses = profits.filter(p => p < 0);
    const winRate = wins.length / profits.length * 100;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 10 : 1;
    const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
    const std = Math.sqrt(profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length);
    const sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    let peak = 0, maxDrawdown = 0, cumulative = 0;
    for (const profit of profits) { cumulative += profit; if (cumulative > peak) peak = cumulative; const drawdown = peak > 0 ? (peak - cumulative) / peak * 100 : 0; if (drawdown > maxDrawdown) maxDrawdown = drawdown; }
    const accuracy = winRate;
    const score = this.calculateScore({ accuracy, profitFactor, sharpeRatio, maxDrawdown, winRate });
    const strategyScore: StrategyScore = { strategyName, category, accuracy, profitFactor, sharpeRatio, maxDrawdown, winRate, avgWin, avgLoss, totalTrades: profits.length, score, lastUpdate: Date.now() };
    this.strategyScores.set(strategyName, strategyScore);
    this.emit('scoreUpdated', strategyScore);
  }
  
  private calculateScore(metrics: { accuracy: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number; winRate: number }): number {
    const w = this.config.weights;
    const normalizedAccuracy = Math.min(100, metrics.accuracy);
    const normalizedPF = Math.min(100, metrics.profitFactor * 20);
    const normalizedSharpe = Math.min(100, (metrics.sharpeRatio + 2) * 25);
    const normalizedDD = Math.max(0, 100 - metrics.maxDrawdown * 2);
    const normalizedWR = Math.min(100, metrics.winRate);
    return (normalizedAccuracy * w.accuracy + normalizedPF * w.profitFactor + normalizedSharpe * w.sharpeRatio + normalizedDD * w.maxDrawdown + normalizedWR * w.winRate);
  }
  
  generateReport(): CompetenceReport {
    const strategies = Array.from(this.strategyScores.values());
    const categories = ['orderflow', 'smartmoney', 'statistical', 'grid'] as const;
    const categoryScores = categories.map(cat => { const catStrategies = strategies.filter(s => s.category === cat); const avgScore = catStrategies.length > 0 ? catStrategies.reduce((sum, s) => sum + s.score, 0) / catStrategies.length : 0; return { category: cat, score: avgScore, weight: 0.25 }; });
    const overallScore = categoryScores.reduce((sum, c) => sum + c.score * c.weight, 0);
    const improvement = overallScore - this.baselineScore;
    const recommendations: string[] = [];
    if (improvement < this.config.targetImprovement) {
      recommendations.push(`Need ${(this.config.targetImprovement - improvement).toFixed(1)} more points to reach target`);
      const weakestCategory = categoryScores.reduce((min, c) => c.score < min.score ? c : min);
      recommendations.push(`Focus on ${weakestCategory.category} strategies (score: ${weakestCategory.score.toFixed(1)})`);
    } else { recommendations.push('Target improvement achieved!'); }
    return { timestamp: Date.now(), overallScore, targetScore: this.baselineScore + this.config.targetImprovement, improvement, categoryScores, strategyScores: strategies, recommendations };
  }
  
  getStrategyScore(strategyName: string): StrategyScore | undefined { return this.strategyScores.get(strategyName); }
  getAllScores(): StrategyScore[] { return Array.from(this.strategyScores.values()); }
  getOverallScore(): number { return this.generateReport().overallScore; }
  getImprovement(): number { return this.generateReport().improvement; }
  setBaseline(score: number): void { this.baselineScore = score; }
  reset(): void { this.strategyScores.clear(); this.tradeHistory.clear(); }
}

let instance: StrategyCompetenceTracker | null = null;
export function getStrategyCompetenceTracker(config?: Partial<CompetenceConfig>): StrategyCompetenceTracker { if (!instance) instance = new StrategyCompetenceTracker(config); return instance; }
export function resetStrategyCompetenceTracker(): void { instance = null; }
