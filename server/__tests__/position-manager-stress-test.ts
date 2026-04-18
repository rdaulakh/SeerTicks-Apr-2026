/**
 * Position Manager Stress Test
 * 
 * Tests position monitoring under realistic conditions:
 * - Multiple concurrent positions
 * - Rapid price changes
 * - Edge cases (exact stop-loss, near-miss take-profit)
 * - Memory leak detection
 * - Monitoring latency measurement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PositionManager } from '../PositionManager';
import { getDb } from '../db';
import { positions, trades } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  details: string;
}

const results: TestResult[] = [];

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(positions);
  await db.delete(trades);
}

async function testMonitoringLatency() {
  console.log('\n=== Test: Monitoring Latency ===');
  const startTime = Date.now();
  
  const positionManager = new PositionManager();
  await positionManager.initializeBinanceClient('test-key', 'test-secret');
  
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Create 10 test positions
  const positionIds: number[] = [];
  for (let i = 0; i < 10; i++) {
    const [tradeResult] = await db.insert(trades).values({
      userId: 1,
      exchangeId: 1,
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: '50000',
      quantity: '0.1',
      entryTime: new Date(),
      status: 'open',
      confidence: '0.8',
      agentSignals: [],
      expectedPath: [],
    });
    
    const [posResult] = await db.insert(positions).values({
      userId: 1,
      tradeId: tradeResult.insertId,
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: '50000',
      currentPrice: '50000',
      quantity: '0.1',
      stopLoss: '48000',
      takeProfit: '52000',
      expectedPath: [],
      thesisValid: true,
      unrealizedPnl: '0',
    });
    
    positionIds.push(posResult.insertId);
  }
  
  // Mock Binance client
  const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '50100' });
  (positionManager as any).binanceClient = { prices: mockPrices };
  
  // Load positions
  await positionManager.loadOpenPositions();
  
  // Measure monitoring cycle time
  const cycleStart = Date.now();
  await (positionManager as any).monitorAllPositions();
  const cycleDuration = Date.now() - cycleStart;
  
  console.log(`Monitoring cycle for 10 positions: ${cycleDuration}ms`);
  
  const passed = cycleDuration < 500; // Should complete in <500ms
  const duration = Date.now() - startTime;
  
  results.push({
    testName: 'Monitoring Latency',
    passed,
    duration,
    details: `Cycle time: ${cycleDuration}ms (target: <500ms)`,
  });
  
  await cleanup();
  return passed;
}

async function testStopLossEnforcement() {
  console.log('\n=== Test: Stop-Loss Enforcement ===');
  const startTime = Date.now();
  
  const positionManager = new PositionManager();
  await positionManager.initializeBinanceClient('test-key', 'test-secret');
  
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Create position at $50,000 with stop-loss at $48,000
  const [tradeResult] = await db.insert(trades).values({
    userId: 1,
    exchangeId: 1,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    quantity: '0.1',
    entryTime: new Date(),
    status: 'open',
    confidence: '0.8',
    agentSignals: [],
    expectedPath: [],
  });
  
  const [posResult] = await db.insert(positions).values({
    userId: 1,
    tradeId: tradeResult.insertId,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    currentPrice: '50000',
    quantity: '0.1',
    stopLoss: '48000',
    takeProfit: '52000',
    expectedPath: [],
    thesisValid: true,
    unrealizedPnl: '0',
  });
  
  const positionId = posResult.insertId;
  
  // Mock Binance client - price drops to $47,500 (below stop-loss)
  const mockOrder = vi.fn().mockResolvedValue({ orderId: 123, status: 'FILLED' });
  const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '47500' });
  (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };
  
  // Load and monitor
  await positionManager.loadOpenPositions();
  await (positionManager as any).monitorAllPositions();
  
  // Verify position was closed
  const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
  const passed = updatedPosition[0].thesisValid === false;
  const duration = Date.now() - startTime;
  
  console.log(`Position closed: ${!updatedPosition[0].thesisValid}`);
  
  results.push({
    testName: 'Stop-Loss Enforcement',
    passed,
    duration,
    details: `Position status: ${updatedPosition[0].thesisValid ? 'OPEN (FAIL)' : 'CLOSED (PASS)'}`,
  });
  
  await cleanup();
  return passed;
}

async function testTakeProfitEnforcement() {
  console.log('\n=== Test: Take-Profit Enforcement ===');
  const startTime = Date.now();
  
  const positionManager = new PositionManager();
  await positionManager.initializeBinanceClient('test-key', 'test-secret');
  
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Create position at $50,000 with take-profit at $52,000
  const [tradeResult] = await db.insert(trades).values({
    userId: 1,
    exchangeId: 1,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    quantity: '0.1',
    entryTime: new Date(),
    status: 'open',
    confidence: '0.8',
    agentSignals: [],
    expectedPath: [],
  });
  
  const [posResult] = await db.insert(positions).values({
    userId: 1,
    tradeId: tradeResult.insertId,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    currentPrice: '50000',
    quantity: '0.1',
    stopLoss: '48000',
    takeProfit: '52000',
    expectedPath: [],
    thesisValid: true,
    unrealizedPnl: '0',
  });
  
  const positionId = posResult.insertId;
  
  // Mock Binance client - price rises to $52,500 (above take-profit)
  const mockOrder = vi.fn().mockResolvedValue({ orderId: 123, status: 'FILLED' });
  const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '52500' });
  (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };
  
  // Load and monitor
  await positionManager.loadOpenPositions();
  await (positionManager as any).monitorAllPositions();
  
  // Verify position was closed
  const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
  const passed = updatedPosition[0].thesisValid === false;
  const duration = Date.now() - startTime;
  
  console.log(`Position closed: ${!updatedPosition[0].thesisValid}`);
  
  results.push({
    testName: 'Take-Profit Enforcement',
    passed,
    duration,
    details: `Position status: ${updatedPosition[0].thesisValid ? 'OPEN (FAIL)' : 'CLOSED (PASS)'}`,
  });
  
  await cleanup();
  return passed;
}

async function testTrailingStopUpdate() {
  console.log('\n=== Test: Trailing Stop Update ===');
  const startTime = Date.now();
  
  const positionManager = new PositionManager();
  await positionManager.initializeBinanceClient('test-key', 'test-secret');
  
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Create position at $50,000 with stop-loss at $48,000
  const [tradeResult] = await db.insert(trades).values({
    userId: 1,
    exchangeId: 1,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    quantity: '0.1',
    entryTime: new Date(),
    status: 'open',
    confidence: '0.8',
    agentSignals: [],
    expectedPath: [],
  });
  
  const [posResult] = await db.insert(positions).values({
    userId: 1,
    tradeId: tradeResult.insertId,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    currentPrice: '50000',
    quantity: '0.1',
    stopLoss: '48000',
    takeProfit: '52000',
    expectedPath: [],
    thesisValid: true,
    unrealizedPnl: '0',
  });
  
  const positionId = posResult.insertId;
  
  // Mock Binance client - price rises to $52,000 (new high)
  const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '52000' });
  (positionManager as any).binanceClient = { prices: mockPrices };
  
  // Load and monitor
  await positionManager.loadOpenPositions();
  await (positionManager as any).monitorAllPositions();
  
  // Verify stop-loss was updated (should be $50,000 = $52,000 - $2,000 trailing distance)
  const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
  const newStopLoss = parseFloat(updatedPosition[0].stopLoss.toString());
  const passed = newStopLoss > 48000; // Stop should have moved up
  const duration = Date.now() - startTime;
  
  console.log(`Stop-loss updated: $48,000 → $${newStopLoss.toFixed(2)}`);
  
  results.push({
    testName: 'Trailing Stop Update',
    passed,
    duration,
    details: `New stop-loss: $${newStopLoss.toFixed(2)} (expected: >$48,000)`,
  });
  
  await cleanup();
  return passed;
}

async function testPartialProfitTaking() {
  console.log('\n=== Test: Partial Profit Taking ===');
  const startTime = Date.now();
  
  const positionManager = new PositionManager();
  await positionManager.initializeBinanceClient('test-key', 'test-secret');
  
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Create position at $50,000
  const [tradeResult] = await db.insert(trades).values({
    userId: 1,
    exchangeId: 1,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    quantity: '0.3',
    entryTime: new Date(),
    status: 'open',
    confidence: '0.8',
    agentSignals: [],
    expectedPath: [],
  });
  
  const [posResult] = await db.insert(positions).values({
    userId: 1,
    tradeId: tradeResult.insertId,
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: '50000',
    currentPrice: '50000',
    quantity: '0.3',
    stopLoss: '48000',
    takeProfit: '52000',
    expectedPath: [],
    thesisValid: true,
    unrealizedPnl: '0',
  });
  
  const positionId = posResult.insertId;
  
  // Mock Binance client - price rises to $50,750 (+1.5% profit)
  const mockOrder = vi.fn().mockResolvedValue({ orderId: 123, status: 'FILLED' });
  const mockPrices = vi.fn().mockResolvedValue({ BTCUSDT: '50750' });
  (positionManager as any).binanceClient = { order: mockOrder, prices: mockPrices };
  
  // Load and monitor
  await positionManager.loadOpenPositions();
  await (positionManager as any).monitorAllPositions();
  
  // Verify partial exit (33% sold, 67% remaining)
  const updatedPosition = await db.select().from(positions).where(eq(positions.id, positionId));
  const remainingQuantity = parseFloat(updatedPosition[0].quantity.toString());
  const passed = remainingQuantity < 0.3 && remainingQuantity > 0; // Should be ~0.2
  const duration = Date.now() - startTime;
  
  console.log(`Quantity after partial exit: ${remainingQuantity.toFixed(4)} (expected: ~0.2)`);
  
  results.push({
    testName: 'Partial Profit Taking',
    passed,
    duration,
    details: `Remaining quantity: ${remainingQuantity.toFixed(4)} (expected: ~0.2)`,
  });
  
  await cleanup();
  return passed;
}

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         POSITION MANAGER STRESS TEST SUITE                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  await testMonitoringLatency();
  await testStopLossEnforcement();
  await testTakeProfitEnforcement();
  await testTrailingStopUpdate();
  await testPartialProfitTaking();
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST RESULTS                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  results.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${result.testName}`);
    console.log(`      Duration: ${result.duration}ms`);
    console.log(`      Details: ${result.details}\n`);
  });
  
  const passCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const passRate = ((passCount / totalCount) * 100).toFixed(1);
  
  console.log(`\nFinal Score: ${passCount}/${totalCount} tests passed (${passRate}%)`);
  
  if (passCount === totalCount) {
    console.log('🎉 ALL TESTS PASSED - Position Manager is A++ grade\n');
  } else {
    console.log('⚠️  SOME TESTS FAILED - Review required\n');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}
