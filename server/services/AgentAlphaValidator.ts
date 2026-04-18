/**
 * Phase 16: AgentAlphaValidator — Statistical Alpha Validation for Each Agent
 *
 * Purpose: Answer the fundamental question "Does this agent have predictive power?"
 *
 * Queries historical trades (which store agentSignals JSON snapshots at entry)
 * and computes per-agent statistical metrics:
 *   - Win rate per agent (when signal agreed with trade direction)
 *   - Sharpe ratio per agent
 *   - Information coefficient (IC) — correlation between confidence and P&L
 *   - Statistical significance (p-value via binomial test vs 50% null)
 *   - Value added: agent P&L contribution vs random baseline
 *
 * Agents below the alpha threshold get flagged for pruning.
 * Results feed into AdaptiveConsensusEngine for live weight updates.
 *
 * This runs as a scheduled job (every 6 hours) and on-demand.
 */

import { EventEmitter } from 'events';

export interface AgentTradeRecord {
  tradeId: number;
  agentName: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  tradeSide: 'long' | 'short';
  pnlAfterCosts: number;
  pnlPercent: number;
  symbol: string;
  entryTime: Date;
  exitTime: Date;
  exitReason: string;
}

export interface AgentAlphaReport {
  agentName: string;

  // Core metrics
  totalTrades: number;            // Number of trades this agent participated in
  directionalAccuracy: number;    // Win rate when agent's direction matched trade direction
  avgPnlWhenAgreed: number;       // Average P&L when trade followed agent's signal
  avgPnlWhenDisagreed: number;    // Average P&L when trade went against agent's signal
  valueAdded: number;             // avgPnlWhenAgreed - avgPnlWhenDisagreed

  // Risk-adjusted metrics
  sharpeRatio: number;            // (mean return - risk_free) / std dev of returns
  sortinoRatio: number;           // Uses only downside deviation
  profitFactor: number;           // Gross wins / gross losses

  // Confidence calibration
  informationCoefficient: number; // Correlation(confidence, pnl) — measures signal quality
  brierScore: number;             // Calibration: confidence vs outcome
  avgConfidence: number;          // Mean confidence when signaling

  // Statistical significance
  pValue: number;                 // p-value vs 50% null hypothesis (binomial test)
  isSignificant: boolean;         // pValue < 0.05

  // Alpha classification
  hasAlpha: boolean;              // Combined: significant AND profitable
  alphaGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  recommendation: 'boost' | 'keep' | 'reduce' | 'prune';

  // Rolling metrics (last 50 trades)
  rollingWinRate: number;
  rollingSharpe: number;

  // Computed at validation time
  validatedAt: number;
}

export interface AlphaValidationResult {
  timestamp: number;
  totalTradesAnalyzed: number;
  agentReports: AgentAlphaReport[];

  // Summary
  agentsWithAlpha: string[];
  agentsToPrune: string[];
  agentsToBoost: string[];

  // System-level
  systemWinRate: number;
  systemSharpe: number;
  systemProfitFactor: number;
}

class AgentAlphaValidator extends EventEmitter {
  private isRunning: boolean = false;
  private lastValidation: AlphaValidationResult | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  private readonly CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  private readonly MIN_TRADES_FOR_SIGNIFICANCE = 30; // Need 30+ trades per agent
  private readonly SIGNIFICANCE_LEVEL = 0.05; // 95% confidence
  private readonly RISK_FREE_RATE = 0; // 0% for crypto

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[AgentAlphaValidator] Starting alpha validation service...');
    this.isRunning = true;

    // Initial validation
    try {
      await this.runValidation();
    } catch (err) {
      console.error('[AgentAlphaValidator] Initial validation failed:', (err as Error)?.message);
    }

    // Periodic validation
    this.checkInterval = setInterval(() => {
      this.runValidation().catch(err => {
        console.error('[AgentAlphaValidator] Periodic validation failed:', (err as Error)?.message);
      });
    }, this.CHECK_INTERVAL_MS);

    if (this.checkInterval.unref) {
      this.checkInterval.unref();
    }

    console.log('[AgentAlphaValidator] ✅ Started (validates every 6 hours)');
  }

  stop(): void {
    if (!this.isRunning) return;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[AgentAlphaValidator] Stopped');
  }

  getLastValidation(): AlphaValidationResult | null {
    return this.lastValidation;
  }

  /**
   * Run full alpha validation against historical trades
   */
  async runValidation(): Promise<AlphaValidationResult> {
    console.log('[AgentAlphaValidator] Running alpha validation...');

    // Step 1: Load all closed trades with agentSignals snapshots
    const tradeRecords = await this.loadTradeRecords();

    if (tradeRecords.length === 0) {
      console.log('[AgentAlphaValidator] No trade records found');
      const emptyResult: AlphaValidationResult = {
        timestamp: Date.now(),
        totalTradesAnalyzed: 0,
        agentReports: [],
        agentsWithAlpha: [],
        agentsToPrune: [],
        agentsToBoost: [],
        systemWinRate: 0,
        systemSharpe: 0,
        systemProfitFactor: 0,
      };
      this.lastValidation = emptyResult;
      return emptyResult;
    }

    // Step 2: Extract per-agent trade records
    const agentRecords = this.extractAgentRecords(tradeRecords);

    // Step 3: Compute alpha metrics for each agent
    const agentReports: AgentAlphaReport[] = [];
    for (const [agentName, records] of agentRecords.entries()) {
      const report = this.computeAgentAlpha(agentName, records);
      agentReports.push(report);
    }

    // Step 4: Sort by value added (best agents first)
    agentReports.sort((a, b) => b.valueAdded - a.valueAdded);

    // Step 5: Compute system-level metrics
    const allPnls = tradeRecords.map(t => t.pnlAfterCosts);
    const systemWinRate = allPnls.filter(p => p > 0).length / allPnls.length;
    const systemSharpe = this.computeSharpe(allPnls);
    const grossWins = allPnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const grossLosses = Math.abs(allPnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
    const systemProfitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const result: AlphaValidationResult = {
      timestamp: Date.now(),
      totalTradesAnalyzed: tradeRecords.length,
      agentReports,
      agentsWithAlpha: agentReports.filter(r => r.hasAlpha).map(r => r.agentName),
      agentsToPrune: agentReports.filter(r => r.recommendation === 'prune').map(r => r.agentName),
      agentsToBoost: agentReports.filter(r => r.recommendation === 'boost').map(r => r.agentName),
      systemWinRate,
      systemSharpe,
      systemProfitFactor,
    };

    this.lastValidation = result;

    // Emit for downstream consumers
    this.emit('validation_complete', result);

    // Log summary
    this.logSummary(result);

    // Persist to DB
    await this.persistResult(result);

    return result;
  }

  /**
   * Load closed trades with agentSignals JSON from database
   */
  private async loadTradeRecords(): Promise<Array<{
    id: number;
    side: 'long' | 'short';
    pnlAfterCosts: number;
    pnlPercent: number;
    symbol: string;
    entryTime: Date;
    exitTime: Date;
    exitReason: string;
    agentSignals: any;
  }>> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return [];

      // Phase 22 fix: Try trades table first (StrategyOrchestrator path writes here
      // with agentSignals). Also try trade_decision_log (Phase 22 audit logging)
      // which captures agentSignals for ALL trade decisions including the main
      // engine path (EnhancedTradeExecutor → PaperTradingEngine).
      // Note: paperTrades table doesn't have agentSignals column, so it can't
      // be used for per-agent alpha validation.
      const { trades } = await import('../../drizzle/schema');
      const { eq, isNotNull, and } = await import('drizzle-orm');

      const rows = await db
        .select({
          id: trades.id,
          side: trades.side,
          pnl: trades.pnl,
          pnlAfterCosts: trades.pnlAfterCosts,
          entryPrice: trades.entryPrice,
          exitPrice: trades.exitPrice,
          symbol: trades.symbol,
          entryTime: trades.entryTime,
          exitTime: trades.exitTime,
          exitReason: trades.exitReason,
          agentSignals: trades.agentSignals,
        })
        .from(trades)
        .where(
          and(
            eq(trades.status, 'closed'),
            isNotNull(trades.agentSignals),
            isNotNull(trades.pnlAfterCosts)
          )
        )
        .orderBy(trades.entryTime);

      if (rows.length === 0) {
        console.log('[AgentAlphaValidator] No closed trades with agentSignals in trades table. ' +
          'The main engine path (PaperTradingEngine) writes to paperTrades which lacks agentSignals. ' +
          'Trade decisions with agentSignals are now captured in trade_decision_log (Phase 22).');
      }

      return rows.map(row => {
        const entryPrice = parseFloat(row.entryPrice || '0');
        const exitPrice = parseFloat(row.exitPrice || '0');
        const pnlAfterCosts = parseFloat(row.pnlAfterCosts || '0');
        const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;

        return {
          id: row.id,
          side: row.side as 'long' | 'short',
          pnlAfterCosts,
          pnlPercent: row.side === 'long' ? pnlPercent : -pnlPercent,
          symbol: row.symbol,
          entryTime: row.entryTime || new Date(),
          exitTime: row.exitTime || new Date(),
          exitReason: row.exitReason || 'unknown',
          agentSignals: row.agentSignals,
        };
      });
    } catch (err) {
      console.error('[AgentAlphaValidator] Failed to load trades:', (err as Error)?.message);
      return [];
    }
  }

  /**
   * Extract per-agent records from trade snapshots
   * Each trade has an agentSignals JSON that contains the snapshot of all agent signals at entry
   */
  private extractAgentRecords(
    tradeRecords: Array<{
      id: number;
      side: 'long' | 'short';
      pnlAfterCosts: number;
      pnlPercent: number;
      symbol: string;
      entryTime: Date;
      exitTime: Date;
      exitReason: string;
      agentSignals: any;
    }>
  ): Map<string, AgentTradeRecord[]> {
    const agentRecords = new Map<string, AgentTradeRecord[]>();

    for (const trade of tradeRecords) {
      let signals: any[] = [];

      // agentSignals can be various formats — normalize
      if (Array.isArray(trade.agentSignals)) {
        signals = trade.agentSignals;
      } else if (trade.agentSignals && typeof trade.agentSignals === 'object') {
        // Could be { agentName: { signal, confidence } } format
        const obj = trade.agentSignals as Record<string, any>;
        if (obj.signals && Array.isArray(obj.signals)) {
          signals = obj.signals;
        } else {
          // Try converting object entries to array
          signals = Object.entries(obj).map(([name, data]) => ({
            agentName: name,
            ...(typeof data === 'object' ? data : { signal: 'neutral', confidence: 0.5 }),
          }));
        }
      }

      for (const sig of signals) {
        const agentName = sig.agentName || sig.name || 'unknown';
        const signal = sig.signal || sig.direction || 'neutral';
        const confidence = parseFloat(sig.confidence || '0.5');

        if (signal === 'neutral') continue; // Skip neutral — agent didn't take a position

        const record: AgentTradeRecord = {
          tradeId: trade.id,
          agentName,
          signal: signal as 'bullish' | 'bearish',
          confidence,
          tradeSide: trade.side,
          pnlAfterCosts: trade.pnlAfterCosts,
          pnlPercent: trade.pnlPercent,
          symbol: trade.symbol,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          exitReason: trade.exitReason,
        };

        if (!agentRecords.has(agentName)) {
          agentRecords.set(agentName, []);
        }
        agentRecords.get(agentName)!.push(record);
      }
    }

    return agentRecords;
  }

  /**
   * Compute comprehensive alpha metrics for a single agent
   */
  private computeAgentAlpha(agentName: string, records: AgentTradeRecord[]): AgentAlphaReport {
    const totalTrades = records.length;

    // Separate trades where agent agreed vs disagreed with trade direction
    const agreed: AgentTradeRecord[] = [];
    const disagreed: AgentTradeRecord[] = [];

    for (const r of records) {
      const agentSaysBuy = r.signal === 'bullish';
      const tradeBought = r.tradeSide === 'long';

      if (agentSaysBuy === tradeBought) {
        agreed.push(r);
      } else {
        disagreed.push(r);
      }
    }

    // Directional accuracy: when agent agreed, how often was trade profitable?
    const agreedWins = agreed.filter(r => r.pnlAfterCosts > 0).length;
    const directionalAccuracy = agreed.length > 0 ? agreedWins / agreed.length : 0.5;

    // Average P&L
    const avgPnlWhenAgreed = agreed.length > 0
      ? agreed.reduce((s, r) => s + r.pnlAfterCosts, 0) / agreed.length
      : 0;
    const avgPnlWhenDisagreed = disagreed.length > 0
      ? disagreed.reduce((s, r) => s + r.pnlAfterCosts, 0) / disagreed.length
      : 0;
    const valueAdded = avgPnlWhenAgreed - avgPnlWhenDisagreed;

    // Risk-adjusted metrics on agreed trades
    const agreedPnls = agreed.map(r => r.pnlAfterCosts);
    const sharpeRatio = this.computeSharpe(agreedPnls);
    const sortinoRatio = this.computeSortino(agreedPnls);

    const grossWins = agreedPnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const grossLosses = Math.abs(agreedPnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    // Information coefficient: Spearman rank correlation between confidence and P&L
    const confidences = agreed.map(r => r.confidence);
    const pnls = agreed.map(r => r.pnlAfterCosts);
    const informationCoefficient = this.spearmanCorrelation(confidences, pnls);

    // Brier score
    const brierScore = this.computeBrierScore(agreed);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0;

    // Statistical significance: binomial test
    // H0: directional accuracy = 50% (random)
    // H1: directional accuracy > 50% (has alpha)
    const pValue = this.binomialPValue(agreedWins, agreed.length, 0.5);
    const isSignificant = pValue < this.SIGNIFICANCE_LEVEL && agreed.length >= this.MIN_TRADES_FOR_SIGNIFICANCE;

    // Alpha classification
    const hasAlpha = isSignificant && directionalAccuracy > 0.52 && valueAdded > 0;
    const alphaGrade = this.computeGrade(directionalAccuracy, sharpeRatio, profitFactor, informationCoefficient, totalTrades);
    const recommendation = this.computeRecommendation(hasAlpha, alphaGrade, directionalAccuracy, totalTrades);

    // Rolling metrics (last 50 trades)
    const recentRecords = records.slice(-50);
    const recentAgreed = recentRecords.filter(r => {
      const agentSaysBuy = r.signal === 'bullish';
      const tradeBought = r.tradeSide === 'long';
      return agentSaysBuy === tradeBought;
    });
    const recentWins = recentAgreed.filter(r => r.pnlAfterCosts > 0).length;
    const rollingWinRate = recentAgreed.length > 0 ? recentWins / recentAgreed.length : 0.5;
    const rollingSharpe = this.computeSharpe(recentAgreed.map(r => r.pnlAfterCosts));

    return {
      agentName,
      totalTrades,
      directionalAccuracy,
      avgPnlWhenAgreed,
      avgPnlWhenDisagreed,
      valueAdded,
      sharpeRatio,
      sortinoRatio,
      profitFactor,
      informationCoefficient,
      brierScore,
      avgConfidence,
      pValue,
      isSignificant,
      hasAlpha,
      alphaGrade,
      recommendation,
      rollingWinRate,
      rollingSharpe,
      validatedAt: Date.now(),
    };
  }

  /**
   * Compute annualized Sharpe ratio from trade P&Ls
   */
  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;

    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return mean > 0 ? 3 : 0; // Perfect consistency

    // Annualize: assume ~6 trades/day, 365 days
    const tradesPerYear = 6 * 365;
    return (mean / stdDev) * Math.sqrt(tradesPerYear);
  }

  /**
   * Compute Sortino ratio (downside deviation only)
   */
  private computeSortino(pnls: number[]): number {
    if (pnls.length < 2) return 0;

    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const downside = pnls.filter(p => p < 0);
    if (downside.length === 0) return mean > 0 ? 5 : 0; // No losses

    const downsideVariance = downside.reduce((s, p) => s + p ** 2, 0) / downside.length;
    const downsideDev = Math.sqrt(downsideVariance);

    if (downsideDev === 0) return 0;

    const tradesPerYear = 6 * 365;
    return (mean / downsideDev) * Math.sqrt(tradesPerYear);
  }

  /**
   * Spearman rank correlation between two arrays
   * Measures monotonic relationship between confidence and P&L
   */
  private spearmanCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0;

    const n = x.length;
    const rankX = this.rankArray(x);
    const rankY = this.rankArray(y);

    let sumD2 = 0;
    for (let i = 0; i < n; i++) {
      sumD2 += (rankX[i] - rankY[i]) ** 2;
    }

    // Spearman's rho = 1 - (6 * sum(d²)) / (n * (n² - 1))
    return 1 - (6 * sumD2) / (n * (n * n - 1));
  }

  /**
   * Rank array values (average rank for ties)
   */
  private rankArray(arr: number[]): number[] {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);

    const ranks = new Array(arr.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j < indexed.length && indexed[j].v === indexed[i].v) {
        j++;
      }
      const avgRank = (i + j + 1) / 2; // Average rank for ties
      for (let k = i; k < j; k++) {
        ranks[indexed[k].i] = avgRank;
      }
      i = j;
    }

    return ranks;
  }

  /**
   * Brier score: measures calibration of confidence
   * Perfect calibration = 0, worst = 1
   */
  private computeBrierScore(records: AgentTradeRecord[]): number {
    if (records.length === 0) return 0.25;

    let sumSquaredErrors = 0;
    for (const r of records) {
      const outcome = r.pnlAfterCosts > 0 ? 1 : 0;
      const forecast = r.confidence;
      sumSquaredErrors += (forecast - outcome) ** 2;
    }

    return sumSquaredErrors / records.length;
  }

  /**
   * Binomial test p-value
   * Tests whether observed success rate is significantly different from null rate
   * Uses normal approximation for large n, exact for small n
   */
  private binomialPValue(successes: number, trials: number, nullRate: number): number {
    if (trials === 0) return 1;
    if (trials < 20) {
      // Exact binomial (one-sided: P(X >= successes))
      let pValue = 0;
      for (let k = successes; k <= trials; k++) {
        pValue += this.binomialPMF(k, trials, nullRate);
      }
      return pValue;
    }

    // Normal approximation for large n
    const mean = trials * nullRate;
    const stdDev = Math.sqrt(trials * nullRate * (1 - nullRate));
    if (stdDev === 0) return successes >= mean ? 0 : 1;

    const z = (successes - 0.5 - mean) / stdDev; // Continuity correction
    return 1 - this.normalCDF(z);
  }

  /**
   * Binomial PMF: P(X = k) = C(n,k) * p^k * (1-p)^(n-k)
   */
  private binomialPMF(k: number, n: number, p: number): number {
    let logCoeff = 0;
    for (let i = 0; i < k; i++) {
      logCoeff += Math.log(n - i) - Math.log(i + 1);
    }
    return Math.exp(logCoeff + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }

  /**
   * Standard normal CDF approximation (Abramowitz & Stegun)
   */
  private normalCDF(z: number): number {
    if (z < -8) return 0;
    if (z > 8) return 1;

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1 + sign * y);
  }

  /**
   * Compute alpha grade based on composite metrics
   */
  private computeGrade(
    accuracy: number,
    sharpe: number,
    profitFactor: number,
    ic: number,
    totalTrades: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (totalTrades < this.MIN_TRADES_FOR_SIGNIFICANCE) return 'C'; // Insufficient data

    let score = 0;

    // Accuracy contribution (0-30 points)
    if (accuracy >= 0.60) score += 30;
    else if (accuracy >= 0.55) score += 20;
    else if (accuracy >= 0.52) score += 10;
    else if (accuracy >= 0.50) score += 5;

    // Sharpe contribution (0-30 points)
    if (sharpe >= 2.0) score += 30;
    else if (sharpe >= 1.0) score += 20;
    else if (sharpe >= 0.5) score += 10;
    else if (sharpe >= 0) score += 5;

    // Profit factor contribution (0-20 points)
    if (profitFactor >= 2.0) score += 20;
    else if (profitFactor >= 1.5) score += 15;
    else if (profitFactor >= 1.2) score += 10;
    else if (profitFactor >= 1.0) score += 5;

    // Information coefficient contribution (0-20 points)
    if (ic >= 0.15) score += 20;
    else if (ic >= 0.10) score += 15;
    else if (ic >= 0.05) score += 10;
    else if (ic >= 0) score += 5;

    if (score >= 80) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    if (score >= 20) return 'D';
    return 'F';
  }

  /**
   * Determine recommendation for agent based on alpha analysis
   */
  private computeRecommendation(
    hasAlpha: boolean,
    grade: 'A' | 'B' | 'C' | 'D' | 'F',
    accuracy: number,
    totalTrades: number
  ): 'boost' | 'keep' | 'reduce' | 'prune' {
    if (totalTrades < 10) return 'keep'; // Too early to judge

    if (hasAlpha && (grade === 'A' || grade === 'B')) return 'boost';
    if (hasAlpha) return 'keep';

    if (grade === 'F' && accuracy < 0.45 && totalTrades >= this.MIN_TRADES_FOR_SIGNIFICANCE) return 'prune';
    if (grade === 'D') return 'reduce';

    return 'keep';
  }

  /**
   * Log validation summary
   */
  private logSummary(result: AlphaValidationResult): void {
    console.log('\n============================================');
    console.log('   AGENT ALPHA VALIDATION REPORT');
    console.log('============================================');
    console.log(`Trades Analyzed: ${result.totalTradesAnalyzed}`);
    console.log(`System Win Rate: ${(result.systemWinRate * 100).toFixed(1)}%`);
    console.log(`System Sharpe: ${result.systemSharpe.toFixed(2)}`);
    console.log(`System Profit Factor: ${result.systemProfitFactor.toFixed(2)}`);
    console.log('');

    console.log('Per-Agent Alpha:');
    console.log('─────────────────────────────────────────────');
    console.log(`${'Agent'.padEnd(25)} ${'Grade'.padEnd(6)} ${'WinRate'.padEnd(8)} ${'Sharpe'.padEnd(8)} ${'PF'.padEnd(6)} ${'IC'.padEnd(6)} ${'p-val'.padEnd(8)} ${'Action'.padEnd(8)}`);
    console.log('─────────────────────────────────────────────');

    for (const r of result.agentReports) {
      console.log(
        `${r.agentName.padEnd(25)} ` +
        `${r.alphaGrade.padEnd(6)} ` +
        `${(r.directionalAccuracy * 100).toFixed(1).padStart(5)}%  ` +
        `${r.sharpeRatio.toFixed(2).padStart(6)}  ` +
        `${r.profitFactor.toFixed(1).padStart(4)}  ` +
        `${r.informationCoefficient.toFixed(2).padStart(5)} ` +
        `${r.pValue.toFixed(3).padStart(6)}  ` +
        `${r.recommendation.toUpperCase()}`
      );
    }

    console.log('');
    if (result.agentsWithAlpha.length > 0) {
      console.log(`✅ Agents with proven alpha: ${result.agentsWithAlpha.join(', ')}`);
    }
    if (result.agentsToBoost.length > 0) {
      console.log(`⬆️  Agents to boost: ${result.agentsToBoost.join(', ')}`);
    }
    if (result.agentsToPrune.length > 0) {
      console.log(`❌ Agents to prune: ${result.agentsToPrune.join(', ')}`);
    }
    console.log('============================================\n');
  }

  /**
   * Persist validation result to database
   */
  private async persistResult(result: AlphaValidationResult): Promise<void> {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      if (!db) return;

      const { systemConfig } = await import('../../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');

      const data = {
        timestamp: new Date(result.timestamp).toISOString(),
        totalTradesAnalyzed: result.totalTradesAnalyzed,
        systemWinRate: result.systemWinRate,
        systemSharpe: result.systemSharpe,
        systemProfitFactor: result.systemProfitFactor,
        agentsWithAlpha: result.agentsWithAlpha,
        agentsToPrune: result.agentsToPrune,
        agentsToBoost: result.agentsToBoost,
        agentSummaries: result.agentReports.map(r => ({
          name: r.agentName,
          grade: r.alphaGrade,
          winRate: r.directionalAccuracy,
          sharpe: r.sharpeRatio,
          pf: r.profitFactor,
          ic: r.informationCoefficient,
          pValue: r.pValue,
          action: r.recommendation,
        })),
      };

      const existing = await db.select().from(systemConfig)
        .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'agent_alpha_validation')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(systemConfig)
          .set({ configValue: data, updatedAt: new Date() })
          .where(and(eq(systemConfig.userId, 1), eq(systemConfig.configKey, 'agent_alpha_validation')));
      } else {
        await db.insert(systemConfig).values({
          userId: 1,
          configKey: 'agent_alpha_validation',
          configValue: data,
        });
      }
    } catch {
      // Non-critical
    }
  }
}

// Singleton
let instance: AgentAlphaValidator | null = null;

export function getAgentAlphaValidator(): AgentAlphaValidator {
  if (!instance) {
    instance = new AgentAlphaValidator();
  }
  return instance;
}

export { AgentAlphaValidator };
