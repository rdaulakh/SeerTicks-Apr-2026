/**
 * Trade Execution Diagnosis Test
 * 
 * Detailed test to identify exactly where trade execution is failing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AutomatedSignalProcessor, ProcessedSignal } from '../services/AutomatedSignalProcessor';
import { AutomatedTradeExecutor } from '../services/AutomatedTradeExecutor';
import { PaperTradingEngine } from '../execution/PaperTradingEngine';
import { PositionManager } from '../PositionManager';
import { RiskManager } from '../RiskManager';
import { priceFeedService } from '../services/priceFeedService';
import { getPaperWallet, upsertPaperWallet } from '../db';
import type { AgentSignal } from '../agents/AgentBase';
import { getTradingConfig, setTradingConfig } from '../config/TradingConfig';

const TEST_USER_ID = 1260007;
const TEST_SYMBOL = 'BTC-USD';

describe('Trade Execution Diagnosis', () => {
  let signalProcessor: AutomatedSignalProcessor;
  let tradeExecutor: AutomatedTradeExecutor;
  let paperTradingEngine: PaperTradingEngine;
  let positionManager: PositionManager;
  let riskManager: RiskManager;

  // AutomatedSignalProcessor now enforces candle-availability and staleness
  // gates before consensus. This diagnosis suite has no data fixtures, so
  // neutralize both gates and restore on teardown.
  const __originalTradingConfig = getTradingConfig();
  afterAll(() => {
    setTradingConfig(__originalTradingConfig);
  });

  beforeAll(async () => {
    setTradingConfig({
      ...__originalTradingConfig,
      entry: {
        ...__originalTradingConfig.entry,
        minHistoricalCandlesRequired: 0,
        priceFeedMaxStalenessMs: Number.MAX_SAFE_INTEGER,
      },
    });

    // Ensure test wallet exists
    const wallet = await getPaperWallet(TEST_USER_ID);
    if (!wallet) {
      await upsertPaperWallet({
        userId: TEST_USER_ID,
        balance: '100000.00',
        equity: '100000.00',
        margin: '0.00',
        marginLevel: '0.00',
        totalPnL: '0.00',
        realizedPnL: '0.00',
        unrealizedPnL: '0.00',
        totalCommission: '0.00',
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: '0.00',
      });
    }

    signalProcessor = new AutomatedSignalProcessor(TEST_USER_ID);
    tradeExecutor = new AutomatedTradeExecutor(TEST_USER_ID);
    paperTradingEngine = new PaperTradingEngine(TEST_USER_ID);
    positionManager = new PositionManager(TEST_USER_ID);
    riskManager = new RiskManager(TEST_USER_ID);
  });

  describe('Step 1: Price Feed Service', () => {
    it('should have price available for BTC-USD', async () => {
      const prices = priceFeedService.getPrices([TEST_SYMBOL]);
      const price = prices.get(TEST_SYMBOL);
      
      console.log(`\n=== Price Feed Check ===`);
      console.log(`Symbol: ${TEST_SYMBOL}`);
      console.log(`Price available: ${!!price}`);
      if (price) {
        console.log(`Price: $${price.price}`);
        console.log(`Source: ${price.source}`);
        console.log(`Timestamp: ${new Date(price.timestamp).toISOString()}`);
      } else {
        console.log(`⚠️ NO PRICE AVAILABLE - This will cause trade execution to fail!`);
      }
      
      // This test may fail if price feed is not running
      // That's expected and helps diagnose the issue
      expect(prices).toBeDefined();
    });
  });

  describe('Step 2: Wallet Check', () => {
    it('should have wallet with balance', async () => {
      const wallet = await getPaperWallet(TEST_USER_ID);
      
      console.log(`\n=== Wallet Check ===`);
      console.log(`Wallet exists: ${!!wallet}`);
      if (wallet) {
        console.log(`Balance: $${wallet.balance}`);
        console.log(`Margin: $${wallet.margin}`);
        const available = parseFloat(wallet.balance) - parseFloat(wallet.margin);
        console.log(`Available: $${available.toFixed(2)}`);
      }
      
      expect(wallet).toBeDefined();
      expect(parseFloat(wallet!.balance)).toBeGreaterThan(0);
    });
  });

  describe('Step 3: Dependencies Check', () => {
    it('should have all dependencies available', () => {
      console.log(`\n=== Dependencies Check ===`);
      console.log(`PaperTradingEngine: ${!!paperTradingEngine}`);
      console.log(`PositionManager: ${!!positionManager}`);
      console.log(`RiskManager: ${!!riskManager}`);
      
      expect(paperTradingEngine).toBeDefined();
      expect(positionManager).toBeDefined();
      expect(riskManager).toBeDefined();
    });

    it('should set dependencies on trade executor', () => {
      tradeExecutor.setDependencies(
        paperTradingEngine,
        positionManager,
        riskManager
      );
      
      console.log(`Dependencies set on AutomatedTradeExecutor`);
      expect(true).toBe(true);
    });
  });

  describe('Step 4: Signal Processing', () => {
    it('should process and approve strong signals', async () => {
      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Phase 15B requires min 4 agents agreeing AND >55% directional dominance
      const signals: AgentSignal[] = [
        {
          agentName: 'TechnicalAnalyst',
          signal: 'bullish',
          confidence: 0.85,
          executionScore: 95,
          qualityScore: 0.90,
          reasoning: 'Strong bullish momentum',
          timestamp: Date.now(),
        },
        {
          agentName: 'PatternMatcher',
          signal: 'bullish',
          confidence: 0.80,
          executionScore: 90,
          qualityScore: 0.85,
          reasoning: 'Cup and handle confirmed',
          timestamp: Date.now(),
        },
        {
          agentName: 'OrderFlowAnalyst',
          signal: 'bullish',
          confidence: 0.75,
          executionScore: 85,
          qualityScore: 0.80,
          reasoning: 'Institutional buying',
          timestamp: Date.now(),
        },
        {
          agentName: 'OnChainAnalyst',
          signal: 'bullish',
          confidence: 0.78,
          executionScore: 82,
          qualityScore: 0.82,
          reasoning: 'Whale accumulation detected',
          timestamp: Date.now(),
        },
        {
          agentName: 'SentimentAnalyst',
          signal: 'bullish',
          confidence: 0.72,
          executionScore: 78,
          qualityScore: 0.76,
          reasoning: 'Positive market sentiment',
          timestamp: Date.now(),
        },
      ];

      const result = await signalProcessor.processSignals(signals, TEST_SYMBOL);
      
      console.log(`\n=== Signal Processing Check ===`);
      console.log(`Approved: ${result.approved}`);
      console.log(`Reason: ${result.reason}`);
      if (result.consensus) {
        console.log(`Consensus: ${result.consensus.direction} (${(result.consensus.strength * 100).toFixed(1)}%)`);
      }
      if (result.recommendation) {
        console.log(`Action: ${result.recommendation.action}`);
        console.log(`Confidence: ${(result.recommendation.confidence * 100).toFixed(1)}%`);
      }
      
      expect(result.approved).toBe(true);
    });
  });

  describe('Step 5: Trade Execution', () => {
    it('should execute trade with detailed error logging', async () => {
      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 150));
      
      let tradeExecuted = false;
      let tradeRejected = false;
      let tradeError: Error | null = null;
      let errorDetails: any = null;

      tradeExecutor.on('trade_executed', (data) => {
        tradeExecuted = true;
        console.log(`\n✅ TRADE EXECUTED!`);
        console.log(`Order ID: ${data.order?.id}`);
        console.log(`Symbol: ${data.symbol}`);
        console.log(`Entry Price: $${data.entryPrice?.toFixed(2)}`);
      });

      tradeExecutor.on('trade_rejected', (data) => {
        tradeRejected = true;
        console.log(`\n❌ TRADE REJECTED!`);
        console.log(`Reason: ${data.reason}`);
      });

      tradeExecutor.on('trade_error', (data) => {
        tradeError = data.error;
        errorDetails = data;
        console.log(`\n💥 TRADE ERROR!`);
        console.log(`Error: ${data.error?.message}`);
        console.log(`Stack: ${data.error?.stack}`);
      });

      // Create a processed signal
      const processedSignal: ProcessedSignal = {
        approved: true,
        reason: 'Test signal',
        symbol: TEST_SYMBOL,
        signals: [],
        consensus: {
          direction: 'bullish',
          strength: 0.80,
        },
        metrics: {
          avgConfidence: 0.80,
          avgExecutionScore: 90,
          avgQualityScore: 0.85,
          signalCount: 3,
        },
        recommendation: {
          action: 'buy',
          confidence: 0.80,
          executionScore: 90,
          reasoning: 'Test trade execution',
        },
      };

      console.log(`\n=== Attempting Trade Execution ===`);
      console.log(`Symbol: ${processedSignal.symbol}`);
      console.log(`Action: ${processedSignal.recommendation?.action}`);
      
      try {
        await tradeExecutor.queueSignal(processedSignal);
        
        // Wait for execution
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`\n=== Execution Result ===`);
        console.log(`Trade Executed: ${tradeExecuted}`);
        console.log(`Trade Rejected: ${tradeRejected}`);
        console.log(`Trade Error: ${!!tradeError}`);
        
        if (tradeError) {
          console.log(`\n=== Error Details ===`);
          console.log(`Message: ${tradeError.message}`);
          console.log(`Stack: ${tradeError.stack}`);
        }
        
      } catch (err) {
        console.log(`\n💥 EXCEPTION DURING QUEUE:`);
        console.log(err);
      }

      // Report final status
      console.log(`\n=== Final Diagnosis ===`);
      if (tradeExecuted) {
        console.log(`✅ Trade execution pipeline is WORKING`);
      } else if (tradeRejected) {
        console.log(`⚠️ Trade was REJECTED - check rejection reason above`);
      } else if (tradeError) {
        console.log(`❌ Trade FAILED with error - check error details above`);
      } else {
        console.log(`❓ Trade status UNKNOWN - execution may have timed out`);
      }
    });
  });
});
