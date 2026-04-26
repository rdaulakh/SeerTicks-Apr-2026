/**
 * Phase 43 (real) — train a logistic-regression classifier on the N-champion
 * trade dataset. The goal is to find a probability gate that separates
 * winners from losers using features available at entry time.
 *
 * Features per trade (all available at entry time):
 *   - consensus.strength
 *   - per-agent confidence × direction-vs-trade (signed): 5 features
 *   - atr/price ratio
 *   - sin/cos(hourOfDay/24)
 *   - sin/cos(dayOfWeek/7)
 *   - side (long=+1 / short=-1)
 *   - 3 symbol one-hots
 *   - n_eligible_agents
 *
 * Output: the model weights and the OOS evaluation (test set = last 20%
 * of trades chronologically — walk-forward, no leakage).
 *
 * If AUC > 0.60 on test, the model has predictive edge → can be wired
 * into the backtest as an entry-gate.
 *
 * Usage:
 *   npx tsx server/scripts/train-trade-classifier.ts <trade-file.json> [more...]
 */
import * as fs from 'fs';
import * as path from 'path';

interface AgentVote {
  agentName: string;
  signal: string;
  confidence: number;
}
interface Trade {
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  entryConsensus: { direction: string; strength: number };
  entryAgentVotes: AgentVote[];
  atrEntry: number;
  netPnlAbs: number;
}

const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
const AGENT_NAMES = ['TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst', 'OrderbookImbalance', 'FundingRateAnalyst'];

function featurize(t: Trade): { x: number[]; y: number; meta: any } {
  const dir = t.entryConsensus.direction;
  const dirSign = dir === 'bullish' ? 1 : dir === 'bearish' ? -1 : 0;
  // Per-agent: signed confidence (positive if agrees, negative if disagrees, 0 if absent)
  const agentFeats: number[] = [];
  for (const name of AGENT_NAMES) {
    const v = t.entryAgentVotes.find((vt) => vt.agentName === name);
    if (!v || v.signal === 'neutral') {
      agentFeats.push(0);
    } else {
      const agree = v.signal === dir ? 1 : -1;
      agentFeats.push(agree * v.confidence);
    }
  }
  const atrPct = (t.atrEntry / t.entryPrice) * 100;
  const d = new Date(t.entryTime);
  const hour = d.getUTCHours();
  const day = d.getUTCDay();
  const symbolOH = SYMBOLS.map((s) => (s === t.symbol ? 1 : 0));
  const sideSign = t.side === 'long' ? 1 : -1;
  const nEligible = t.entryAgentVotes.length;
  const x = [
    1, // bias
    t.entryConsensus.strength,
    ...agentFeats,
    atrPct,
    Math.sin((2 * Math.PI * hour) / 24),
    Math.cos((2 * Math.PI * hour) / 24),
    Math.sin((2 * Math.PI * day) / 7),
    Math.cos((2 * Math.PI * day) / 7),
    sideSign,
    ...symbolOH,
    nEligible,
  ];
  const y = t.netPnlAbs > 0 ? 1 : 0;
  return { x, y, meta: { symbol: t.symbol, dir, strength: t.entryConsensus.strength } };
}

function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }

function trainLogistic(
  X: number[][],
  Y: number[],
  lr: number,
  iters: number,
  l2: number,
): number[] {
  const D = X[0].length;
  const N = X.length;
  let w = new Array(D).fill(0);
  for (let it = 0; it < iters; it++) {
    const grad = new Array(D).fill(0);
    let loss = 0;
    for (let i = 0; i < N; i++) {
      const z = w.reduce((s, wj, j) => s + wj * X[i][j], 0);
      const p = sigmoid(z);
      const err = p - Y[i];
      for (let j = 0; j < D; j++) grad[j] += err * X[i][j];
      loss += -(Y[i] * Math.log(Math.max(1e-9, p)) + (1 - Y[i]) * Math.log(Math.max(1e-9, 1 - p)));
    }
    for (let j = 0; j < D; j++) {
      grad[j] = grad[j] / N + l2 * w[j];
      w[j] -= lr * grad[j];
    }
    if (it % 500 === 0) {
      console.log(`  iter ${it}: loss=${(loss / N).toFixed(4)}`);
    }
  }
  return w;
}

function predict(x: number[], w: number[]): number {
  return sigmoid(w.reduce((s, wj, j) => s + wj * x[j], 0));
}

function auc(probs: number[], labels: number[]): number {
  // Mann-Whitney U on probabilities, computing P(prob_pos > prob_neg).
  const pos = probs.filter((_, i) => labels[i] === 1);
  const neg = probs.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return 0.5;
  let count = 0;
  for (const p of pos) for (const n of neg) if (p > n) count++; else if (p === n) count += 0.5;
  return count / (pos.length * neg.length);
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: train-trade-classifier.ts <trade-file.json> [more...]');
    process.exit(1);
  }
  const allTrades: Trade[] = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const trades: Trade[] = data.trades ?? data;
    allTrades.push(...trades);
    console.log(`[loaded] ${path.basename(f)}: ${trades.length} trades`);
  }
  // Sort chronologically
  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  // Featurize
  const feats = allTrades.map(featurize);
  console.log(`\n[total] ${feats.length} trades  baseline WR ${(feats.filter((f) => f.y === 1).length / feats.length * 100).toFixed(1)}%`);
  console.log(`[features] dim=${feats[0].x.length}`);

  // Walk-forward split: train on first 80%, test on last 20%
  const splitIdx = Math.floor(feats.length * 0.8);
  const trainFeats = feats.slice(0, splitIdx);
  const testFeats = feats.slice(splitIdx);
  const trainX = trainFeats.map((f) => f.x);
  const trainY = trainFeats.map((f) => f.y);
  const testX = testFeats.map((f) => f.x);
  const testY = testFeats.map((f) => f.y);

  console.log(`\n[split] train=${trainFeats.length} (WR ${(trainY.filter(y => y === 1).length / trainY.length * 100).toFixed(1)}%)`);
  console.log(`[split] test=${testFeats.length} (WR ${(testY.filter(y => y === 1).length / testY.length * 100).toFixed(1)}%)`);

  // Standardize features (mean 0, sd 1) using train stats
  const D = trainX[0].length;
  const meanX = new Array(D).fill(0);
  for (const x of trainX) for (let j = 0; j < D; j++) meanX[j] += x[j];
  for (let j = 0; j < D; j++) meanX[j] /= trainX.length;
  const stdX = new Array(D).fill(0);
  for (const x of trainX) for (let j = 0; j < D; j++) stdX[j] += (x[j] - meanX[j]) ** 2;
  for (let j = 0; j < D; j++) stdX[j] = Math.sqrt(stdX[j] / trainX.length) || 1;
  // Don't standardize bias term
  meanX[0] = 0;
  stdX[0] = 1;
  const normalize = (X: number[][]) => X.map((x) => x.map((v, j) => (v - meanX[j]) / stdX[j]));
  const trainXn = normalize(trainX);
  const testXn = normalize(testX);

  console.log(`\n[train] starting...`);
  const w = trainLogistic(trainXn, trainY, 0.1, 2000, 0.01);

  // Train metrics
  const trainProbs = trainXn.map((x) => predict(x, w));
  const trainAUC = auc(trainProbs, trainY);
  const trainAcc = trainProbs.filter((p, i) => (p > 0.5 ? 1 : 0) === trainY[i]).length / trainY.length;
  console.log(`\n[train] AUC=${trainAUC.toFixed(4)}  ACC@0.5=${(trainAcc * 100).toFixed(1)}%`);

  // Test metrics
  const testProbs = testXn.map((x) => predict(x, w));
  const testAUC = auc(testProbs, testY);
  const testAcc = testProbs.filter((p, i) => (p > 0.5 ? 1 : 0) === testY[i]).length / testY.length;
  console.log(`[test]  AUC=${testAUC.toFixed(4)}  ACC@0.5=${(testAcc * 100).toFixed(1)}%`);

  // Probability threshold sweep — what does each gate value yield on test?
  console.log(`\n=== Test-set gate sweep ===`);
  console.log(`thresh   kept  WR     vs baseline`);
  const baselineTestWR = testY.filter((y) => y === 1).length / testY.length * 100;
  for (const thr of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
    const kept = testProbs.map((p, i) => p >= thr ? i : -1).filter((i) => i >= 0);
    const keptY = kept.map((i) => testY[i]);
    const keptWR = keptY.length ? keptY.filter((y) => y === 1).length / keptY.length * 100 : 0;
    const keep = (kept.length / testProbs.length * 100);
    console.log(`  ${thr.toFixed(2)}    ${String(kept.length).padStart(4)}  ${keptWR.toFixed(1)}%  Δ${(keptWR - baselineTestWR).toFixed(1)}pp  (kept ${keep.toFixed(1)}%)`);
  }

  // Save weights
  const outDir = path.join(process.cwd(), 'data', 'backtest-yearly', 'models');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'trade-classifier-v1.json');
  fs.writeFileSync(outPath, JSON.stringify({
    version: 1,
    trainedAt: new Date().toISOString(),
    nTrain: trainFeats.length,
    nTest: testFeats.length,
    trainAUC,
    testAUC,
    featureNames: [
      'bias',
      'consensus_strength',
      ...AGENT_NAMES.map((n) => `${n}_signed_conf`),
      'atrPct',
      'sin_hour',
      'cos_hour',
      'sin_day',
      'cos_day',
      'side',
      ...SYMBOLS.map((s) => `is_${s}`),
      'n_eligible',
    ],
    meanX,
    stdX,
    weights: w,
  }, null, 2));
  console.log(`\n[saved] ${outPath}`);
}

main();
