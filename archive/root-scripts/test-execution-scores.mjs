import { SEERMultiEngine } from './server/seerMainMulti.ts';

// Create a test engine instance
const engine = new SEERMultiEngine('test-user');

// Wait for engine to initialize
await new Promise(resolve => setTimeout(resolve, 2000));

console.log('\n=== Testing Execution Score Data Flow ===\n');

// Test 1: getAllAgentsStatus (used by Agents page)
console.log('1. getAllAgentsStatus() - Used by Agents page:');
const allAgents = engine.getAllAgentsStatus();
const binanceBTC = allAgents.filter(a => a.exchange === 'binance' && a.tradingPair === 'BTCUSDT');
console.log('\nBinance BTCUSDT agents:');
binanceBTC.forEach(agent => {
  console.log(`  ${agent.name}: executionScore = ${agent.executionScore}, signal = ${agent.signal}, confidence = ${agent.confidence.toFixed(1)}%`);
});

// Test 2: getOrchestratorState (used by Strategy page)
console.log('\n2. getOrchestratorState() - Used by Strategy page:');
const orchestratorState = engine.getOrchestratorState('binance', 'BTCUSDT');
if (orchestratorState) {
  console.log('\nFast agents:');
  orchestratorState.fastAgents.forEach(agent => {
    console.log(`  ${agent.name}: executionScore = ${agent.executionScore}, signal = ${agent.signal}, confidence = ${agent.confidence.toFixed(1)}%`);
  });
  console.log('\nSlow agents:');
  orchestratorState.slowAgents.forEach(agent => {
    console.log(`  ${agent.name}: executionScore = ${agent.executionScore}, signal = ${agent.signal}, confidence = ${agent.confidence.toFixed(1)}%`);
  });
} else {
  console.log('  No orchestrator found!');
}

console.log('\n=== Test Complete ===\n');
process.exit(0);
