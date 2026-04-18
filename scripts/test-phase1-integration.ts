/**
 * Live Integration Test for Phase1 Infrastructure
 * 
 * Tests the integration in live mode with actual Redis and trading components
 */

import { getPhase1Integration, initializePhase1Integration } from '../server/services/Phase1Integration';
import { priceFeedService } from '../server/services/priceFeedService';

async function runLiveTest() {
  console.log('='.repeat(60));
  console.log('Phase 1 Infrastructure Live Integration Test');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Step 1: Initialize the integration
    console.log('Step 1: Initializing Phase 1 Integration...');
    const integration = await initializePhase1Integration();
    console.log('✅ Integration initialized');
    console.log('');

    // Step 2: Check initial stats
    console.log('Step 2: Checking initial stats...');
    const initialStats = integration.getStats();
    console.log('Initial Stats:', JSON.stringify(initialStats, null, 2));
    console.log('');

    // Step 3: Test health check
    console.log('Step 3: Running health check...');
    const health = await integration.healthCheck();
    console.log('Health Status:', health.overall);
    console.log('Components:');
    health.components.forEach(c => {
      console.log(`  - ${c.name}: ${c.status} (${c.details})`);
    });
    console.log('');

    // Step 4: Test optimized price access
    console.log('Step 4: Testing optimized price access...');
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    
    for (const symbol of symbols) {
      const startTime = performance.now();
      const price = await integration.getOptimizedPrice(symbol);
      const latency = performance.now() - startTime;
      
      if (price) {
        console.log(`  ${symbol}: $${price.price.toFixed(2)} (${latency.toFixed(3)}ms)`);
      } else {
        console.log(`  ${symbol}: No price available (${latency.toFixed(3)}ms)`);
      }
    }
    console.log('');

    // Step 5: Test batch price access
    console.log('Step 5: Testing batch price access...');
    const batchStart = performance.now();
    const prices = await integration.getOptimizedPrices(symbols);
    const batchLatency = performance.now() - batchStart;
    console.log(`Batch request for ${symbols.length} symbols: ${batchLatency.toFixed(3)}ms`);
    console.log(`Average per symbol: ${(batchLatency / symbols.length).toFixed(3)}ms`);
    console.log('');

    // Step 6: Wait and check stats again
    console.log('Step 6: Waiting 3 seconds for price sync...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const finalStats = integration.getStats();
    console.log('Final Stats:', JSON.stringify(finalStats, null, 2));
    console.log('');

    // Step 7: Stop integration
    console.log('Step 7: Stopping integration...');
    await integration.stop();
    console.log('✅ Integration stopped');
    console.log('');

    // Summary
    console.log('='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log(`Prices Synced: ${finalStats.pricesSynced}`);
    console.log(`Ticks Processed: ${finalStats.ticksProcessed}`);
    console.log(`Signals Generated: ${finalStats.signalsGenerated}`);
    console.log(`Average Latency: ${finalStats.avgLatencyMs.toFixed(3)}ms`);
    console.log('');
    
    if (finalStats.avgLatencyMs < 20) {
      console.log('✅ PASS: Latency target achieved (<20ms)');
    } else {
      console.log('⚠️ WARNING: Latency above target (>20ms)');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
runLiveTest().then(() => {
  console.log('');
  console.log('Test completed successfully!');
  process.exit(0);
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
