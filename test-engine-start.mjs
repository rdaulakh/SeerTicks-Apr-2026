import { getSEERMultiEngine } from './server/seerMainMulti.ts';

console.log('=== SEER ENGINE START TEST ===');
console.log('Timestamp:', new Date().toISOString());

try {
  console.log('\n[1] Getting engine instance for userId: 1');
  const engine = getSEERMultiEngine(1);
  console.log('[1] ✓ Engine instance obtained');
  
  console.log('\n[2] Calling engine.start()...');
  await engine.start();
  console.log('[2] ✓ Engine started successfully');
  
  console.log('\n[3] Getting engine status...');
  const status = engine.getStatus();
  console.log('[3] Engine Status:', JSON.stringify(status, null, 2));
  
  console.log('\n[4] Waiting 10 seconds for agents to generate signals...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log('\n[5] Getting all agents status...');
  const agents = engine.getAllAgentsStatus();
  console.log('[5] Total agents:', agents.length);
  
  if (agents.length > 0) {
    console.log('\n[6] Agent Details:');
    agents.forEach(agent => {
      console.log(`  - ${agent.name} (${agent.symbol}): ${agent.signal} @ ${agent.confidence.toFixed(1)}%`);
      console.log(`    Last Update: ${agent.lastUpdate}`);
      console.log(`    Reasoning: ${agent.reasoning.substring(0, 100)}...`);
    });
  } else {
    console.log('\n[6] ⚠️  NO AGENTS FOUND - This is the problem!');
  }
  
  console.log('\n[7] Stopping engine...');
  await engine.stop();
  console.log('[7] ✓ Engine stopped');
  
  console.log('\n=== TEST COMPLETE ===');
  process.exit(0);
} catch (error) {
  console.error('\n❌ ERROR:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}
