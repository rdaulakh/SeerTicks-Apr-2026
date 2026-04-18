/**
 * NewsSentinel A++ Grade Performance Benchmark
 * Tests: API latency, impact scoring, sentiment analysis, caching
 */

import { NewsSentinel } from './server/agents/NewsSentinel.ts';

async function runBenchmark() {
  console.log('='.repeat(80));
  console.log('NewsSentinel A++ Grade Performance Benchmark');
  console.log('='.repeat(80));
  console.log('');

  const agent = new NewsSentinel();
  await agent.start();

  const testSymbol = 'BTC/USDT';
  const iterations = 10;
  const latencies = [];

  console.log(`Test 1: API Latency & News Fetching (${iterations} iterations)`);
  console.log('-'.repeat(80));

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const signal = await agent.analyze(testSymbol);
    const latency = Date.now() - start;
    latencies.push(latency);

    console.log(`Iteration ${i + 1}/${iterations}:`);
    console.log(`  Latency: ${latency}ms`);
    console.log(`  Signal: ${signal.signal} (confidence: ${(signal.confidence * 100).toFixed(1)}%)`);
    console.log(`  News Count: ${signal.evidence?.newsCount || 0}`);
    console.log(`  Processing Time: ${signal.processingTime}ms`);
    console.log('');

    // Wait 100ms between iterations to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  console.log('='.repeat(80));
  console.log('Performance Summary');
  console.log('='.repeat(80));
  console.log(`Iterations: ${iterations}`);
  console.log(`Min Latency: ${min}ms`);
  console.log(`Max Latency: ${max}ms`);
  console.log(`Avg Latency: ${avg.toFixed(2)}ms`);
  console.log(`P50 Latency: ${p50}ms`);
  console.log(`P95 Latency: ${p95}ms`);
  console.log(`P99 Latency: ${p99}ms`);
  console.log('');

  // Test 2: Cache Performance
  console.log('Test 2: Cache Performance');
  console.log('-'.repeat(80));

  const cacheStart = Date.now();
  const cachedSignal = await agent.analyze(testSymbol);
  const cacheLatency = Date.now() - cacheStart;

  console.log(`Cached Request Latency: ${cacheLatency}ms`);
  console.log(`Cache Hit: ${cacheLatency < 100 ? 'YES' : 'NO'}`);
  console.log('');

  // Test 3: Impact Scoring Validation
  console.log('Test 3: Impact Scoring Validation');
  console.log('-'.repeat(80));

  const signal = await agent.analyze(testSymbol);
  console.log(`Signal: ${signal.signal}`);
  console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
  console.log(`Strength: ${(signal.strength * 100).toFixed(1)}%`);
  console.log(`Quality Score: ${(signal.qualityScore * 100).toFixed(1)}%`);
  console.log(`Reasoning: ${signal.reasoning}`);
  console.log('');

  // Grading
  console.log('='.repeat(80));
  console.log('A++ Grade Criteria');
  console.log('='.repeat(80));

  const criteria = [
    { name: 'P95 Latency < 500ms', pass: p95 < 500, value: `${p95}ms` },
    { name: 'Cache Hit < 100ms', pass: cacheLatency < 100, value: `${cacheLatency}ms` },
    { name: 'Avg Latency < 300ms', pass: avg < 300, value: `${avg.toFixed(2)}ms` },
    { name: 'News Fetching Works', pass: (signal.evidence?.newsCount || 0) > 0, value: `${signal.evidence?.newsCount || 0} items` },
    { name: 'Impact Scoring Active', pass: signal.reasoning.includes('impact score'), value: 'YES' },
  ];

  let passCount = 0;
  criteria.forEach(c => {
    const status = c.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${c.name}: ${c.value}`);
    if (c.pass) passCount++;
  });

  console.log('');
  console.log(`Final Score: ${passCount}/${criteria.length} (${((passCount / criteria.length) * 100).toFixed(0)}%)`);
  
  if (passCount === criteria.length) {
    console.log('🎉 A++ GRADE ACHIEVED - INSTITUTIONAL QUALITY');
  } else if (passCount >= criteria.length * 0.8) {
    console.log('⭐ A GRADE - PRODUCTION READY');
  } else {
    console.log('⚠️  NEEDS IMPROVEMENT');
  }

  await agent.stop();
}

runBenchmark().catch(console.error);
