import { getSEERMultiEngine } from './server/seerMainMulti.ts';

console.log('\n=== Verifying Ticker Processing & Signal Generation ===\n');

const userId = 1; // Admin user

try {
  const engine = await getSEERMultiEngine(userId);
  const status = engine.getStatus();
  
  console.log('📊 Engine Status:');
  console.log(`  Running: ${status.isRunning}`);
  console.log(`  Exchanges: ${status.exchanges}`);
  console.log(`  Trading Pairs: ${status.tradingPairs}`);
  console.log(`  Signals Generated: ${status.signalsGenerated}`);
  console.log(`  Last Signal: ${status.lastSignalTime}`);
  
  console.log('\n📈 Symbol Orchestrators:');
  const orchestrators = engine['symbolOrchestrators'];
  for (const [key, orch] of orchestrators.entries()) {
    const orchStatus = orch.getStatus();
    console.log(`\n  ${key}:`);
    console.log(`    Symbol: ${orchStatus.symbol}`);
    console.log(`    Exchange: ${orchStatus.exchange}`);
    console.log(`    Current Price: $${orchStatus.currentPrice?.toFixed(2) || 'N/A'}`);
    console.log(`    Last Update: ${orchStatus.lastUpdate}`);
    console.log(`    WebSocket Healthy: ${orchStatus.wsHealthy}`);
  }
  
  // Wait 10 seconds to see if new signals are generated
  console.log('\n⏳ Waiting 10 seconds to observe signal generation...\n');
  
  const initialSignals = status.signalsGenerated;
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const newStatus = engine.getStatus();
  const signalsDelta = newStatus.signalsGenerated - initialSignals;
  
  console.log(`\n✅ Results:`);
  console.log(`  Initial Signals: ${initialSignals}`);
  console.log(`  Current Signals: ${newStatus.signalsGenerated}`);
  console.log(`  New Signals Generated: ${signalsDelta}`);
  console.log(`  Last Signal Time: ${newStatus.lastSignalTime}`);
  
  if (signalsDelta > 0) {
    console.log('\n🎉 SUCCESS! Agents are generating signals from ticker data!');
  } else {
    console.log('\n⚠️  WARNING: No new signals generated in 10 seconds');
    console.log('   This could mean:');
    console.log('   - Agents are not receiving ticks');
    console.log('   - Agents are receiving ticks but not generating signals');
    console.log('   - Signal generation interval is longer than 10 seconds');
  }
  
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}
