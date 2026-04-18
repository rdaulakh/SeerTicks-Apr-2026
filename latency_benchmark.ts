/**
 * Comprehensive Latency Benchmark
 * 
 * Measures end-to-end latency for institutional trading operations
 */

import { EventDrivenPositionEngine } from './server/services/EventDrivenPositionEngine';
import { UltraLowLatencyTickProcessor } from './server/services/UltraLowLatencyTickProcessor';

interface BenchmarkResult {
  name: string;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  throughput: number;
  samples: number;
}

function calculatePercentiles(data: number[]): { p50: number; p95: number; p99: number; avg: number; min: number; max: number } {
  const sorted = [...data].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
  };
}

async function benchmarkTickProcessing(): Promise<BenchmarkResult> {
  const processor = new UltraLowLatencyTickProcessor({
    monitoringIntervalMs: 10,
    windowSizes: [100, 500, 1000],
    maxTicksPerSymbol: 10000,
    signalThreshold: 0.3,
    enableMicrostructure: true,
  });

  processor.start();
  const latencies: number[] = [];
  const iterations = 10000;

  const startTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    const tickStart = performance.now();
    processor.processTick({
      symbol: 'BTCUSDT',
      price: 50000 + (i % 1000),
      quantity: 1,
      timestamp: Date.now(),
      isBuyerMaker: i % 2 === 0,
      exchange: 'binance',
    });
    latencies.push(performance.now() - tickStart);
  }
  const totalTime = performance.now() - startTime;
  processor.stop();

  const stats = calculatePercentiles(latencies);
  return {
    name: 'Tick Processing',
    ...stats,
    throughput: (iterations / totalTime) * 1000,
    samples: iterations,
  };
}

async function benchmarkPositionEngine(): Promise<BenchmarkResult> {
  const engine = new EventDrivenPositionEngine({
    maxTicksPerSecond: 10000,
    microBatchWindowMs: 0.5,
  });

  // Add position
  engine.addPosition({
    id: 'bench_pos',
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: 50000,
    quantity: 0.1,
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  const latencies: number[] = [];
  const iterations = 10000;

  const startTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    const eventStart = performance.now();
    engine.injectEvent({
      type: 'price_tick',
      symbol: 'BTCUSDT',
      timestamp: performance.now(),
      priority: 1,
      data: { 
        price: 50000 + (i % 1000), 
        bid: 49999 + (i % 1000), 
        ask: 50001 + (i % 1000), 
        volume: 100 
      },
    });
    latencies.push(performance.now() - eventStart);
  }
  const totalTime = performance.now() - startTime;

  const stats = calculatePercentiles(latencies);
  return {
    name: 'Position Engine Event Injection',
    ...stats,
    throughput: (iterations / totalTime) * 1000,
    samples: iterations,
  };
}

async function benchmarkSignalGeneration(): Promise<BenchmarkResult> {
  const processor = new UltraLowLatencyTickProcessor({
    monitoringIntervalMs: 10,
    windowSizes: [100, 500, 1000],
    maxTicksPerSymbol: 10000,
    signalThreshold: 0.3,
    enableMicrostructure: true,
  });

  processor.start();

  // Warm up with ticks
  for (let i = 0; i < 1000; i++) {
    processor.processTick({
      symbol: 'BTCUSDT',
      price: 50000 + (i % 100),
      quantity: 1,
      timestamp: Date.now(),
      isBuyerMaker: i % 2 === 0,
      exchange: 'binance',
    });
  }

  // Measure signal generation
  const latencies: number[] = [];
  const iterations = 1000;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    processor.processTick({
      symbol: 'BTCUSDT',
      price: 50000 + (i % 100) + Math.random() * 10,
      quantity: Math.random() * 10,
      timestamp: Date.now(),
      isBuyerMaker: Math.random() > 0.5,
      exchange: 'binance',
    });
    latencies.push(performance.now() - start);
  }

  processor.stop();

  const stats = calculatePercentiles(latencies);
  return {
    name: 'Signal Generation',
    ...stats,
    throughput: iterations / (latencies.reduce((a, b) => a + b, 0) / 1000),
    samples: iterations,
  };
}

async function benchmarkBurstHandling(): Promise<BenchmarkResult> {
  const engine = new EventDrivenPositionEngine({
    maxTicksPerSecond: 10000,
    microBatchWindowMs: 0.5,
    enableBackpressure: true,
  });

  engine.addPosition({
    id: 'burst_pos',
    symbol: 'BTCUSDT',
    side: 'long',
    entryPrice: 50000,
    quantity: 0.1,
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  const burstSize = 10000;
  const latencies: number[] = [];

  const startTime = performance.now();
  for (let i = 0; i < burstSize; i++) {
    const eventStart = performance.now();
    engine.injectEvent({
      type: 'price_tick',
      symbol: 'BTCUSDT',
      timestamp: performance.now(),
      priority: 1,
      data: { 
        price: 50000 + (i % 1000), 
        bid: 49999 + (i % 1000), 
        ask: 50001 + (i % 1000), 
        volume: 100 
      },
    });
    latencies.push(performance.now() - eventStart);
  }
  const totalTime = performance.now() - startTime;

  const stats = calculatePercentiles(latencies);
  return {
    name: 'Burst Handling (10k events)',
    ...stats,
    throughput: (burstSize / totalTime) * 1000,
    samples: burstSize,
  };
}

async function main() {
  console.log('========================================');
  console.log('SEER LATENCY BENCHMARK');
  console.log('========================================\n');

  const results: BenchmarkResult[] = [];

  console.log('Running Tick Processing Benchmark...');
  results.push(await benchmarkTickProcessing());

  console.log('Running Position Engine Benchmark...');
  results.push(await benchmarkPositionEngine());

  console.log('Running Signal Generation Benchmark...');
  results.push(await benchmarkSignalGeneration());

  console.log('Running Burst Handling Benchmark...');
  results.push(await benchmarkBurstHandling());

  console.log('\n========================================');
  console.log('BENCHMARK RESULTS');
  console.log('========================================\n');

  // Print table
  console.log('| Benchmark | P50 (μs) | P95 (μs) | P99 (μs) | Avg (μs) | Throughput (events/s) |');
  console.log('|-----------|----------|----------|----------|----------|----------------------|');
  
  for (const r of results) {
    console.log(`| ${r.name.padEnd(35)} | ${(r.p50 * 1000).toFixed(1).padStart(8)} | ${(r.p95 * 1000).toFixed(1).padStart(8)} | ${(r.p99 * 1000).toFixed(1).padStart(8)} | ${(r.avg * 1000).toFixed(1).padStart(8)} | ${r.throughput.toFixed(0).padStart(20)} |`);
  }

  console.log('\n========================================');
  console.log('INSTITUTIONAL GRADE ASSESSMENT');
  console.log('========================================\n');

  // Institutional thresholds
  const thresholds = {
    tickP99: 100, // 100μs
    signalP99: 1000, // 1ms
    throughput: 10000, // 10k events/sec
  };

  const tickResult = results.find(r => r.name === 'Tick Processing')!;
  const signalResult = results.find(r => r.name === 'Signal Generation')!;
  const burstResult = results.find(r => r.name === 'Burst Handling (10k events)')!;

  const tickPass = tickResult.p99 * 1000 < thresholds.tickP99;
  const signalPass = signalResult.p99 * 1000 < thresholds.signalP99;
  const throughputPass = burstResult.throughput > thresholds.throughput;

  console.log(`Tick Processing P99 < 100μs: ${tickPass ? '✅ PASS' : '❌ FAIL'} (${(tickResult.p99 * 1000).toFixed(1)}μs)`);
  console.log(`Signal Generation P99 < 1ms: ${signalPass ? '✅ PASS' : '❌ FAIL'} (${(signalResult.p99 * 1000).toFixed(1)}μs)`);
  console.log(`Burst Throughput > 10k/s: ${throughputPass ? '✅ PASS' : '❌ FAIL'} (${burstResult.throughput.toFixed(0)}/s)`);

  const allPass = tickPass && signalPass && throughputPass;
  console.log(`\nOverall Latency Grade: ${allPass ? 'A++ (Institutional)' : 'Below Institutional'}`);
}

main().catch(console.error);
