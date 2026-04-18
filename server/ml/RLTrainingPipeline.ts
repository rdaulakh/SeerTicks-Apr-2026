/**
 * RL Training Pipeline
 * 
 * Manages training of DQN and PPO agents on historical market data
 * with paper trading validation.
 */

import { DQNAgent } from './rl/DQNAgent';
import { PPOAgent } from './rl/PPOAgent';
import { RLTradingEnvironment, MarketState } from './rl/RLTradingEnvironment';
import { getDb } from '../db';
import { and, gte, lte, eq, asc, sql } from 'drizzle-orm';
import { priceHistory, historicalCandles } from '../../drizzle/schema';
import { EventEmitter } from 'events';

export interface TrainingConfig {
  episodes: number;
  maxStepsPerEpisode: number;
  validationSplit: number; // Percentage of data for validation
  earlyStoppingPatience: number;
  checkpointFrequency: number; // Save every N episodes
  paperTradingValidation: boolean;
}

export interface TrainingProgress {
  episode: number;
  totalEpisodes: number;
  reward: number;
  avgReward: number;
  epsilon?: number;
  loss?: number;
  validationReward?: number;
  pnl: number;
  winRate: number;
  sharpe: number;
}

export interface TrainingResult {
  agentType: 'dqn' | 'ppo';
  episodes: number;
  finalReward: number;
  avgReward: number;
  bestReward: number;
  finalPnL: number;
  winRate: number;
  sharpe: number;
  trainingTime: number;
  modelWeights?: string;
}

export interface HistoricalCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class RLTrainingPipeline extends EventEmitter {
  private static instance: RLTrainingPipeline;
  private dqnAgent: DQNAgent | null = null;
  private ppoAgent: PPOAgent | null = null;
  private isTraining: boolean = false;
  private trainingHistory: TrainingResult[] = [];
  private config: TrainingConfig;

  private constructor() {
    super();
    this.config = {
      episodes: 100,
      maxStepsPerEpisode: 1000,
      validationSplit: 0.2,
      earlyStoppingPatience: 10,
      checkpointFrequency: 10,
      paperTradingValidation: true
    };
  }

  static getInstance(): RLTrainingPipeline {
    if (!RLTrainingPipeline.instance) {
      RLTrainingPipeline.instance = new RLTrainingPipeline();
    }
    return RLTrainingPipeline.instance;
  }

  /**
   * Load historical OHLCV data from database
   */
  async loadHistoricalData(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<HistoricalCandle[]> {
    try {
      const db = await getDb();
      if (!db) {
        console.warn('[RLTrainingPipeline] Database not available, using synthetic data');
        return this.generateSyntheticData(1000);
      }

      const startMs = startDate.getTime();
      const endMs = endDate.getTime();

      // Primary source: priceHistory table (bigint ms timestamps, Drizzle ORM)
      const phRows = await db
        .select()
        .from(priceHistory)
        .where(
          and(
            eq(priceHistory.symbol, symbol),
            gte(priceHistory.timestamp, startMs),
            lte(priceHistory.timestamp, endMs)
          )
        )
        .orderBy(asc(priceHistory.timestamp))
        .limit(10000);

      if (phRows.length >= 100) {
        console.log(`[RLTrainingPipeline] Loaded ${phRows.length} candles from priceHistory for ${symbol}`);
        return phRows.map(row => ({
          timestamp: new Date(row.timestamp),
          open: parseFloat(row.open),
          high: parseFloat(row.high),
          low: parseFloat(row.low),
          close: parseFloat(row.close),
          volume: parseFloat(row.volume)
        }));
      }

      // Fallback: historicalCandles table (timestamp column, Drizzle ORM)
      const hcRows = await db
        .select()
        .from(historicalCandles)
        .where(
          and(
            eq(historicalCandles.symbol, symbol),
            gte(historicalCandles.timestamp, startDate),
            lte(historicalCandles.timestamp, endDate)
          )
        )
        .orderBy(asc(historicalCandles.timestamp))
        .limit(10000);

      if (hcRows.length >= 100) {
        console.log(`[RLTrainingPipeline] Loaded ${hcRows.length} candles from historicalCandles for ${symbol}`);
        return hcRows.map(row => ({
          timestamp: new Date(row.timestamp),
          open: parseFloat(row.open),
          high: parseFloat(row.high),
          low: parseFloat(row.low),
          close: parseFloat(row.close),
          volume: parseFloat(row.volume)
        }));
      }

      console.warn(`[RLTrainingPipeline] Insufficient historical data (priceHistory: ${phRows.length}, historicalCandles: ${hcRows.length}), using synthetic data`);
      return this.generateSyntheticData(1000);
    } catch (error) {
      console.warn('[RLTrainingPipeline] Failed to load historical data:', error);
      return this.generateSyntheticData(1000);
    }
  }

  /**
   * Generate regime-aware synthetic market data for training when real data unavailable.
   * Produces three distinct regime types that cycle randomly:
   *   - trending: price follows a persistent drift (momentum)
   *   - ranging:  price mean-reverts around a slow-moving anchor
   *   - volatile: wide high-low spreads and large candle bodies
   */
  private generateSyntheticData(count: number): HistoricalCandle[] {
    const candles: HistoricalCandle[] = [];
    let price = 50000; // Starting price (BTC-like)
    const now = new Date();

    // Regime state
    type Regime = 'trending' | 'ranging' | 'volatile';
    const regimes: Regime[] = ['trending', 'ranging', 'volatile'];
    let currentRegime: Regime = regimes[Math.floor(Math.random() * regimes.length)];
    let regimeLength = 50 + Math.floor(Math.random() * 51); // 50-100 candles per phase
    let regimeCounter = 0;

    // Trending regime state
    let trendDirection = Math.random() > 0.5 ? 1 : -1;
    const trendDrift = 0.0008; // ~0.08% per candle drift

    // Ranging regime state
    let rangeMean = price;

    // Base volume level
    const baseVolume = 500;

    for (let i = 0; i < count; i++) {
      // Check if we should switch regimes
      if (regimeCounter >= regimeLength) {
        regimeCounter = 0;
        regimeLength = 50 + Math.floor(Math.random() * 51);
        currentRegime = regimes[Math.floor(Math.random() * regimes.length)];
        // Re-randomize regime-specific state on switch
        trendDirection = Math.random() > 0.5 ? 1 : -1;
        rangeMean = price;
      }
      regimeCounter++;

      let change: number;
      let spreadMultiplier: number; // Controls high-low range
      let volumeMultiplier: number;

      switch (currentRegime) {
        case 'trending': {
          // Persistent drift + small noise
          const drift = trendDirection * trendDrift;
          const noise = (Math.random() - 0.5) * 0.008;
          change = drift + noise;
          spreadMultiplier = 1.0;
          volumeMultiplier = 1.0 + Math.random() * 0.3; // Slightly above-average volume
          break;
        }
        case 'ranging': {
          // Mean-reverting: pull toward rangeMean with noise
          const reversion = (rangeMean - price) / price * 0.05; // 5% reversion strength
          const noise = (Math.random() - 0.5) * 0.012;
          change = reversion + noise;
          spreadMultiplier = 0.7; // Tighter candles
          volumeMultiplier = 0.6 + Math.random() * 0.4; // Lower volume
          break;
        }
        case 'volatile': {
          // Large moves, wide spreads
          const noise = (Math.random() - 0.5) * 0.04; // 4% noise
          const spike = Math.random() < 0.1 ? (Math.random() - 0.5) * 0.06 : 0; // Occasional 6% spike
          change = noise + spike;
          spreadMultiplier = 2.5; // Wide wicks
          volumeMultiplier = 1.5 + Math.random() * 1.5; // High volume
          break;
        }
      }

      const open = price;
      const close = price * (1 + change);
      // High and low extend beyond open/close by a spread factor
      const baseSpread = Math.abs(close - open) * 0.3 + price * 0.001;
      const high = Math.max(open, close) + baseSpread * spreadMultiplier * Math.random();
      const low = Math.min(open, close) - baseSpread * spreadMultiplier * Math.random();
      const volume = baseVolume * volumeMultiplier;

      candles.push({
        timestamp: new Date(now.getTime() - (count - i) * 60000), // 1-minute candles
        open,
        high: Math.max(high, Math.max(open, close)), // Ensure high >= max(open,close)
        low: Math.min(low, Math.min(open, close)),    // Ensure low  <= min(open,close)
        close,
        volume
      });

      price = close;
    }

    return candles;
  }

  /**
   * Calculate Exponential Moving Average for a series of values.
   * Returns an array of EMA values the same length as the input.
   * The first value is seeded with the simple average of the first `period` values.
   */
  private calculateEMA(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const ema: number[] = new Array(values.length);
    const k = 2 / (period + 1);

    // Seed: SMA of the first `period` values (or all values if fewer)
    const seedLen = Math.min(period, values.length);
    let seed = 0;
    for (let i = 0; i < seedLen; i++) seed += values[i];
    seed /= seedLen;
    ema[0] = seed;

    for (let i = 1; i < values.length; i++) {
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }

  /**
   * Convert historical candles to market states for RL environment
   */
  private candlesToMarketStates(candles: HistoricalCandle[]): MarketState[] {
    const states: MarketState[] = [];
    // Need at least 26 candles for EMA(26) used in MACD, plus 9 for signal line
    const lookback = 35;

    // Pre-compute MACD across the entire candle array so we have a signal line
    const allCloses = candles.map(c => c.close);
    const ema12 = this.calculateEMA(allCloses, 12);
    const ema26 = this.calculateEMA(allCloses, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const macdSignalLine = this.calculateEMA(macdLine, 9);

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(i - lookback, i + 1);
      const current = candles[i];
      const prev = candles[i - 1];

      // Calculate simple indicators
      const prices = window.map(c => c.close);
      const sma20 = prices.reduce((a, b) => a + b, 0) / prices.length;
      const returns = prices.slice(1).map((p, idx) => (p - prices[idx]) / prices[idx]);
      const volatility = Math.sqrt(returns.reduce((a, b) => a + b * b, 0) / returns.length);

      // Calculate RSI
      const gains = returns.filter(r => r > 0);
      const losses = returns.filter(r => r < 0).map(r => Math.abs(r));
      const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
      const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
      const rsi = 100 - (100 / (1 + rs));

      // --- MACD (pre-computed above, normalized by price) ---
      const macdVal = macdLine[i] / current.close;
      const macdSigVal = macdSignalLine[i] / current.close;

      // --- Bollinger Band position ---
      // Use the last 20 closes from the window for BB calculation
      const bbPrices = prices.slice(-20);
      const bbSma = bbPrices.reduce((a, b) => a + b, 0) / bbPrices.length;
      const bbVariance = bbPrices.reduce((a, p) => a + (p - bbSma) ** 2, 0) / bbPrices.length;
      const bbStd = Math.sqrt(bbVariance);
      const upperBand = bbSma + 2 * bbStd;
      const lowerBand = bbSma - 2 * bbStd;
      const bbRange = upperBand - lowerBand;
      const bbPosition = bbRange > 0
        ? Math.max(0, Math.min(1, (current.close - lowerBand) / bbRange))
        : 0.5;

      // --- Volume Delta (current volume vs window average) ---
      const volumes = window.map(c => c.volume);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const volumeDelta = avgVolume > 0 ? (current.volume / avgVolume) - 1 : 0;

      // --- Order Imbalance (approximated from candle body vs range) ---
      const bodySize = Math.abs(current.close - current.open);
      const totalRange = current.high - current.low;
      let orderImbalance = 0;
      if (totalRange > 0) {
        const pressure = bodySize / totalRange;
        orderImbalance = current.close >= current.open ? pressure : -pressure;
      }

      states.push({
        prices: window.map(c => c.close / current.close - 1),
        returns: returns,
        volume: window.map(c => c.volume / (window.reduce((a, b) => a + b.volume, 0) / window.length) - 1),
        rsi: rsi / 100,
        macd: macdVal,
        macdSignal: macdSigVal,
        bbPosition,
        atr: volatility,
        volumeDelta,
        orderImbalance,
        hasPosition: false,
        positionSide: 0,
        positionSize: 0,
        unrealizedPnL: 0,
        holdingTime: 0,
        equity: 1,
        drawdown: 0,
        volatilityRegime: volatility > 0.02 ? 1 : volatility > 0.01 ? 0.5 : 0,
        trendStrength: (current.close - window[0].close) / window[0].close
      });
    }

    return states;
  }

  /**
   * Train DQN agent
   */
  async trainDQN(
    symbol: string = 'BTC-USD',
    config?: Partial<TrainingConfig>,
    onProgress?: (progress: TrainingProgress) => void
  ): Promise<TrainingResult> {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }

    this.isTraining = true;
    const startTime = Date.now();
    const trainingConfig = { ...this.config, ...config };

    console.log('[RLTrainingPipeline] Starting DQN training...');
    this.emit('training_started', { agentType: 'dqn', config: trainingConfig });

    try {
      // Load historical data
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
      const candles = await this.loadHistoricalData(symbol, startDate, endDate);
      const marketStates = this.candlesToMarketStates(candles);

      console.log(`[RLTrainingPipeline] Loaded ${marketStates.length} market states for training`);

      // Split into training and validation
      const splitIdx = Math.floor(marketStates.length * (1 - trainingConfig.validationSplit));
      const trainingStates = marketStates.slice(0, splitIdx);
      const validationStates = marketStates.slice(splitIdx);

      // Create environment and agent
      const env = new RLTradingEnvironment({
        initialBalance: 100000,
        maxPositionSize: 1.0,
        transactionCost: 0.001,
        slippageBps: 5
      });

      this.dqnAgent = new DQNAgent({
        stateSize: RLTradingEnvironment.STATE_DIM,
        actionSize: RLTradingEnvironment.ACTION_DIM,
        hiddenLayers: [128, 64, 32],
        learningRate: 0.001,
        gamma: 0.99,
        epsilon: 1.0,
        epsilonMin: 0.01,
        epsilonDecay: 0.995,
        batchSize: 64,
        replayBufferSize: 10000,
        targetUpdateFrequency: 100,
        doubleDQN: true
      });

      // Training loop
      const episodeRewards: number[] = [];
      let bestReward = -Infinity;
      let noImprovementCount = 0;

      for (let episode = 0; episode < trainingConfig.episodes; episode++) {
        // Reset environment with random starting point
        const startIdx = Math.floor(Math.random() * (trainingStates.length - trainingConfig.maxStepsPerEpisode));
        env.reset(startIdx);

        let episodeReward = 0;
        let steps = 0;

        // Episode loop
        while (steps < trainingConfig.maxStepsPerEpisode && startIdx + steps < trainingStates.length - 1) {
          const state = env.getState();
          const stateVector = env.stateToArray(state);
          
          // Select action
          const actionIdx = this.dqnAgent.selectAction(stateVector, true);
          const action = this.dqnAgent.actionIndexToAction(actionIdx);

          // Take step
          const nextMarketState = trainingStates[startIdx + steps + 1];
          const result = env.step(action);

          // Store experience
          const nextStateVector = env.stateToArray(result.state);
          this.dqnAgent.remember(stateVector, actionIdx, result.reward, nextStateVector, result.done);

          // Train
          this.dqnAgent.train();

          episodeReward += result.reward;
          steps++;

          if (result.done) break;
        }

        episodeRewards.push(episodeReward);
        const avgReward = episodeRewards.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, episodeRewards.length);

        // Get episode info
        // Get episode info from last step result
        const lastStepResult = env.step({ type: 'hold' });
        const info = {
          totalPnL: lastStepResult.info.pnl,
          winRate: lastStepResult.info.winRate,
          sharpeRatio: lastStepResult.info.sharpeRatio
        };

        // Progress callback
        if (onProgress) {
          onProgress({
            episode: episode + 1,
            totalEpisodes: trainingConfig.episodes,
            reward: episodeReward,
            avgReward,
            epsilon: (this.dqnAgent as any).config?.epsilon,
            pnl: info.totalPnL,
            winRate: info.winRate,
            sharpe: info.sharpeRatio
          });
        }

        this.emit('episode_completed', {
          episode: episode + 1,
          reward: episodeReward,
          avgReward,
          info
        });

        // Early stopping check
        if (avgReward > bestReward) {
          bestReward = avgReward;
          noImprovementCount = 0;
        } else {
          noImprovementCount++;
          if (noImprovementCount >= trainingConfig.earlyStoppingPatience) {
            console.log(`[RLTrainingPipeline] Early stopping at episode ${episode + 1}`);
            break;
          }
        }

        // Checkpoint
        if ((episode + 1) % trainingConfig.checkpointFrequency === 0) {
          await this.saveCheckpoint('dqn', episode + 1);
        }
      }

      // Final validation
      let validationReward = 0;
      if (trainingConfig.paperTradingValidation && validationStates.length > 0) {
        validationReward = await this.validateAgent(this.dqnAgent, validationStates, env);
      }

      const trainingTime = Date.now() - startTime;
      const finalStepResult = env.step({ type: 'hold' });
      const finalInfo = {
        totalPnL: finalStepResult.info.pnl,
        winRate: finalStepResult.info.winRate,
        sharpeRatio: finalStepResult.info.sharpeRatio
      };

      const result: TrainingResult = {
        agentType: 'dqn',
        episodes: episodeRewards.length,
        finalReward: episodeRewards[episodeRewards.length - 1] || 0,
        avgReward: episodeRewards.reduce((a, b) => a + b, 0) / episodeRewards.length,
        bestReward,
        finalPnL: finalInfo.totalPnL,
        winRate: finalInfo.winRate,
        sharpe: finalInfo.sharpeRatio,
        trainingTime
      };

      this.trainingHistory.push(result);
      await this.saveTrainingResult(result);

      console.log('[RLTrainingPipeline] DQN training completed');
      console.log(`  Episodes: ${result.episodes}`);
      console.log(`  Best Reward: ${result.bestReward.toFixed(2)}`);
      console.log(`  Final P&L: $${result.finalPnL.toFixed(2)}`);
      console.log(`  Win Rate: ${(result.winRate * 100).toFixed(1)}%`);

      this.emit('training_completed', result);

      return result;
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Train PPO agent
   */
  async trainPPO(
    symbol: string = 'BTC-USD',
    config?: Partial<TrainingConfig>,
    onProgress?: (progress: TrainingProgress) => void
  ): Promise<TrainingResult> {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }

    this.isTraining = true;
    const startTime = Date.now();
    const trainingConfig = { ...this.config, ...config };

    console.log('[RLTrainingPipeline] Starting PPO training...');
    this.emit('training_started', { agentType: 'ppo', config: trainingConfig });

    try {
      // Load historical data
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      const candles = await this.loadHistoricalData(symbol, startDate, endDate);
      const marketStates = this.candlesToMarketStates(candles);

      // Split data
      const splitIdx = Math.floor(marketStates.length * (1 - trainingConfig.validationSplit));
      const trainingStates = marketStates.slice(0, splitIdx);
      const validationStates = marketStates.slice(splitIdx);

      // Create environment and agent
      const env = new RLTradingEnvironment({
        initialBalance: 100000,
        maxPositionSize: 1.0,
        transactionCost: 0.001,
        slippageBps: 5
      });

      this.ppoAgent = new PPOAgent({
        stateSize: RLTradingEnvironment.STATE_DIM,
        actionSize: RLTradingEnvironment.ACTION_DIM,
        hiddenLayers: [128, 64],
        learningRate: 0.0003,
        gamma: 0.99,
        lambda: 0.95,
        clipEpsilon: 0.2,
        valueCoef: 0.5,
        entropyCoef: 0.01,
        batchSize: 64,
        epochs: 10,
        rolloutLength: 2048
      });

      // Training loop
      const episodeRewards: number[] = [];
      let bestReward = -Infinity;

      for (let episode = 0; episode < trainingConfig.episodes; episode++) {
        const startIdx = Math.floor(Math.random() * (trainingStates.length - trainingConfig.maxStepsPerEpisode));
        env.reset(startIdx);

        let episodeReward = 0;
        let steps = 0;

        while (steps < trainingConfig.maxStepsPerEpisode && startIdx + steps < trainingStates.length - 1) {
          const state = env.getState();
          const stateVector = env.stateToArray(state);
          
          const actionResult = this.ppoAgent.selectAction(stateVector);
          const actionIdx = typeof actionResult === 'number' ? actionResult : actionResult.action;
          const action = this.ppoAgent.actionIndexToAction(actionIdx);

          const nextMarketState = trainingStates[startIdx + steps + 1];
          const result = env.step(action);

          const nextStateVector = env.stateToArray(result.state);
          const value = this.ppoAgent.getValue(stateVector);
          const logProb = Math.log(this.ppoAgent.getActionProbs(stateVector)[actionIdx] + 1e-8);
          this.ppoAgent.storeTransition(stateVector, actionIdx, result.reward, value, logProb, result.done);

          episodeReward += result.reward;
          steps++;

          if (result.done) break;
        }

        // PPO update at end of episode
        const lastValue = this.ppoAgent.getValue(env.stateToArray(env.getState()));
        const lossResult = this.ppoAgent.update(lastValue);
        const loss = lossResult.policyLoss;

        episodeRewards.push(episodeReward);
        const avgReward = episodeRewards.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, episodeRewards.length);

        // Get episode info from last step result
        const lastStepResult = env.step({ type: 'hold' });
        const info = {
          totalPnL: lastStepResult.info.pnl,
          winRate: lastStepResult.info.winRate,
          sharpeRatio: lastStepResult.info.sharpeRatio
        };

        if (onProgress) {
          onProgress({
            episode: episode + 1,
            totalEpisodes: trainingConfig.episodes,
            reward: episodeReward,
            avgReward,
            loss,
            pnl: info.totalPnL,
            winRate: info.winRate,
            sharpe: info.sharpeRatio
          });
        }

        if (avgReward > bestReward) {
          bestReward = avgReward;
        }

        if ((episode + 1) % trainingConfig.checkpointFrequency === 0) {
          await this.saveCheckpoint('ppo', episode + 1);
        }
      }

      // Validation
      let validationReward = 0;
      if (trainingConfig.paperTradingValidation && validationStates.length > 0) {
        validationReward = await this.validateAgent(this.ppoAgent, validationStates, env);
      }

      const trainingTime = Date.now() - startTime;
      const finalStepResult = env.step({ type: 'hold' });
      const finalInfo = {
        totalPnL: finalStepResult.info.pnl,
        winRate: finalStepResult.info.winRate,
        sharpeRatio: finalStepResult.info.sharpeRatio
      };

      const result: TrainingResult = {
        agentType: 'ppo',
        episodes: episodeRewards.length,
        finalReward: episodeRewards[episodeRewards.length - 1] || 0,
        avgReward: episodeRewards.reduce((a, b) => a + b, 0) / episodeRewards.length,
        bestReward,
        finalPnL: finalInfo.totalPnL,
        winRate: finalInfo.winRate,
        sharpe: finalInfo.sharpeRatio,
        trainingTime
      };

      this.trainingHistory.push(result);
      await this.saveTrainingResult(result);

      console.log('[RLTrainingPipeline] PPO training completed');
      this.emit('training_completed', result);

      return result;
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Validate agent on held-out data
   */
  private async validateAgent(
    agent: DQNAgent | PPOAgent,
    validationStates: MarketState[],
    env: RLTradingEnvironment
  ): Promise<number> {
    env.reset(0);
    let totalReward = 0;

    for (let i = 1; i < Math.min(validationStates.length, 500); i++) {
      const state = env.getState();
      const stateVector = env.stateToArray(state);
      
      const actionResult = agent.selectAction(stateVector, false); // No exploration
      const actionIdx = typeof actionResult === 'number' ? actionResult : actionResult.action;
      const action = agent.actionIndexToAction(actionIdx);

      const result = env.step(action);
      totalReward += result.reward;

      if (result.done) break;
    }

    return totalReward;
  }

  /**
   * Save training checkpoint
   */
  private async saveCheckpoint(agentType: 'dqn' | 'ppo', episode: number): Promise<void> {
    try {
      const agent = agentType === 'dqn' ? this.dqnAgent : this.ppoAgent;
      if (!agent) return;

      const weights = agent.serialize();
      
      const db = await getDb();
      if (!db) return;

      await db.execute(sql`
        INSERT INTO rlModelCheckpoints (agentType, episode, weights, createdAt)
        VALUES (${agentType}, ${episode}, ${weights}, NOW())
        ON DUPLICATE KEY UPDATE weights = VALUES(weights), createdAt = NOW()
      `).catch(() => {});

      console.log(`[RLTrainingPipeline] Saved ${agentType} checkpoint at episode ${episode}`);
    } catch (error) {
      console.warn('[RLTrainingPipeline] Failed to save checkpoint:', error);
    }
  }

  /**
   * Save training result to database
   */
  private async saveTrainingResult(result: TrainingResult): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      await db.execute(sql`
        INSERT INTO rlTrainingHistory 
        (agentType, episodes, finalReward, avgReward, bestReward, finalPnL, winRate, sharpe, trainingTime, createdAt)
        VALUES (
          ${result.agentType}, ${result.episodes}, ${result.finalReward}, ${result.avgReward},
          ${result.bestReward}, ${result.finalPnL}, ${result.winRate}, ${result.sharpe},
          ${result.trainingTime}, NOW()
        )
      `).catch(() => {});
    } catch (error) {
      console.warn('[RLTrainingPipeline] Failed to save training result:', error);
    }
  }

  /**
   * Get trained DQN agent
   */
  getDQNAgent(): DQNAgent | null {
    return this.dqnAgent;
  }

  /**
   * Get trained PPO agent
   */
  getPPOAgent(): PPOAgent | null {
    return this.ppoAgent;
  }

  /**
   * Get training history
   */
  getTrainingHistory(): TrainingResult[] {
    return [...this.trainingHistory];
  }

  /**
   * Check if training is in progress
   */
  isTrainingInProgress(): boolean {
    return this.isTraining;
  }

  /**
   * Get training status
   */
  getStatus(): {
    isTraining: boolean;
    dqnTrained: boolean;
    ppoTrained: boolean;
    trainingHistory: TrainingResult[];
  } {
    return {
      isTraining: this.isTraining,
      dqnTrained: this.dqnAgent !== null,
      ppoTrained: this.ppoAgent !== null,
      trainingHistory: this.trainingHistory
    };
  }
}

export default RLTrainingPipeline;
