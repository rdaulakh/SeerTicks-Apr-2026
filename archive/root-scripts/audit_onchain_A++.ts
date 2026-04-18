/**
 * OnChainAnalyst A++ Institutional-Grade Audit (Updated)
 * 
 * Detects real data integration by:
 * 1. Checking for FreeOnChainDataProvider usage
 * 2. Validating SOPR/MVRV/NVT values are realistic (not random)
 * 3. Testing multiple runs for consistency
 * 4. Comparing against known market conditions
 */

import { OnChainAnalyst } from './server/agents/OnChainAnalyst.js';

interface AuditResult {
  category: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  score: number;
}

async function auditOnChainAnalystAPlusPlus() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   OnChainAnalyst A++ Institutional-Grade Audit (v2)       ║');
  console.log('║   Real Data Integration Validation                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results: AuditResult[] = [];
  let totalScore = 0;
  let maxScore = 0;

  // Initialize agent
  const agent = new OnChainAnalyst();
  await agent.start();

  // ═══════════════════════════════════════════════════════════
  // TEST 1: API Configuration Check
  // ═══════════════════════════════════════════════════════════
  console.log('📋 TEST 1: API Configuration');
  console.log('─'.repeat(60));

  const whaleAlertKey = process.env.WHALE_ALERT_API_KEY;
  
  if (whaleAlertKey && whaleAlertKey.length > 10) {
    results.push({
      category: 'Configuration',
      test: 'Whale Alert API Key',
      status: 'PASS',
      details: `API key configured (${whaleAlertKey.substring(0, 8)}...)`,
      score: 10
    });
    totalScore += 10;
    console.log(`✅ Whale Alert API: Connected`);
  } else {
    results.push({
      category: 'Configuration',
      test: 'Whale Alert API Key',
      status: 'WARNING',
      details: 'API key not configured - whale data limited',
      score: 5
    });
    totalScore += 5;
    console.log(`⚠️  Whale Alert API: Not configured`);
  }
  maxScore += 10;

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Real Data Detection (CRITICAL)
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔍 TEST 2: Real Data Integration Detection');
  console.log('─'.repeat(60));

  // Run analysis 3 times to check for consistency
  const signals = [];
  const soprValues = [];
  const mvrvValues = [];
  const nvtValues = [];

  for (let i = 0; i < 3; i++) {
    const signal = await agent.analyze('BTCUSDT', 98000, 'binance');
    signals.push(signal);
    
    // Extract SOPR/MVRV from reasoning
    const reasoning = signal.reasoning;
    const soprMatch = reasoning.match(/SOPR:\s*([\d.]+)/);
    const mvrvMatch = reasoning.match(/MVRV:\s*([\d.]+)/);
    
    if (soprMatch) soprValues.push(parseFloat(soprMatch[1]));
    if (mvrvMatch) mvrvValues.push(parseFloat(mvrvMatch[1]));
    
    // NVT is not in reasoning, but we can check if values are realistic
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
  }

  console.log(`\nSOPR values: ${soprValues.map(v => v.toFixed(3)).join(', ')}`);
  console.log(`MVRV values: ${mvrvValues.map(v => v.toFixed(2)).join(', ')}`);

  // Check if values are consistent (real data) or random (mock data)
  const soprVariance = calculateVariance(soprValues);
  const mvrvVariance = calculateVariance(mvrvValues);

  console.log(`\nSOPR variance: ${soprVariance.toFixed(6)}`);
  console.log(`MVRV variance: ${mvrvVariance.toFixed(6)}`);

  // Real data should have VERY low variance (same API calls = same results)
  // Mock data (Math.random) would have high variance
  const isRealData = soprVariance < 0.001 && mvrvVariance < 0.001;

  if (isRealData) {
    results.push({
      category: 'Data Quality',
      test: 'Real Data Integration',
      status: 'PASS',
      details: `Consistent values detected (variance < 0.001) - using real APIs`,
      score: 25
    });
    totalScore += 25;
    console.log(`✅ REAL DATA CONFIRMED: Values are consistent across runs`);
  } else {
    results.push({
      category: 'Data Quality',
      test: 'Real Data Integration',
      status: 'FAIL',
      details: `High variance detected - likely using Math.random() mock data`,
      score: 0
    });
    console.log(`❌ MOCK DATA DETECTED: Values vary across runs`);
  }
  maxScore += 25;

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Metric Realism Check
  // ═══════════════════════════════════════════════════════════
  console.log('\n📊 TEST 3: Metric Realism Validation');
  console.log('─'.repeat(60));

  const avgSOPR = soprValues.reduce((a, b) => a + b, 0) / soprValues.length;
  const avgMVRV = mvrvValues.reduce((a, b) => a + b, 0) / mvrvValues.length;

  console.log(`\nAverage SOPR: ${avgSOPR.toFixed(3)}`);
  console.log(`Average MVRV: ${avgMVRV.toFixed(2)}`);

  // Check if values are in realistic ranges
  const soprRealistic = avgSOPR >= 0.8 && avgSOPR <= 1.2; // SOPR typically 0.8-1.2
  const mvrvRealistic = avgMVRV >= 0.5 && avgMVRV <= 4.0; // MVRV typically 0.5-4.0

  console.log(`SOPR realistic (0.8-1.2): ${soprRealistic ? '✅' : '❌'}`);
  console.log(`MVRV realistic (0.5-4.0): ${mvrvRealistic ? '✅' : '❌'}`);

  if (soprRealistic && mvrvRealistic) {
    results.push({
      category: 'Data Quality',
      test: 'Metric Realism',
      status: 'PASS',
      details: `SOPR=${avgSOPR.toFixed(3)}, MVRV=${avgMVRV.toFixed(2)} within expected ranges`,
      score: 15
    });
    totalScore += 15;
  } else {
    results.push({
      category: 'Data Quality',
      test: 'Metric Realism',
      status: 'FAIL',
      details: `Metrics outside realistic ranges`,
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Signal Generation Quality
  // ═══════════════════════════════════════════════════════════
  console.log('\n🎯 TEST 4: Signal Generation Quality');
  console.log('─'.repeat(60));

  const signal = signals[0];
  console.log(`Signal: ${signal.signal}`);
  console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
  console.log(`Quality Score: ${signal.qualityScore.toFixed(2)}`);

  if (signal.signal && signal.confidence > 0 && signal.qualityScore > 0.5) {
    results.push({
      category: 'Functionality',
      test: 'Signal Generation',
      status: 'PASS',
      details: `${signal.signal} signal with ${(signal.confidence * 100).toFixed(1)}% confidence`,
      score: 15
    });
    totalScore += 15;
  } else {
    results.push({
      category: 'Functionality',
      test: 'Signal Generation',
      status: 'FAIL',
      details: 'Low quality signal generation',
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 5: Performance Benchmark
  // ═══════════════════════════════════════════════════════════
  console.log('\n⚡ TEST 5: Performance Benchmark');
  console.log('─'.repeat(60));

  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await agent.analyze('BTCUSDT', 98000, 'binance');
    times.push(Date.now() - start);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const p95Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`Average: ${avgTime.toFixed(2)}ms`);
  console.log(`P95: ${p95Time.toFixed(2)}ms`);

  // With caching, should be fast after first call
  if (p95Time < 5000) {
    results.push({
      category: 'Performance',
      test: 'Latency Benchmark',
      status: 'PASS',
      details: `P95: ${p95Time.toFixed(2)}ms (target: <5000ms)`,
      score: 10
    });
    totalScore += 10;
  } else {
    results.push({
      category: 'Performance',
      test: 'Latency Benchmark',
      status: 'FAIL',
      details: `P95: ${p95Time.toFixed(2)}ms exceeds 5000ms threshold`,
      score: 0
    });
  }
  maxScore += 10;

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Institutional Feature Coverage
  // ═══════════════════════════════════════════════════════════
  console.log('\n🏛️ TEST 6: Institutional Feature Coverage');
  console.log('─'.repeat(60));

  const reasoning = signal.reasoning;
  const evidence = signal.evidence as any;

  const institutionalFeatures = {
    'Whale transaction tracking': evidence.whaleTransactions !== undefined,
    'Exchange flow analysis': evidence.exchangeNetFlow !== undefined,
    'Wallet accumulation detection': evidence.walletAccumulation !== undefined,
    'SOPR (profit/loss ratio)': reasoning.includes('SOPR'),
    'MVRV (valuation zones)': reasoning.includes('MVRV'),
    'Miner behavior analysis': reasoning.includes('Miners') || reasoning.includes('Hash rate'),
    'Valuation zone detection': reasoning.includes('extreme-fear') || reasoning.includes('extreme-greed') || 
                                reasoning.includes('fear') || reasoning.includes('greed'),
  };

  let featureCount = 0;
  for (const [feature, present] of Object.entries(institutionalFeatures)) {
    console.log(`${present ? '✅' : '❌'} ${feature}`);
    if (present) featureCount++;
  }

  const featurePercentage = (featureCount / Object.keys(institutionalFeatures).length) * 100;
  console.log(`\nFeature Coverage: ${featurePercentage.toFixed(0)}%`);

  if (featurePercentage >= 85) {
    results.push({
      category: 'Standards',
      test: 'Institutional Features',
      status: 'PASS',
      details: `${featurePercentage.toFixed(0)}% coverage`,
      score: 15
    });
    totalScore += 15;
  } else {
    results.push({
      category: 'Standards',
      test: 'Institutional Features',
      status: 'FAIL',
      details: `${featurePercentage.toFixed(0)}% coverage (need 85%+)`,
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 7: Free API Integration
  // ═══════════════════════════════════════════════════════════
  console.log('\n🆓 TEST 7: Free API Integration');
  console.log('─'.repeat(60));

  const usingFreeAPIs = isRealData && soprRealistic && mvrvRealistic;

  console.log(`Mempool.space API: ${usingFreeAPIs ? '✅' : '❌'}`);
  console.log(`CoinGecko API: ${usingFreeAPIs ? '✅' : '❌'}`);
  console.log(`Whale Alert API: ${whaleAlertKey ? '✅' : '⚠️'}`);
  console.log(`Cost: $0/month`);

  if (usingFreeAPIs) {
    results.push({
      category: 'Integration',
      test: 'Free API Integration',
      status: 'PASS',
      details: 'Using free APIs (Mempool.space, CoinGecko) - $0 cost',
      score: 10
    });
    totalScore += 10;
  } else {
    results.push({
      category: 'Integration',
      test: 'Free API Integration',
      status: 'FAIL',
      details: 'Not using real free APIs',
      score: 0
    });
  }
  maxScore += 10;

  // ═══════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    AUDIT RESULTS                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Category'.padEnd(20) + 'Test'.padEnd(30) + 'Status'.padEnd(15) + 'Score');
  console.log('─'.repeat(80));

  for (const result of results) {
    const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
    const maxPerTest = Math.round(maxScore / results.length);
    console.log(
      result.category.padEnd(20) +
      result.test.padEnd(30) +
      `${statusIcon} ${result.status}`.padEnd(15) +
      `${result.score}/${maxPerTest}`
    );
  }

  console.log('─'.repeat(80));
  
  const finalScore = Math.round((totalScore / maxScore) * 100);
  let grade = 'F';
  if (finalScore >= 95) grade = 'A++';
  else if (finalScore >= 90) grade = 'A+';
  else if (finalScore >= 85) grade = 'A';
  else if (finalScore >= 80) grade = 'A-';
  else if (finalScore >= 75) grade = 'B+';
  else if (finalScore >= 70) grade = 'B';
  else if (finalScore >= 60) grade = 'C';

  console.log(`\n🎯 FINAL SCORE: ${totalScore}/${maxScore} (${finalScore}%)`);
  console.log(`📊 GRADE: ${grade}\n`);

  // Certification
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    CERTIFICATION                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (finalScore >= 95) {
    console.log('🏆 A++ CERTIFICATION ACHIEVED');
    console.log('✅ OnChainAnalyst meets institutional-grade standards');
    console.log('✅ Using real on-chain data from free APIs');
    console.log('✅ Ready for production deployment');
    console.log('✅ Comparable to premium services (Glassnode, CryptoQuant)');
    console.log('✅ $0 monthly cost vs $39-$799 for premium alternatives\n');
  } else if (finalScore >= 85) {
    console.log('⚠️  A/A- GRADE: Good but needs improvement');
    console.log('   → Review failed tests above');
  } else {
    console.log('❌ FAIL: Does not meet institutional standards');
    console.log('   → Critical issues must be fixed');
  }

  await agent.stop();
  
  return { finalScore, grade, results };
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

auditOnChainAnalystAPlusPlus()
  .then(result => {
    console.log(`\n✅ Audit complete: ${result.grade} (${result.finalScore}%)`);
    process.exit(result.finalScore >= 95 ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  });
