/**
 * Detailed Strategy Detection Test
 * Tests the accuracy of StrategyRouter's detection logic
 */

import { StrategyRouter, TradeRecommendation } from './server/execution/StrategyRouter';

interface TestCase {
  name: string;
  recommendation: TradeRecommendation;
  expectedStrategy: string;
  expectedCategory: string;
}

const testCases: TestCase[] = [
  {
    name: 'Scalping - High execution score',
    recommendation: {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 75,
      executionScore: 85,
      positionSize: 0.01,
      entryPrice: 50000,
      targetPrice: 50100,
      stopLoss: 49950,
      reasoning: 'High execution score for quick entry/exit',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'scalping',
    expectedCategory: 'timeframe',
  },
  {
    name: 'Day Trading - Moderate execution score',
    recommendation: {
      symbol: 'ETHUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 65,
      executionScore: 70,
      positionSize: 0.1,
      entryPrice: 3000,
      targetPrice: 3060,
      stopLoss: 2970,
      reasoning: 'Intraday momentum setup',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'day_trading',
    expectedCategory: 'timeframe',
  },
  {
    name: 'Swing Trading - Balanced signals',
    recommendation: {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 60,
      executionScore: 55,
      positionSize: 0.05,
      entryPrice: 50000,
      targetPrice: 51500,
      stopLoss: 49000,
      reasoning: 'Multi-day swing setup with support confirmation',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'swing_trading',
    expectedCategory: 'timeframe',
  },
  {
    name: 'Trend Trading - Strong uptrend',
    recommendation: {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 80,
      executionScore: 70,
      positionSize: 0.05,
      entryPrice: 50000,
      targetPrice: 53000,
      stopLoss: 48500,
      reasoning: 'Strong uptrend with high momentum',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'trend_trading',
    expectedCategory: 'pattern',
  },
  {
    name: 'Mean Reversion - Oversold in range',
    recommendation: {
      symbol: 'ETHUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 70,
      executionScore: 60,
      positionSize: 0.1,
      entryPrice: 3000,
      targetPrice: 3050,
      stopLoss: 2970,
      reasoning: 'Oversold RSI in ranging market, expecting bounce',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'mean_reversion',
    expectedCategory: 'pattern',
  },
  {
    name: 'Breakout Trading - Triangle breakout',
    recommendation: {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 75,
      executionScore: 65,
      positionSize: 0.05,
      entryPrice: 50000,
      targetPrice: 52000,
      stopLoss: 49200,
      reasoning: 'Triangle pattern breakout with volume confirmation',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'breakout_trading',
    expectedCategory: 'pattern',
  },
  {
    name: 'Pullback Trading - Buying the dip',
    recommendation: {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      action: 'buy',
      confidence: 70,
      executionScore: 60,
      positionSize: 0.05,
      entryPrice: 50000,
      targetPrice: 51500,
      stopLoss: 49300,
      reasoning: 'Pullback to support in uptrend',
      agentSignals: [],
      timestamp: new Date(),
    },
    expectedStrategy: 'pullback_trading',
    expectedCategory: 'pattern',
  },
];

async function runTests() {
  console.log('='.repeat(80));
  console.log('STRATEGY DETECTION ACCURACY TEST');
  console.log('='.repeat(80));
  console.log();

  const router = new StrategyRouter();
  let passCount = 0;
  let failCount = 0;

  for (const testCase of testCases) {
    const detected = router.detectStrategy(testCase.recommendation);
    const passed = detected.name === testCase.expectedStrategy;
    
    if (passed) {
      passCount++;
      console.log(`✅ PASS: ${testCase.name}`);
    } else {
      failCount++;
      console.log(`❌ FAIL: ${testCase.name}`);
    }
    
    console.log(`   Expected: ${testCase.expectedStrategy} (${testCase.expectedCategory})`);
    console.log(`   Detected: ${detected.name} (${detected.category})`);
    console.log(`   Confidence: ${detected.confidence}%`);
    console.log(`   Reasoning: ${detected.reasoning}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests: ${testCases.length}`);
  console.log(`Passed: ${passCount} (${((passCount / testCases.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failCount} (${((failCount / testCases.length) * 100).toFixed(1)}%)`);
  console.log();

  if (failCount > 0) {
    console.log('⚠️  Strategy detection accuracy needs improvement');
    console.log('Recommendation: Review StrategyRouter detection thresholds and prioritization logic');
  } else {
    console.log('✅ All strategy detection tests passed!');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(console.error);
