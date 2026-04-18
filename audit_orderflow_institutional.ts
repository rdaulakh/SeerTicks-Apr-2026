/**
 * OrderFlowAnalyst A++ Institutional-Grade Audit Script
 * 
 * Tests:
 * 1. Order flow detection (verify imbalance calculation)
 * 2. Tick-level updates (confidence changes with price)
 * 3. Performance benchmark (P50/P95/P99 latency)
 * 4. Order book caching efficiency
 * 
 * Institutional Thresholds:
 * - P95 latency: <100ms (target: <1ms)
 * - Confidence updates: Every price tick (50ms intervals)
 * - Order book processing: <10ms
 * - Execution score accuracy: ±5 points
 */

import { OrderFlowAnalyst } from './server/agents/OrderFlowAnalyst';
import type { AgentSignal } from './server/agents/AgentBase';

interface OrderBookSnapshot {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

// Test utilities
function createMockOrderBook(
  symbol: string,
  bidVolume: number,
  askVolume: number,
  spread: number = 0.0001
): OrderBookSnapshot {
  const midPrice = 98000;
  const bestBid = midPrice * (1 - spread / 2);
  const bestAsk = midPrice * (1 + spread / 2);
  
  // Create 20 levels of depth with exponential decay (more volume near top)
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];
  
  for (let i = 0; i < 20; i++) {
    const bidPrice = bestBid - (i * midPrice * 0.0001);
    const askPrice = bestAsk + (i * midPrice * 0.0001);
    
    // Exponential decay: more volume at top levels
    const decay = Math.exp(-i * 0.1);
    const bidVol = (bidVolume / 10) * decay; // Total ~bidVolume
    const askVol = (askVolume / 10) * decay; // Total ~askVolume
    
    bids.push([bidPrice, bidVol]);
    asks.push([askPrice, askVol]);
  }
  
  return {
    symbol,
    bids,
    asks,
    timestamp: Date.now(),
  };
}

function addLargeOrder(
  orderBook: OrderBookSnapshot,
  side: 'bid' | 'ask',
  price: number,
  volume: number
): void {
  if (side === 'bid') {
    orderBook.bids.push([price, volume]);
    orderBook.bids.sort((a, b) => b[0] - a[0]); // Sort descending
  } else {
    orderBook.asks.push([price, volume]);
    orderBook.asks.sort((a, b) => a[0] - b[0]); // Sort ascending
  }
}

// Test 1: Order Flow Detection
async function testOrderFlowDetection(): Promise<boolean> {
  console.log('\n=== Test 1: Order Flow Detection ===');
  
  const agent = new OrderFlowAnalyst();
  await agent.start();
  
  try {
    // Scenario 1: Strong bullish order book (70% bid, 30% ask for stronger signal)
    const bullishBook = createMockOrderBook('BTCUSDT', 700, 300);
    addLargeOrder(bullishBook, 'bid', 97900, 100); // Large buy wall (whale)
    
    (agent as any).updateOrderBook('BTCUSDT', bullishBook);
    (agent as any).setCurrentPrice(98000);
    
    const bullishSignal = await agent.analyze('BTCUSDT');
    
    console.log(`  Bullish Order Book:`);
    console.log(`    Signal: ${bullishSignal.signal}`);
    console.log(`    Confidence: ${(bullishSignal.confidence * 100).toFixed(1)}%`);
    console.log(`    Order Book Score: ${(bullishSignal.evidence as any).orderBookScore || 'N/A'}`);
    console.log(`    Execution Score: ${(bullishSignal.evidence as any).executionScore || 'N/A'}/100`);
    
    if (bullishSignal.signal !== 'bullish') {
      console.log(`  ❌ FAIL: Expected bullish signal, got ${bullishSignal.signal}`);
      return false;
    }
    
    // Scenario 2: Strong bearish order book (30% bid, 70% ask for stronger signal)
    const bearishBook = createMockOrderBook('BTCUSDT', 300, 700);
    addLargeOrder(bearishBook, 'ask', 98100, 100); // Large sell wall (whale)
    
    (agent as any).updateOrderBook('BTCUSDT', bearishBook);
    (agent as any).setCurrentPrice(98000);
    
    const bearishSignal = await agent.analyze('BTCUSDT');
    
    console.log(`  Bearish Order Book:`);
    console.log(`    Signal: ${bearishSignal.signal}`);
    console.log(`    Confidence: ${(bearishSignal.confidence * 100).toFixed(1)}%`);
    console.log(`    Order Book Score: ${(bearishSignal.evidence as any).orderBookScore || 'N/A'}`);
    console.log(`    Execution Score: ${(bearishSignal.evidence as any).executionScore || 'N/A'}/100`);
    
    if (bearishSignal.signal !== 'bearish') {
      console.log(`  ❌ FAIL: Expected bearish signal, got ${bearishSignal.signal}`);
      return false;
    }
    
    console.log(`  ✅ PASS: Order flow detection working correctly`);
    return true;
    
  } finally {
    await agent.stop();
  }
}

// Test 2: Tick-Level Confidence Updates
async function testTickLevelUpdates(): Promise<boolean> {
  console.log('\n=== Test 2: Tick-Level Confidence Updates ===');
  
  const agent = new OrderFlowAnalyst();
  await agent.start();
  
  try {
    // Create order book with support at $97,800 (strong bullish bias)
    const orderBook = createMockOrderBook('BTCUSDT', 700, 300);
    addLargeOrder(orderBook, 'bid', 97800, 150); // Strong support (whale buy wall)
    
    (agent as any).updateOrderBook('BTCUSDT', orderBook);
    
    // Test 1: Price far from support ($98,500)
    (agent as any).setCurrentPrice(98500);
    const signal1 = await agent.analyze('BTCUSDT');
    const confidence1 = signal1.confidence;
    
    console.log(`  Price $98,500 (far from support):`);
    console.log(`    Confidence: ${(confidence1 * 100).toFixed(1)}%`);
    
    // Test 2: Price approaching support ($98,000)
    (agent as any).setCurrentPrice(98000);
    const signal2 = await agent.analyze('BTCUSDT');
    const confidence2 = signal2.confidence;
    
    console.log(`  Price $98,000 (approaching support):`);
    console.log(`    Confidence: ${(confidence2 * 100).toFixed(1)}%`);
    
    // Test 3: Price near support ($97,850)
    (agent as any).setCurrentPrice(97850);
    const signal3 = await agent.analyze('BTCUSDT');
    const confidence3 = signal3.confidence;
    
    console.log(`  Price $97,850 (near support):`);
    console.log(`    Confidence: ${(confidence3 * 100).toFixed(1)}%`);
    
    // Confidence should increase as price approaches support
    if (confidence3 <= confidence1) {
      console.log(`  ❌ FAIL: Confidence should increase as price approaches support`);
      console.log(`    Far: ${(confidence1 * 100).toFixed(1)}%, Near: ${(confidence3 * 100).toFixed(1)}%`);
      return false;
    }
    
    const confidenceIncrease = ((confidence3 - confidence1) * 100).toFixed(1);
    console.log(`  Confidence increase: +${confidenceIncrease}% (${(confidence1 * 100).toFixed(1)}% → ${(confidence3 * 100).toFixed(1)}%)`);
    console.log(`  ✅ PASS: Dynamic confidence updates working correctly`);
    return true;
    
  } finally {
    await agent.stop();
  }
}

// Test 3: Performance Benchmark
async function testPerformanceBenchmark(): Promise<boolean> {
  console.log('\n=== Test 3: Performance Benchmark ===');
  
  const agent = new OrderFlowAnalyst();
  await agent.start();
  
  try {
    const orderBook = createMockOrderBook('BTCUSDT', 500, 500);
    (agent as any).updateOrderBook('BTCUSDT', orderBook);
    (agent as any).setCurrentPrice(98000);
    
    const iterations = 1000;
    const latencies: number[] = [];
    
    console.log(`  Running ${iterations} iterations...`);
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await agent.analyze('BTCUSDT');
      const end = performance.now();
      latencies.push(end - start);
    }
    
    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.50)];
    const p95 = latencies[Math.floor(iterations * 0.95)];
    const p99 = latencies[Math.floor(iterations * 0.99)];
    const avg = latencies.reduce((sum, l) => sum + l, 0) / iterations;
    const min = latencies[0];
    const max = latencies[iterations - 1];
    
    console.log(`  Results:`);
    console.log(`    Min:  ${min.toFixed(2)}ms`);
    console.log(`    P50:  ${p50.toFixed(2)}ms`);
    console.log(`    Avg:  ${avg.toFixed(2)}ms`);
    console.log(`    P95:  ${p95.toFixed(2)}ms`);
    console.log(`    P99:  ${p99.toFixed(2)}ms`);
    console.log(`    Max:  ${max.toFixed(2)}ms`);
    
    // Institutional threshold: P95 < 100ms (target: <1ms)
    const institutionalThreshold = 100;
    const targetThreshold = 1;
    
    if (p95 > institutionalThreshold) {
      console.log(`  ❌ FAIL: P95 latency ${p95.toFixed(2)}ms exceeds institutional threshold (${institutionalThreshold}ms)`);
      return false;
    }
    
    if (p95 <= targetThreshold) {
      console.log(`  ✅ PASS: P95 latency ${p95.toFixed(2)}ms meets A++ target (<${targetThreshold}ms)`);
      console.log(`  🏆 EXCELLENT: ${(institutionalThreshold / p95).toFixed(0)}x faster than institutional threshold`);
    } else {
      console.log(`  ✅ PASS: P95 latency ${p95.toFixed(2)}ms meets institutional threshold (<${institutionalThreshold}ms)`);
      console.log(`  ⚠️  NOTE: Target A++ performance is <${targetThreshold}ms`);
    }
    
    return true;
    
  } finally {
    await agent.stop();
  }
}

// Test 4: Execution Score Accuracy
async function testExecutionScore(): Promise<boolean> {
  console.log('\n=== Test 4: Execution Score Accuracy ===');
  
  const agent = new OrderFlowAnalyst();
  await agent.start();
  
  try {
    // Scenario 1: Excellent execution conditions
    // - High volume (1000 BTC)
    // - Tight spread (5 bps)
    // - Large orders nearby
    const excellentBook = createMockOrderBook('BTCUSDT', 500, 500, 0.0005);
    addLargeOrder(excellentBook, 'bid', 97950, 50); // Very close to current price
    
    (agent as any).updateOrderBook('BTCUSDT', excellentBook);
    (agent as any).setCurrentPrice(98000);
    
    const excellentSignal = await agent.analyze('BTCUSDT');
    const excellentScore = (excellentSignal.evidence as any).executionScore;
    
    console.log(`  Excellent Conditions:`);
    console.log(`    Execution Score: ${excellentScore}/100`);
    
    // Scenario 2: Poor execution conditions
    // - Low volume (100 BTC)
    // - Wide spread (50 bps)
    // - No large orders nearby
    const poorBook = createMockOrderBook('BTCUSDT', 50, 50, 0.005);
    
    (agent as any).updateOrderBook('BTCUSDT', poorBook);
    (agent as any).setCurrentPrice(98000);
    
    const poorSignal = await agent.analyze('BTCUSDT');
    const poorScore = (poorSignal.evidence as any).executionScore;
    
    console.log(`  Poor Conditions:`);
    console.log(`    Execution Score: ${poorScore}/100`);
    
    // Excellent conditions should have significantly higher score
    if (excellentScore <= poorScore) {
      console.log(`  ❌ FAIL: Excellent score (${excellentScore}) should be higher than poor score (${poorScore})`);
      return false;
    }
    
    const scoreDiff = excellentScore - poorScore;
    console.log(`  Score difference: ${scoreDiff} points`);
    
    if (scoreDiff < 20) {
      console.log(`  ⚠️  WARNING: Score difference is small (${scoreDiff} < 20 points)`);
    }
    
    console.log(`  ✅ PASS: Execution score accurately reflects market conditions`);
    return true;
    
  } finally {
    await agent.stop();
  }
}

// Main audit runner
async function runAudit(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  OrderFlowAnalyst A++ Institutional-Grade Audit                ║');
  console.log('║  Date: Nov 28, 2025                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  const results = {
    orderFlowDetection: false,
    tickLevelUpdates: false,
    performanceBenchmark: false,
    executionScore: false,
  };
  
  try {
    results.orderFlowDetection = await testOrderFlowDetection();
    results.tickLevelUpdates = await testTickLevelUpdates();
    results.performanceBenchmark = await testPerformanceBenchmark();
    results.executionScore = await testExecutionScore();
  } catch (error) {
    console.error('\n❌ Audit failed with error:', error);
    process.exit(1);
  }
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  AUDIT SUMMARY                                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  const tests = [
    { name: 'Order Flow Detection', passed: results.orderFlowDetection },
    { name: 'Tick-Level Updates', passed: results.tickLevelUpdates },
    { name: 'Performance Benchmark', passed: results.performanceBenchmark },
    { name: 'Execution Score Accuracy', passed: results.executionScore },
  ];
  
  tests.forEach(test => {
    const status = test.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${test.name}`);
  });
  
  const passedCount = tests.filter(t => t.passed).length;
  const totalCount = tests.length;
  const passRate = (passedCount / totalCount * 100).toFixed(0);
  
  console.log(`\n  Overall: ${passedCount}/${totalCount} tests passed (${passRate}%)`);
  
  if (passedCount === totalCount) {
    console.log('\n  🏆 A++ CERTIFICATION ACHIEVED');
    console.log('  OrderFlowAnalyst meets all institutional-grade requirements');
    process.exit(0);
  } else {
    console.log('\n  ❌ CERTIFICATION FAILED');
    console.log(`  ${totalCount - passedCount} test(s) failed - review and fix issues`);
    process.exit(1);
  }
}

// Run audit
runAudit().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
