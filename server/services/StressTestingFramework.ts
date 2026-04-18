/**
 * Stress Testing Framework
 * 
 * Comprehensive stress testing with historical crash scenarios,
 * Monte Carlo simulation, and continuous stress monitoring.
 * 
 * Key Features:
 * - Historical stress tests (2020 March crash, 2022 Luna/UST collapse)
 * - Monte Carlo simulation for scenario generation
 * - Continuous stress monitoring indicators
 * - Automated stress test reporting
 * - Tail risk analysis (VaR, CVaR, Expected Shortfall)
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface StressScenario {
  id: string;
  name: string;
  description: string;
  type: 'historical' | 'hypothetical' | 'monte_carlo';
  category: 'market_crash' | 'liquidity_crisis' | 'flash_crash' | 'black_swan' | 'correlation_breakdown';
  parameters: ScenarioParameters;
  expectedImpact: ExpectedImpact;
}

export interface ScenarioParameters {
  // Price movements
  priceDropPercent: number;
  priceDropDurationMs: number;
  volatilityMultiplier: number;
  
  // Liquidity
  liquidityDropPercent: number;
  spreadWidenMultiplier: number;
  
  // Correlation
  correlationShift: number;
  
  // Market conditions
  volumeMultiplier: number;
  gapDownPercent?: number;
  
  // Time parameters
  recoveryTimeMs: number;
  aftershockCount: number;
}

export interface ExpectedImpact {
  maxDrawdownPercent: number;
  expectedLossPercent: number;
  liquidationRisk: 'low' | 'medium' | 'high' | 'critical';
  marginCallProbability: number;
}

export interface StressTestResult {
  id: string;
  scenarioId: string;
  scenarioName: string;
  timestamp: number;
  durationMs: number;
  
  // Portfolio impact
  initialValue: number;
  finalValue: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  realizedPnL: number;
  unrealizedPnL: number;
  
  // Risk metrics
  var95: number;
  var99: number;
  cvar95: number;  // Expected Shortfall at 95%
  cvar99: number;  // Expected Shortfall at 99%
  
  // Position impact
  positionsLiquidated: number;
  marginCallsTriggered: number;
  stopLossesHit: number;
  
  // System behavior
  circuitBreakersTriggered: number;
  failoversExecuted: number;
  ordersRejected: number;
  latencySpikes: number;
  
  // Recovery
  recoveryTimeMs: number;
  recoveryComplete: boolean;
  
  // Verdict
  passed: boolean;
  failureReasons: string[];
  recommendations: string[];
}

export interface MonteCarloConfig {
  simulations: number;           // Number of simulations (default: 10000)
  timeHorizonDays: number;       // Simulation horizon (default: 30)
  confidenceLevel: number;       // Confidence level (default: 0.95)
  volatilityModel: 'historical' | 'garch' | 'ewma';
  correlationModel: 'historical' | 'dynamic' | 'stressed';
  jumpDiffusion: boolean;        // Include jump diffusion
  meanReversion: boolean;        // Include mean reversion
}

export interface MonteCarloResult {
  id: string;
  timestamp: number;
  config: MonteCarloConfig;
  
  // Distribution statistics
  meanReturn: number;
  stdDevReturn: number;
  skewness: number;
  kurtosis: number;
  
  // Risk metrics
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  
  // Percentiles
  percentiles: { [key: number]: number };
  
  // Scenario counts
  scenariosWithLoss: number;
  scenariosWithGain: number;
  extremeScenarios: number;
  
  // Paths (sample)
  samplePaths: number[][];
}

export interface StressIndicator {
  name: string;
  value: number;
  threshold: number;
  status: 'normal' | 'elevated' | 'high' | 'critical';
  trend: 'improving' | 'stable' | 'deteriorating';
  lastUpdated: number;
}

export interface StressTestConfig {
  // Test parameters
  defaultPositionSize: number;
  defaultLeverage: number;
  marginRequirement: number;
  
  // Thresholds
  maxAcceptableDrawdown: number;
  maxAcceptableLoss: number;
  minLiquidityRatio: number;
  
  // Monte Carlo
  monteCarloConfig: MonteCarloConfig;
  
  // Reporting
  autoReportEnabled: boolean;
  reportIntervalMs: number;
}

// ============================================================================
// Historical Scenarios
// ============================================================================

const HISTORICAL_SCENARIOS: StressScenario[] = [
  {
    id: 'march-2020-crash',
    name: 'March 2020 COVID Crash',
    description: 'Simulates the March 2020 market crash triggered by COVID-19 pandemic fears',
    type: 'historical',
    category: 'market_crash',
    parameters: {
      priceDropPercent: 35,
      priceDropDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      volatilityMultiplier: 5,
      liquidityDropPercent: 60,
      spreadWidenMultiplier: 10,
      correlationShift: 0.3, // Correlations increased
      volumeMultiplier: 3,
      gapDownPercent: 10,
      recoveryTimeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
      aftershockCount: 5,
    },
    expectedImpact: {
      maxDrawdownPercent: 40,
      expectedLossPercent: 25,
      liquidationRisk: 'critical',
      marginCallProbability: 0.8,
    },
  },
  {
    id: 'luna-ust-collapse-2022',
    name: 'Luna/UST Collapse May 2022',
    description: 'Simulates the Terra Luna and UST stablecoin collapse',
    type: 'historical',
    category: 'black_swan',
    parameters: {
      priceDropPercent: 99.99, // Luna went to near zero
      priceDropDurationMs: 5 * 24 * 60 * 60 * 1000, // 5 days
      volatilityMultiplier: 20,
      liquidityDropPercent: 95,
      spreadWidenMultiplier: 50,
      correlationShift: 0.5, // Massive correlation spike
      volumeMultiplier: 10,
      gapDownPercent: 50,
      recoveryTimeMs: 0, // No recovery
      aftershockCount: 10,
    },
    expectedImpact: {
      maxDrawdownPercent: 100,
      expectedLossPercent: 99,
      liquidationRisk: 'critical',
      marginCallProbability: 1.0,
    },
  },
  {
    id: 'ftx-collapse-2022',
    name: 'FTX Collapse November 2022',
    description: 'Simulates the FTX exchange collapse and contagion',
    type: 'historical',
    category: 'liquidity_crisis',
    parameters: {
      priceDropPercent: 25,
      priceDropDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 days
      volatilityMultiplier: 8,
      liquidityDropPercent: 80,
      spreadWidenMultiplier: 20,
      correlationShift: 0.4,
      volumeMultiplier: 5,
      gapDownPercent: 15,
      recoveryTimeMs: 14 * 24 * 60 * 60 * 1000, // 14 days
      aftershockCount: 7,
    },
    expectedImpact: {
      maxDrawdownPercent: 30,
      expectedLossPercent: 20,
      liquidationRisk: 'high',
      marginCallProbability: 0.6,
    },
  },
  {
    id: 'flash-crash-2010',
    name: 'Flash Crash May 2010',
    description: 'Simulates the 2010 flash crash with rapid recovery',
    type: 'historical',
    category: 'flash_crash',
    parameters: {
      priceDropPercent: 10,
      priceDropDurationMs: 5 * 60 * 1000, // 5 minutes
      volatilityMultiplier: 15,
      liquidityDropPercent: 90,
      spreadWidenMultiplier: 100,
      correlationShift: 0.8, // Everything crashed together
      volumeMultiplier: 20,
      gapDownPercent: 5,
      recoveryTimeMs: 20 * 60 * 1000, // 20 minutes
      aftershockCount: 2,
    },
    expectedImpact: {
      maxDrawdownPercent: 12,
      expectedLossPercent: 5,
      liquidationRisk: 'high',
      marginCallProbability: 0.4,
    },
  },
  {
    id: 'crypto-winter-2018',
    name: 'Crypto Winter 2018',
    description: 'Simulates the prolonged 2018 crypto bear market',
    type: 'historical',
    category: 'market_crash',
    parameters: {
      priceDropPercent: 85,
      priceDropDurationMs: 365 * 24 * 60 * 60 * 1000, // 1 year
      volatilityMultiplier: 2,
      liquidityDropPercent: 70,
      spreadWidenMultiplier: 5,
      correlationShift: 0.2,
      volumeMultiplier: 0.3, // Volume decreased
      gapDownPercent: 5,
      recoveryTimeMs: 730 * 24 * 60 * 60 * 1000, // 2 years
      aftershockCount: 20,
    },
    expectedImpact: {
      maxDrawdownPercent: 90,
      expectedLossPercent: 70,
      liquidationRisk: 'critical',
      marginCallProbability: 0.9,
    },
  },
];

// ============================================================================
// Stress Testing Framework
// ============================================================================

export class StressTestingFramework extends EventEmitter {
  private config: StressTestConfig;
  private scenarios: Map<string, StressScenario> = new Map();
  private testResults: StressTestResult[] = [];
  private monteCarloResults: MonteCarloResult[] = [];
  private stressIndicators: Map<string, StressIndicator> = new Map();
  private isActive: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private resultCounter: number = 0;

  // Current portfolio state (for testing)
  private portfolioValue: number = 100000;
  private positions: Array<{
    symbol: string;
    size: number;
    entryPrice: number;
    currentPrice: number;
    leverage: number;
  }> = [];

  constructor(config?: Partial<StressTestConfig>) {
    super();
    this.config = {
      defaultPositionSize: 10000,
      defaultLeverage: 1,
      marginRequirement: 0.1,
      maxAcceptableDrawdown: 0.2,
      maxAcceptableLoss: 0.15,
      minLiquidityRatio: 0.3,
      monteCarloConfig: {
        simulations: 10000,
        timeHorizonDays: 30,
        confidenceLevel: 0.95,
        volatilityModel: 'historical',
        correlationModel: 'historical',
        jumpDiffusion: true,
        meanReversion: false,
      },
      autoReportEnabled: true,
      reportIntervalMs: 3600000, // 1 hour
      ...config,
    };

    // Load historical scenarios
    for (const scenario of HISTORICAL_SCENARIOS) {
      this.scenarios.set(scenario.id, scenario);
    }

    // Initialize stress indicators
    this.initializeStressIndicators();

    console.log('[StressTestingFramework] Initialized with', this.scenarios.size, 'scenarios');
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  start(): void {
    if (this.isActive) return;
    this.isActive = true;

    // Start continuous monitoring
    this.monitoringInterval = setInterval(() => {
      this.updateStressIndicators();
    }, 60000); // Every minute

    console.log('[StressTestingFramework] Started');
    this.emit('framework_started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('[StressTestingFramework] Stopped');
    this.emit('framework_stopped', { timestamp: Date.now() });
  }

  // ============================================================================
  // Scenario Management
  // ============================================================================

  addScenario(scenario: StressScenario): void {
    this.scenarios.set(scenario.id, scenario);
    console.log(`[StressTestingFramework] Added scenario: ${scenario.name}`);
    this.emit('scenario_added', scenario);
  }

  getScenario(id: string): StressScenario | undefined {
    return this.scenarios.get(id);
  }

  getAllScenarios(): StressScenario[] {
    return Array.from(this.scenarios.values());
  }

  getScenariosByCategory(category: StressScenario['category']): StressScenario[] {
    return Array.from(this.scenarios.values()).filter(s => s.category === category);
  }

  // ============================================================================
  // Stress Test Execution
  // ============================================================================

  /**
   * Run a stress test for a specific scenario
   */
  async runStressTest(
    scenarioId: string,
    portfolioValue?: number,
    positions?: typeof this.positions
  ): Promise<StressTestResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    const startTime = performance.now();
    this.resultCounter++;

    const testPortfolioValue = portfolioValue || this.portfolioValue;
    const testPositions = positions || this.positions;

    console.log(`[StressTestingFramework] Running stress test: ${scenario.name}`);
    this.emit('stress_test_started', { scenarioId, scenarioName: scenario.name });

    // Simulate the scenario
    const simulation = this.simulateScenario(scenario, testPortfolioValue, testPositions);

    // Calculate risk metrics
    const riskMetrics = this.calculateRiskMetrics(simulation.returns);

    // Determine pass/fail
    const failureReasons: string[] = [];
    const recommendations: string[] = [];

    if (simulation.maxDrawdownPercent > this.config.maxAcceptableDrawdown * 100) {
      failureReasons.push(`Max drawdown ${simulation.maxDrawdownPercent.toFixed(2)}% exceeds threshold ${this.config.maxAcceptableDrawdown * 100}%`);
      recommendations.push('Consider reducing position sizes or leverage');
    }

    if (simulation.totalLossPercent > this.config.maxAcceptableLoss * 100) {
      failureReasons.push(`Total loss ${simulation.totalLossPercent.toFixed(2)}% exceeds threshold ${this.config.maxAcceptableLoss * 100}%`);
      recommendations.push('Implement tighter stop losses');
    }

    if (simulation.liquidationsTriggered > 0) {
      failureReasons.push(`${simulation.liquidationsTriggered} positions would be liquidated`);
      recommendations.push('Reduce leverage or increase margin');
    }

    const durationMs = performance.now() - startTime;

    const result: StressTestResult = {
      id: `ST-${scenarioId}-${Date.now()}-${this.resultCounter}`,
      scenarioId,
      scenarioName: scenario.name,
      timestamp: Date.now(),
      durationMs,
      
      initialValue: testPortfolioValue,
      finalValue: simulation.finalValue,
      maxDrawdown: simulation.maxDrawdown,
      maxDrawdownPercent: simulation.maxDrawdownPercent,
      realizedPnL: simulation.realizedPnL,
      unrealizedPnL: simulation.unrealizedPnL,
      
      var95: riskMetrics.var95,
      var99: riskMetrics.var99,
      cvar95: riskMetrics.cvar95,
      cvar99: riskMetrics.cvar99,
      
      positionsLiquidated: simulation.liquidationsTriggered,
      marginCallsTriggered: simulation.marginCallsTriggered,
      stopLossesHit: simulation.stopLossesHit,
      
      circuitBreakersTriggered: simulation.circuitBreakersTriggered,
      failoversExecuted: simulation.failoversExecuted,
      ordersRejected: simulation.ordersRejected,
      latencySpikes: simulation.latencySpikes,
      
      recoveryTimeMs: simulation.recoveryTimeMs,
      recoveryComplete: simulation.recoveryComplete,
      
      passed: failureReasons.length === 0,
      failureReasons,
      recommendations,
    };

    this.testResults.push(result);
    if (this.testResults.length > 1000) {
      this.testResults = this.testResults.slice(-500);
    }

    console.log(`[StressTestingFramework] Test ${result.passed ? 'PASSED' : 'FAILED'}: ${scenario.name}`);
    this.emit('stress_test_completed', result);

    return result;
  }

  /**
   * Run all historical stress tests
   */
  async runAllHistoricalTests(
    portfolioValue?: number,
    positions?: typeof this.positions
  ): Promise<StressTestResult[]> {
    const results: StressTestResult[] = [];
    const historicalScenarios = Array.from(this.scenarios.values())
      .filter(s => s.type === 'historical');

    for (const scenario of historicalScenarios) {
      const result = await this.runStressTest(scenario.id, portfolioValue, positions);
      results.push(result);
    }

    return results;
  }

  private simulateScenario(
    scenario: StressScenario,
    portfolioValue: number,
    positions: typeof this.positions
  ): {
    returns: number[];
    finalValue: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    totalLossPercent: number;
    realizedPnL: number;
    unrealizedPnL: number;
    liquidationsTriggered: number;
    marginCallsTriggered: number;
    stopLossesHit: number;
    circuitBreakersTriggered: number;
    failoversExecuted: number;
    ordersRejected: number;
    latencySpikes: number;
    recoveryTimeMs: number;
    recoveryComplete: boolean;
  } {
    const params = scenario.parameters;
    const returns: number[] = [];
    
    // Simulate price path
    const steps = 100;
    const stepDuration = params.priceDropDurationMs / steps;
    let currentValue = portfolioValue;
    let maxValue = portfolioValue;
    let minValue = portfolioValue;
    
    // Initial gap down
    if (params.gapDownPercent) {
      const gapReturn = -params.gapDownPercent / 100;
      currentValue *= (1 + gapReturn);
      returns.push(gapReturn);
    }

    // Main decline phase
    const totalDecline = params.priceDropPercent / 100;
    const avgStepDecline = totalDecline / steps;
    
    for (let i = 0; i < steps; i++) {
      // Add volatility
      const volatility = avgStepDecline * params.volatilityMultiplier * (Math.random() - 0.5);
      const stepReturn = -avgStepDecline + volatility;
      
      currentValue *= (1 + stepReturn);
      returns.push(stepReturn);
      
      maxValue = Math.max(maxValue, currentValue);
      minValue = Math.min(minValue, currentValue);
    }

    // Aftershocks
    for (let i = 0; i < params.aftershockCount; i++) {
      const aftershockReturn = (Math.random() - 0.6) * 0.05; // Biased negative
      currentValue *= (1 + aftershockReturn);
      returns.push(aftershockReturn);
    }

    // Recovery phase (if applicable)
    let recoveryComplete = false;
    if (params.recoveryTimeMs > 0) {
      const recoverySteps = 50;
      const targetRecovery = 0.5; // Recover 50% of losses
      const avgRecoveryStep = targetRecovery / recoverySteps;
      
      for (let i = 0; i < recoverySteps; i++) {
        const recoveryReturn = avgRecoveryStep * (0.5 + Math.random());
        currentValue *= (1 + recoveryReturn);
        returns.push(recoveryReturn);
      }
      recoveryComplete = currentValue > portfolioValue * 0.8;
    }

    // Calculate metrics
    const maxDrawdown = maxValue - minValue;
    const maxDrawdownPercent = (maxDrawdown / maxValue) * 100;
    const totalLossPercent = ((portfolioValue - currentValue) / portfolioValue) * 100;

    // Estimate liquidations based on leverage and drawdown
    let liquidationsTriggered = 0;
    let marginCallsTriggered = 0;
    let stopLossesHit = 0;

    for (const position of positions) {
      const positionLoss = position.size * (params.priceDropPercent / 100) * position.leverage;
      const marginRequired = position.size * this.config.marginRequirement;
      
      if (positionLoss > marginRequired) {
        liquidationsTriggered++;
      } else if (positionLoss > marginRequired * 0.8) {
        marginCallsTriggered++;
      }
      
      // Assume 5% stop loss
      if (params.priceDropPercent > 5) {
        stopLossesHit++;
      }
    }

    // System behavior estimates
    const circuitBreakersTriggered = params.priceDropPercent > 10 ? Math.ceil(params.priceDropPercent / 5) : 0;
    const failoversExecuted = params.liquidityDropPercent > 50 ? 1 : 0;
    const ordersRejected = Math.floor(params.liquidityDropPercent / 10);
    const latencySpikes = Math.floor(params.volatilityMultiplier);

    return {
      returns,
      finalValue: currentValue,
      maxDrawdown,
      maxDrawdownPercent,
      totalLossPercent,
      realizedPnL: stopLossesHit > 0 ? -portfolioValue * 0.05 * stopLossesHit : 0,
      unrealizedPnL: currentValue - portfolioValue,
      liquidationsTriggered,
      marginCallsTriggered,
      stopLossesHit,
      circuitBreakersTriggered,
      failoversExecuted,
      ordersRejected,
      latencySpikes,
      recoveryTimeMs: params.recoveryTimeMs,
      recoveryComplete,
    };
  }

  // ============================================================================
  // Monte Carlo Simulation
  // ============================================================================

  /**
   * Run Monte Carlo simulation
   */
  runMonteCarloSimulation(
    portfolioValue?: number,
    config?: Partial<MonteCarloConfig>
  ): MonteCarloResult {
    const mcConfig = { ...this.config.monteCarloConfig, ...config };
    const startValue = portfolioValue || this.portfolioValue;
    
    console.log(`[StressTestingFramework] Running Monte Carlo with ${mcConfig.simulations} simulations`);

    const allReturns: number[] = [];
    const allFinalValues: number[] = [];
    const samplePaths: number[][] = [];
    let maxDrawdownSum = 0;

    // Run simulations
    for (let sim = 0; sim < mcConfig.simulations; sim++) {
      const path = this.generatePricePath(startValue, mcConfig);
      const finalValue = path[path.length - 1];
      const totalReturn = (finalValue - startValue) / startValue;
      
      allReturns.push(totalReturn);
      allFinalValues.push(finalValue);
      
      // Calculate max drawdown for this path
      let peak = startValue;
      let maxDD = 0;
      for (const value of path) {
        peak = Math.max(peak, value);
        const dd = (peak - value) / peak;
        maxDD = Math.max(maxDD, dd);
      }
      maxDrawdownSum += maxDD;

      // Store sample paths (first 10)
      if (sim < 10) {
        samplePaths.push(path);
      }
    }

    // Sort returns for percentile calculations
    const sortedReturns = [...allReturns].sort((a, b) => a - b);

    // Calculate statistics
    const meanReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
    const variance = allReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / allReturns.length;
    const stdDevReturn = Math.sqrt(variance);

    // Skewness and Kurtosis
    const skewness = allReturns.reduce((sum, r) => sum + Math.pow((r - meanReturn) / stdDevReturn, 3), 0) / allReturns.length;
    const kurtosis = allReturns.reduce((sum, r) => sum + Math.pow((r - meanReturn) / stdDevReturn, 4), 0) / allReturns.length - 3;

    // VaR and CVaR
    const var95Index = Math.floor(mcConfig.simulations * 0.05);
    const var99Index = Math.floor(mcConfig.simulations * 0.01);
    
    const var95 = -sortedReturns[var95Index] * startValue;
    const var99 = -sortedReturns[var99Index] * startValue;
    
    // CVaR (Expected Shortfall)
    const cvar95 = -sortedReturns.slice(0, var95Index).reduce((a, b) => a + b, 0) / var95Index * startValue;
    const cvar99 = -sortedReturns.slice(0, var99Index).reduce((a, b) => a + b, 0) / var99Index * startValue;

    // Percentiles
    const percentiles: { [key: number]: number } = {};
    for (const p of [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
      const index = Math.floor(mcConfig.simulations * (p / 100));
      percentiles[p] = sortedReturns[index] * 100;
    }

    // Scenario counts
    const scenariosWithLoss = allReturns.filter(r => r < 0).length;
    const scenariosWithGain = allReturns.filter(r => r > 0).length;
    const extremeScenarios = allReturns.filter(r => Math.abs(r) > 0.2).length;

    const result: MonteCarloResult = {
      id: `MC-${Date.now()}`,
      timestamp: Date.now(),
      config: mcConfig,
      meanReturn: meanReturn * 100,
      stdDevReturn: stdDevReturn * 100,
      skewness,
      kurtosis,
      var95,
      var99,
      cvar95,
      cvar99,
      maxDrawdown: (maxDrawdownSum / mcConfig.simulations) * 100,
      percentiles,
      scenariosWithLoss,
      scenariosWithGain,
      extremeScenarios,
      samplePaths,
    };

    this.monteCarloResults.push(result);
    if (this.monteCarloResults.length > 100) {
      this.monteCarloResults = this.monteCarloResults.slice(-50);
    }

    console.log(`[StressTestingFramework] Monte Carlo complete - VaR95: $${var95.toFixed(2)}, CVaR95: $${cvar95.toFixed(2)}`);
    this.emit('monte_carlo_completed', result);

    return result;
  }

  private generatePricePath(startValue: number, config: MonteCarloConfig): number[] {
    const path: number[] = [startValue];
    const dailyVolatility = 0.02; // 2% daily volatility base
    const drift = 0.0001; // Small positive drift
    
    let currentValue = startValue;

    for (let day = 0; day < config.timeHorizonDays; day++) {
      // Base return (Geometric Brownian Motion)
      let dailyReturn = drift + dailyVolatility * this.normalRandom();

      // Jump diffusion (rare large moves)
      if (config.jumpDiffusion && Math.random() < 0.02) {
        const jumpSize = (Math.random() - 0.5) * 0.1; // ±5% jump
        dailyReturn += jumpSize;
      }

      // Mean reversion
      if (config.meanReversion) {
        const deviation = (currentValue - startValue) / startValue;
        dailyReturn -= deviation * 0.1; // Pull back towards start
      }

      currentValue *= (1 + dailyReturn);
      path.push(currentValue);
    }

    return path;
  }

  private normalRandom(): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ============================================================================
  // Risk Metrics Calculation
  // ============================================================================

  private calculateRiskMetrics(returns: number[]): {
    var95: number;
    var99: number;
    cvar95: number;
    cvar99: number;
  } {
    if (returns.length === 0) {
      return { var95: 0, var99: 0, cvar95: 0, cvar99: 0 };
    }

    const sortedReturns = [...returns].sort((a, b) => a - b);
    const n = sortedReturns.length;

    const var95Index = Math.floor(n * 0.05);
    const var99Index = Math.floor(n * 0.01);

    const var95 = -sortedReturns[var95Index] * this.portfolioValue;
    const var99 = -sortedReturns[var99Index] * this.portfolioValue;

    const cvar95 = var95Index > 0 
      ? -sortedReturns.slice(0, var95Index).reduce((a, b) => a + b, 0) / var95Index * this.portfolioValue
      : var95;
    const cvar99 = var99Index > 0
      ? -sortedReturns.slice(0, var99Index).reduce((a, b) => a + b, 0) / var99Index * this.portfolioValue
      : var99;

    return { var95, var99, cvar95, cvar99 };
  }

  // ============================================================================
  // Stress Indicators
  // ============================================================================

  private initializeStressIndicators(): void {
    const indicators: StressIndicator[] = [
      { name: 'Market Volatility Index', value: 20, threshold: 40, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
      { name: 'Liquidity Stress', value: 10, threshold: 50, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
      { name: 'Correlation Breakdown', value: 0.3, threshold: 0.8, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
      { name: 'Spread Widening', value: 5, threshold: 50, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
      { name: 'Order Book Depth', value: 80, threshold: 30, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
      { name: 'Exchange Health', value: 95, threshold: 70, status: 'normal', trend: 'stable', lastUpdated: Date.now() },
    ];

    for (const indicator of indicators) {
      this.stressIndicators.set(indicator.name, indicator);
    }
  }

  updateStressIndicator(name: string, value: number): void {
    const indicator = this.stressIndicators.get(name);
    if (!indicator) return;

    const previousValue = indicator.value;
    indicator.value = value;
    indicator.lastUpdated = Date.now();

    // Determine trend
    if (value > previousValue * 1.1) {
      indicator.trend = 'deteriorating';
    } else if (value < previousValue * 0.9) {
      indicator.trend = 'improving';
    } else {
      indicator.trend = 'stable';
    }

    // Determine status
    const ratio = value / indicator.threshold;
    if (ratio >= 1) {
      indicator.status = 'critical';
    } else if (ratio >= 0.75) {
      indicator.status = 'high';
    } else if (ratio >= 0.5) {
      indicator.status = 'elevated';
    } else {
      indicator.status = 'normal';
    }

    if (indicator.status === 'critical') {
      this.emit('stress_indicator_critical', indicator);
    }
  }

  private updateStressIndicators(): void {
    // Simulate indicator updates (in production, these would come from real data)
    for (const indicator of this.stressIndicators.values()) {
      // Add small random fluctuation
      const fluctuation = (Math.random() - 0.5) * 5;
      const newValue = Math.max(0, indicator.value + fluctuation);
      this.updateStressIndicator(indicator.name, newValue);
    }
  }

  getStressIndicators(): StressIndicator[] {
    return Array.from(this.stressIndicators.values());
  }

  getOverallStressLevel(): {
    level: 'low' | 'moderate' | 'high' | 'critical';
    score: number;
    criticalIndicators: string[];
  } {
    const indicators = Array.from(this.stressIndicators.values());
    const criticalIndicators = indicators.filter(i => i.status === 'critical').map(i => i.name);
    const highIndicators = indicators.filter(i => i.status === 'high').length;
    const elevatedIndicators = indicators.filter(i => i.status === 'elevated').length;

    let score = 100;
    score -= criticalIndicators.length * 30;
    score -= highIndicators * 15;
    score -= elevatedIndicators * 5;
    score = Math.max(0, score);

    let level: 'low' | 'moderate' | 'high' | 'critical';
    if (criticalIndicators.length > 0 || score < 30) {
      level = 'critical';
    } else if (highIndicators > 0 || score < 50) {
      level = 'high';
    } else if (elevatedIndicators > 0 || score < 70) {
      level = 'moderate';
    } else {
      level = 'low';
    }

    return { level, score, criticalIndicators };
  }

  // ============================================================================
  // Portfolio Management (for testing)
  // ============================================================================

  setPortfolioValue(value: number): void {
    this.portfolioValue = value;
  }

  setPositions(positions: typeof this.positions): void {
    this.positions = positions;
  }

  addPosition(position: typeof this.positions[0]): void {
    this.positions.push(position);
  }

  clearPositions(): void {
    this.positions = [];
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  getTestResults(limit: number = 50): StressTestResult[] {
    return this.testResults.slice(-limit);
  }

  getMonteCarloResults(limit: number = 10): MonteCarloResult[] {
    return this.monteCarloResults.slice(-limit);
  }

  generateReport(): {
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      passRate: number;
    };
    worstScenarios: StressTestResult[];
    riskMetrics: {
      avgVar95: number;
      avgVar99: number;
      avgMaxDrawdown: number;
    };
    stressLevel: {
      level: 'low' | 'moderate' | 'high' | 'critical';
      score: number;
      criticalIndicators: string[];
    };
    recommendations: string[];
  } {
    const passedTests = this.testResults.filter(r => r.passed).length;
    const failedTests = this.testResults.filter(r => !r.passed).length;

    const worstScenarios = [...this.testResults]
      .sort((a, b) => b.maxDrawdownPercent - a.maxDrawdownPercent)
      .slice(0, 5);

    const avgVar95 = this.testResults.length > 0
      ? this.testResults.reduce((sum, r) => sum + r.var95, 0) / this.testResults.length
      : 0;
    const avgVar99 = this.testResults.length > 0
      ? this.testResults.reduce((sum, r) => sum + r.var99, 0) / this.testResults.length
      : 0;
    const avgMaxDrawdown = this.testResults.length > 0
      ? this.testResults.reduce((sum, r) => sum + r.maxDrawdownPercent, 0) / this.testResults.length
      : 0;

    const recommendations: string[] = [];
    if (failedTests > passedTests) {
      recommendations.push('Portfolio is highly vulnerable to stress scenarios - consider reducing risk');
    }
    if (avgMaxDrawdown > 30) {
      recommendations.push('Average max drawdown is high - implement tighter risk controls');
    }
    if (avgVar99 > this.portfolioValue * 0.2) {
      recommendations.push('99% VaR exceeds 20% of portfolio - reduce position sizes');
    }

    return {
      summary: {
        totalTests: this.testResults.length,
        passedTests,
        failedTests,
        passRate: this.testResults.length > 0 ? (passedTests / this.testResults.length) * 100 : 0,
      },
      worstScenarios,
      riskMetrics: {
        avgVar95,
        avgVar99,
        avgMaxDrawdown,
      },
      stressLevel: this.getOverallStressLevel(),
      recommendations,
    };
  }

  getConfig(): StressTestConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<StressTestConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[StressTestingFramework] Configuration updated');
    this.emit('config_updated', this.config);
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.testResults = [];
    this.monteCarloResults = [];
    this.positions = [];
    this.portfolioValue = 100000;
    this.initializeStressIndicators();
    console.log('[StressTestingFramework] Reset complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let stressTestingInstance: StressTestingFramework | null = null;

export function getStressTestingFramework(config?: Partial<StressTestConfig>): StressTestingFramework {
  if (!stressTestingInstance) {
    stressTestingInstance = new StressTestingFramework(config);
  }
  return stressTestingInstance;
}

export function resetStressTestingFramework(): void {
  if (stressTestingInstance) {
    stressTestingInstance.stop();
    stressTestingInstance = null;
  }
}
