/**
 * Test MacroAnalyst confidence calculation in detail
 */

import { MacroAnalyst } from './server/agents/MacroAnalyst.js';

async function testConfidenceCalculation() {
  console.log('\n=== MacroAnalyst Confidence Calculation Test ===\n');
  
  const macro = new MacroAnalyst();
  
  // Test 1: Generate signal and examine confidence
  console.log('Test 1: Generate signal for BTCUSDT');
  const signal = await macro.analyze('BTCUSDT', 42000, 'binance');
  
  console.log('\n--- Signal Output ---');
  console.log(`Signal: ${signal.signal}`);
  console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
  console.log(`Strength: ${(signal.strength * 100).toFixed(1)}%`);
  console.log(`Execution Score: ${signal.executionScore}/100`);
  console.log(`Quality Score: ${signal.qualityScore.toFixed(2)}`);
  
  console.log('\n--- Evidence Details ---');
  const evidence = signal.evidence as any;
  console.log(`VIX: ${evidence.vix?.toFixed(2)}`);
  console.log(`DXY: ${evidence.dxy?.toFixed(2)}`);
  console.log(`S&P 500 Change: ${evidence.sp500Change?.toFixed(2)}%`);
  console.log(`Stablecoin Change: ${evidence.stablecoinChange?.toFixed(2)}%`);
  console.log(`BTC Dominance: ${evidence.btcDominance?.toFixed(2)}%`);
  console.log(`Market Regime: ${evidence.regime} (${(evidence.regimeConfidence * 100).toFixed(0)}% confidence)`);
  
  if (evidence.correlations) {
    console.log('\n--- Correlation Analysis ---');
    console.log(`BTC/SPX 30d: ${evidence.correlations.btcSpx30d?.toFixed(3)}`);
    console.log(`BTC/SPX 90d: ${evidence.correlations.btcSpx90d?.toFixed(3)}`);
    console.log(`BTC/Gold 30d: ${evidence.correlations.btcGold30d?.toFixed(3)}`);
    console.log(`BTC/DXY 30d: ${evidence.correlations.btcDxy30d?.toFixed(3)}`);
    console.log(`Correlation Regime: ${evidence.correlations.correlationRegime}`);
  }
  
  console.log('\n--- Veto Status ---');
  console.log(`Veto Active: ${evidence.vetoActive ? 'YES' : 'NO'}`);
  if (evidence.vetoActive) {
    console.log(`Veto Reason: ${evidence.vetoReason}`);
  }
  
  console.log('\n--- Reasoning ---');
  console.log(signal.reasoning);
  
  console.log('\n--- Recommendation ---');
  console.log(`Action: ${signal.recommendation?.action}`);
  console.log(`Urgency: ${signal.recommendation?.urgency}`);
  
  // Test 2: Check if signal is neutral when confidence is low
  console.log('\n\nTest 2: Confidence Threshold Analysis');
  if (signal.confidence < 0.5) {
    console.log('✅ Low confidence detected - signal should be neutral or hold');
    console.log(`   Signal: ${signal.signal}, Recommendation: ${signal.recommendation?.action}`);
  } else {
    console.log(`✅ Confidence is ${(signal.confidence * 100).toFixed(1)}% - signal is actionable`);
  }
  
  // Test 3: Execution score breakdown
  console.log('\n\nTest 3: Execution Score Breakdown (0-100)');
  console.log(`Total Score: ${signal.executionScore}/100`);
  console.log('Components:');
  console.log(`  - Regime Clarity (0-25): ~${Math.round(evidence.regimeConfidence * 25)}`);
  console.log(`  - Correlation Strength (0-25): calculated from correlations`);
  console.log(`  - Veto Absence (0-25): ${evidence.vetoActive ? 0 : 25}`);
  console.log(`  - Data Freshness (0-25): based on fetch time`);
  
  console.log('\n=== Test Complete ===');
}

testConfidenceCalculation().catch(console.error).finally(() => process.exit(0));
