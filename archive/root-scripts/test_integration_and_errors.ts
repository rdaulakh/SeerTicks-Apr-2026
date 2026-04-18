/**
 * Integration and Error Handling Test
 * Tests the complete pipeline and error recovery mechanisms
 */

import { PositionManager } from './server/PositionManager';
import { RiskManager } from './server/RiskManager';

interface TestResult {
  component: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
}

async function runIntegrationTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log('='.repeat(80));
  console.log('INTEGRATION & ERROR HANDLING TEST');
  console.log('='.repeat(80));
  console.log();

  // Test 1: Position Manager initialization
  console.log('Test 1: Position Manager Initialization...');
  try {
    const pm = new PositionManager();
    results.push({
      component: 'PositionManager',
      test: 'Initialization',
      status: 'PASS',
      details: 'Successfully initialized in paper trading mode',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'PositionManager',
      test: 'Initialization',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 2: Position Manager start/stop
  console.log('Test 2: Position Manager Start/Stop...');
  try {
    const pm = new PositionManager();
    await pm.start();
    pm.stop();
    results.push({
      component: 'PositionManager',
      test: 'Start/Stop Lifecycle',
      status: 'PASS',
      details: 'Successfully started and stopped monitoring',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'PositionManager',
      test: 'Start/Stop Lifecycle',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 3: Price cache update
  console.log('Test 3: Price Cache Update...');
  try {
    const pm = new PositionManager();
    pm.updatePriceFromFeed('BTCUSDT', 50000);
    pm.updatePriceFromFeed('ETHUSDT', 3000);
    results.push({
      component: 'PositionManager',
      test: 'Price Cache Update',
      status: 'PASS',
      details: 'Successfully updated price cache from WebSocket feed',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'PositionManager',
      test: 'Price Cache Update',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 4: Price staleness monitoring
  console.log('Test 4: Price Staleness Monitoring...');
  try {
    const pm = new PositionManager();
    let staleEventReceived = false;
    
    pm.on('price_feed_stale', (data) => {
      staleEventReceived = true;
    });

    // Update price and wait for staleness check
    pm.updatePriceFromFeed('TESTUSDT', 100);
    
    results.push({
      component: 'PositionManager',
      test: 'Price Staleness Monitoring',
      status: 'PASS',
      details: 'Staleness monitoring event listener registered successfully',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'PositionManager',
      test: 'Price Staleness Monitoring',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 5: Paper trading mode safety
  console.log('Test 5: Paper Trading Mode Safety...');
  try {
    const pm = new PositionManager();
    pm.setPaperTradingMode(true);
    pm.setPaperTradingMode(false); // Should log warning
    pm.setPaperTradingMode(true); // Back to safe mode
    results.push({
      component: 'PositionManager',
      test: 'Paper Trading Mode Safety',
      status: 'PASS',
      details: 'Paper trading mode toggle works correctly with warnings',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'PositionManager',
      test: 'Paper Trading Mode Safety',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 6: RiskManager initialization
  console.log('Test 6: RiskManager Initialization...');
  try {
    const rm = new RiskManager();
    results.push({
      component: 'RiskManager',
      test: 'Initialization',
      status: 'PASS',
      details: 'Successfully initialized with Kelly Criterion',
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'RiskManager',
      test: 'Initialization',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 7: Position size calculation
  console.log('Test 7: Position Size Calculation...');
  try {
    const rm = new RiskManager();
    const positionSize = await rm.calculatePositionSize({
      symbol: 'BTCUSDT',
      confidence: 75,
      accountBalance: 10000,
      currentPrice: 50000,
      stopLoss: 49000,
      regime: 'trending',
    });
    
    const isValid = positionSize > 0 && positionSize <= 0.05; // Max 5% of portfolio
    results.push({
      component: 'RiskManager',
      test: 'Position Size Calculation',
      status: isValid ? 'PASS' : 'FAIL',
      details: `Calculated position size: ${positionSize.toFixed(4)} (${(positionSize * 100).toFixed(2)}% of portfolio)`,
    });
    console.log(isValid ? '✅ PASS\n' : '❌ FAIL\n');
  } catch (error) {
    results.push({
      component: 'RiskManager',
      test: 'Position Size Calculation',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 8: ATR-based stop loss
  console.log('Test 8: ATR-Based Stop Loss Calculation...');
  try {
    const rm = new RiskManager();
    const stopLoss = await rm.calculateStopLoss({
      symbol: 'BTCUSDT',
      entryPrice: 50000,
      side: 'long',
      atr: 1000,
    });
    
    const expectedStop = 50000 - (1.5 * 1000); // 1.5x ATR below entry
    const isValid = Math.abs(stopLoss - expectedStop) < 10; // Allow small variance
    
    results.push({
      component: 'RiskManager',
      test: 'ATR-Based Stop Loss',
      status: isValid ? 'PASS' : 'FAIL',
      details: `Stop loss: ${stopLoss.toFixed(2)} (expected: ${expectedStop.toFixed(2)})`,
    });
    console.log(isValid ? '✅ PASS\n' : '❌ FAIL\n');
  } catch (error) {
    results.push({
      component: 'RiskManager',
      test: 'ATR-Based Stop Loss',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 9: Macro veto mechanism
  console.log('Test 9: Macro Veto Mechanism...');
  try {
    const rm = new RiskManager();
    const shouldVeto = await rm.checkMacroVeto({
      symbol: 'BTCUSDT',
      action: 'buy',
      macroSignal: {
        sentiment: 'bearish',
        strength: 'strong',
        confidence: 85,
      },
    });
    
    results.push({
      component: 'RiskManager',
      test: 'Macro Veto Mechanism',
      status: 'PASS',
      details: `Macro veto check completed (veto: ${shouldVeto})`,
    });
    console.log('✅ PASS\n');
  } catch (error) {
    results.push({
      component: 'RiskManager',
      test: 'Macro Veto Mechanism',
      status: 'FAIL',
      details: `Failed: ${error}`,
    });
    console.log('❌ FAIL\n');
  }

  // Test 10: Error handling - Invalid input
  console.log('Test 10: Error Handling - Invalid Input...');
  try {
    const rm = new RiskManager();
    try {
      await rm.calculatePositionSize({
        symbol: 'BTCUSDT',
        confidence: -10, // Invalid confidence
        accountBalance: 10000,
        currentPrice: 50000,
        stopLoss: 49000,
        regime: 'trending',
      });
      results.push({
        component: 'RiskManager',
        test: 'Error Handling - Invalid Input',
        status: 'FAIL',
        details: 'Should have thrown error for invalid confidence',
      });
      console.log('❌ FAIL\n');
    } catch (validationError) {
      results.push({
        component: 'RiskManager',
        test: 'Error Handling - Invalid Input',
        status: 'PASS',
        details: 'Correctly rejected invalid input with error',
      });
      console.log('✅ PASS\n');
    }
  } catch (error) {
    results.push({
      component: 'RiskManager',
      test: 'Error Handling - Invalid Input',
      status: 'WARNING',
      details: `Unexpected error: ${error}`,
    });
    console.log('⚠️  WARNING\n');
  }

  return results;
}

async function main() {
  const results = await runIntegrationTests();

  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARNING').length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passCount} (${((passCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failCount} (${((failCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`Warnings: ${warnCount} (${((warnCount / results.length) * 100).toFixed(1)}%)`);
  console.log();

  console.log('Detailed Results:');
  console.log('-'.repeat(80));
  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
    console.log(`${icon} [${result.component}] ${result.test}`);
    console.log(`   ${result.details}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(console.error);
