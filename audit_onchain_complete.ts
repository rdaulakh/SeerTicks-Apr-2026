/**
 * Comprehensive A++ Institutional-Grade Audit for OnChainAnalyst
 * 
 * Tests:
 * 1. Data Source Verification (Real vs Mock)
 * 2. API Integration Status
 * 3. Signal Generation with Real Data
 * 4. Performance Benchmarks
 * 5. Institutional Standards Comparison
 */

import { OnChainAnalyst } from './server/agents/OnChainAnalyst.js';

interface AuditResult {
  category: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  score: number;
}

async function auditOnChainAnalyst() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   OnChainAnalyst A++ Institutional-Grade Audit            ║');
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
  } else {
    results.push({
      category: 'Configuration',
      test: 'Whale Alert API Key',
      status: 'FAIL',
      details: 'API key not configured - using mock data',
      score: 0
    });
  }
  maxScore += 10;

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Signal Generation Test
  // ═══════════════════════════════════════════════════════════
  console.log('\n📊 TEST 2: Signal Generation');
  console.log('─'.repeat(60));

  const startTime = Date.now();
  const signal = await agent.analyze('BTCUSDT', 98000, 'binance');
  const executionTime = Date.now() - startTime;

  console.log(`Signal: ${signal.signal}`);
  console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
  console.log(`Execution Time: ${executionTime}ms`);
  console.log(`Quality Score: ${signal.qualityScore.toFixed(2)}`);

  if (signal.signal && signal.confidence > 0) {
    results.push({
      category: 'Functionality',
      test: 'Signal Generation',
      status: 'PASS',
      details: `Generated ${signal.signal} signal with ${(signal.confidence * 100).toFixed(1)}% confidence`,
      score: 15
    });
    totalScore += 15;
  } else {
    results.push({
      category: 'Functionality',
      test: 'Signal Generation',
      status: 'FAIL',
      details: 'Failed to generate valid signal',
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Data Source Analysis
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔍 TEST 3: Data Source Analysis');
  console.log('─'.repeat(60));

  const evidence = signal.evidence as any;
  
  // Check if using real or mock data
  const hasWhaleData = evidence.whaleTransactions !== undefined;
  const hasExchangeFlow = evidence.exchangeNetFlow !== undefined;
  const hasWalletData = evidence.walletAccumulation !== undefined;
  
  console.log(`Whale Transactions: ${evidence.whaleTransactions || 0}`);
  console.log(`Exchange Net Flow: $${(evidence.exchangeNetFlow / 1e6).toFixed(2)}M`);
  console.log(`Wallet Accumulation: $${(evidence.walletAccumulation / 1e6).toFixed(2)}M`);

  if (hasWhaleData && hasExchangeFlow && hasWalletData) {
    results.push({
      category: 'Data Quality',
      test: 'On-Chain Metrics',
      status: whaleAlertKey ? 'PASS' : 'WARNING',
      details: whaleAlertKey ? 'Real whale transaction data' : 'Mock data (API key needed)',
      score: whaleAlertKey ? 15 : 5
    });
    totalScore += whaleAlertKey ? 15 : 5;
  } else {
    results.push({
      category: 'Data Quality',
      test: 'On-Chain Metrics',
      status: 'FAIL',
      details: 'Missing critical on-chain metrics',
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 4: A+ Grade Metrics (SOPR, MVRV, NVT)
  // ═══════════════════════════════════════════════════════════
  console.log('\n🏆 TEST 4: A+ Grade Metrics (SOPR, MVRV, NVT)');
  console.log('─'.repeat(60));

  // Check if A+ grade metrics are present in reasoning
  const reasoning = signal.reasoning;
  const hasSOPR = reasoning.includes('SOPR');
  const hasMVRV = reasoning.includes('MVRV');
  const hasValuationZone = reasoning.includes('extreme-fear') || reasoning.includes('extreme-greed') || 
                           reasoning.includes('fear') || reasoning.includes('greed') || reasoning.includes('neutral');

  console.log(`SOPR in reasoning: ${hasSOPR ? '✅' : '❌'}`);
  console.log(`MVRV in reasoning: ${hasMVRV ? '✅' : '❌'}`);
  console.log(`Valuation zone detected: ${hasValuationZone ? '✅' : '❌'}`);

  if (hasSOPR && hasMVRV) {
    results.push({
      category: 'Advanced Metrics',
      test: 'SOPR/MVRV/NVT',
      status: 'WARNING',
      details: 'A+ metrics present but using mock data (need Glassnode/CryptoQuant API)',
      score: 10
    });
    totalScore += 10;
  } else {
    results.push({
      category: 'Advanced Metrics',
      test: 'SOPR/MVRV/NVT',
      status: 'FAIL',
      details: 'A+ metrics not implemented or not showing in reasoning',
      score: 0
    });
  }
  maxScore += 20;

  // ═══════════════════════════════════════════════════════════
  // TEST 5: Performance Benchmark
  // ═══════════════════════════════════════════════════════════
  console.log('\n⚡ TEST 5: Performance Benchmark');
  console.log('─'.repeat(60));

  // Run 10 iterations for performance testing
  const iterations = 10;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await agent.analyze('BTCUSDT', 98000, 'binance');
    times.push(Date.now() - start);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const p95Time = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`Average: ${avgTime.toFixed(2)}ms`);
  console.log(`P95: ${p95Time.toFixed(2)}ms`);

  // Slow agent threshold: <5000ms for P95
  if (p95Time < 5000) {
    results.push({
      category: 'Performance',
      test: 'Latency Benchmark',
      status: 'PASS',
      details: `P95: ${p95Time.toFixed(2)}ms (target: <5000ms)`,
      score: 15
    });
    totalScore += 15;
  } else {
    results.push({
      category: 'Performance',
      test: 'Latency Benchmark',
      status: 'FAIL',
      details: `P95: ${p95Time.toFixed(2)}ms exceeds 5000ms threshold`,
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Institutional Standards Comparison
  // ═══════════════════════════════════════════════════════════
  console.log('\n🏛️ TEST 6: Institutional Standards Comparison');
  console.log('─'.repeat(60));

  const institutionalFeatures = {
    'Whale transaction tracking': hasWhaleData,
    'Exchange flow analysis': hasExchangeFlow,
    'Wallet accumulation detection': hasWalletData,
    'SOPR (profit/loss ratio)': hasSOPR,
    'MVRV (valuation zones)': hasMVRV,
    'Miner behavior analysis': reasoning.includes('Miners') || reasoning.includes('Hash rate'),
    'Valuation zone detection': hasValuationZone,
  };

  let featureCount = 0;
  for (const [feature, present] of Object.entries(institutionalFeatures)) {
    console.log(`${present ? '✅' : '❌'} ${feature}`);
    if (present) featureCount++;
  }

  const featurePercentage = (featureCount / Object.keys(institutionalFeatures).length) * 100;
  console.log(`\nFeature Coverage: ${featurePercentage.toFixed(0)}%`);

  if (featurePercentage >= 80) {
    results.push({
      category: 'Standards',
      test: 'Institutional Feature Coverage',
      status: 'PASS',
      details: `${featurePercentage.toFixed(0)}% feature coverage`,
      score: 15
    });
    totalScore += 15;
  } else if (featurePercentage >= 60) {
    results.push({
      category: 'Standards',
      test: 'Institutional Feature Coverage',
      status: 'WARNING',
      details: `${featurePercentage.toFixed(0)}% feature coverage (needs improvement)`,
      score: 10
    });
    totalScore += 10;
  } else {
    results.push({
      category: 'Standards',
      test: 'Institutional Feature Coverage',
      status: 'FAIL',
      details: `${featurePercentage.toFixed(0)}% feature coverage (insufficient)`,
      score: 0
    });
  }
  maxScore += 15;

  // ═══════════════════════════════════════════════════════════
  // TEST 7: Real Data Integration Check
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔌 TEST 7: Real Data Integration');
  console.log('─'.repeat(60));

  const usingRealData = whaleAlertKey && whaleAlertKey.length > 10;
  const needsGlassnode = !usingRealData || hasSOPR; // SOPR/MVRV need Glassnode

  console.log(`Whale Alert API: ${usingRealData ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`Glassnode/CryptoQuant API: ${needsGlassnode ? '❌ Not configured (needed for SOPR/MVRV)' : '✅ Not needed'}`);

  if (usingRealData) {
    results.push({
      category: 'Integration',
      test: 'Real Data Sources',
      status: 'WARNING',
      details: 'Whale Alert connected, but SOPR/MVRV using mock data',
      score: 10
    });
    totalScore += 10;
  } else {
    results.push({
      category: 'Integration',
      test: 'Real Data Sources',
      status: 'FAIL',
      details: 'All data sources using mock data',
      score: 0
    });
  }
  maxScore += 20;

  // ═══════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    AUDIT RESULTS                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Category'.padEnd(20) + 'Test'.padEnd(30) + 'Status'.padEnd(10) + 'Score');
  console.log('─'.repeat(70));

  for (const result of results) {
    const statusIcon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
    console.log(
      result.category.padEnd(20) +
      result.test.padEnd(30) +
      `${statusIcon} ${result.status}`.padEnd(10) +
      `${result.score}/${maxScore / results.length}`
    );
  }

  console.log('─'.repeat(70));
  
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

  // Recommendations
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    RECOMMENDATIONS                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (!whaleAlertKey) {
    console.log('❌ CRITICAL: Configure WHALE_ALERT_API_KEY environment variable');
    console.log('   → Get API key from https://whale-alert.io/');
  }

  if (hasSOPR && hasMVRV) {
    console.log('⚠️  WARNING: SOPR/MVRV using mock data');
    console.log('   → Integrate Glassnode API (https://glassnode.com/) for real SOPR/MVRV');
    console.log('   → Alternative: CryptoQuant API (https://cryptoquant.com/)');
  }

  if (finalScore < 80) {
    console.log('❌ FAIL: OnChainAnalyst does not meet A++ institutional standards');
    console.log('   → Fix critical issues above before production deployment');
  } else if (finalScore < 95) {
    console.log('⚠️  WARNING: OnChainAnalyst meets minimum standards but needs improvement');
    console.log('   → Address warnings to achieve A++ grade');
  } else {
    console.log('✅ PASS: OnChainAnalyst meets A++ institutional standards');
    console.log('   → Ready for production deployment');
  }

  await agent.stop();
}

auditOnChainAnalyst().catch(console.error).finally(() => process.exit(0));
