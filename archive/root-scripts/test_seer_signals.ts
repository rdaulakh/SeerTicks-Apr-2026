/**
 * Simple SEER Engine Signal Test
 * 
 * Tests if agents generate signals when SEER engine runs
 */

import { getSEEREngine } from './server/seerMain';

async function testSEERSignals() {
  console.log('='.repeat(80));
  console.log('SEER ENGINE SIGNAL TEST');
  console.log('='.repeat(80));

  try {
    // Initialize SEER engine
    console.log('\n1. Initializing SEER engine...');
    const engine = getSEEREngine({
      userId: 1, // Test user ID
      symbol: 'BTCUSDT',
      tickInterval: 5000,
      capitalAvailable: 10000,
      enableAutoTrading: false,
      enableLearning: false,
    });

    // Start engine
    console.log('2. Starting SEER engine...');
    await engine.start();
    console.log('✅ Engine started');

    // Wait for a few ticks
    console.log('\n3. Waiting for 3 ticks (15 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Get status
    console.log('\n4. Getting engine status...');
    const status = engine.getStatus();
    console.log('Status:', JSON.stringify(status, null, 2));

    // Get agent health
    console.log('\n5. Getting agent health...');
    const health = engine.getAgentManager().getAllHealth();
    console.log('Agent Health:');
    health.forEach(h => {
      console.log(`  - ${h.agentName}: ${h.isHealthy ? '✅' : '❌'} (${h.lastSignalTime ? new Date(h.lastSignalTime).toLocaleTimeString() : 'never'})`);
    });

    // Check database for signals
    console.log('\n6. Checking database for saved signals...');
    const { getRecentSignals } = await import('./server/db/signalStorage');
    const signals = await getRecentSignals(1, 20); // Get last 20 signals
    
    console.log(`\nFound ${signals.length} signals in database:`);
    const agentCounts: Record<string, number> = {};
    signals.forEach(s => {
      agentCounts[s.agentName] = (agentCounts[s.agentName] || 0) + 1;
    });
    
    Object.entries(agentCounts).forEach(([agent, count]) => {
      console.log(`  - ${agent}: ${count} signals`);
    });

    if (signals.length > 0) {
      console.log('\n📊 Latest signal:');
      const latest = signals[0];
      const data = latest.signalData as any;
      console.log(`  Agent: ${latest.agentName}`);
      console.log(`  Signal: ${data.signal}`);
      console.log(`  Confidence: ${(data.confidence * 100).toFixed(1)}%`);
      console.log(`  Time: ${new Date(latest.timestamp).toLocaleString()}`);
      console.log(`  Reasoning: ${data.reasoning?.substring(0, 100)}...`);
    }

    // Stop engine
    console.log('\n7. Stopping engine...');
    await engine.stop();
    console.log('✅ Engine stopped');

    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    
    if (signals.length > 0) {
      console.log('\n✅ SUCCESS: Agents are generating and saving signals!');
    } else {
      console.log('\n❌ FAILURE: No signals found in database');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

testSEERSignals();
