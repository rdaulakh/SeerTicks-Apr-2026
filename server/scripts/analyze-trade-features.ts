/**
 * Phase 43 prep — Trade feature analysis.
 *
 * Reads one or more yearly-backtest trade JSON files. For every trade,
 * extracts features available at entry time and the win/loss outcome.
 * Then computes per-feature win-rate slices to find:
 *   - which features predict winners
 *   - which thresholds are useful as a gate
 *
 * Lightweight statistical analysis (no ML library). The signal-quality
 * findings here become candidate gate rules for Phase 43-proper.
 *
 * Usage:
 *   npx tsx server/scripts/analyze-trade-features.ts <trade-file.json> [more...]
 */
import * as fs from 'fs';
import * as path from 'path';

interface Trade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  entryConsensus: { direction: string; strength: number };
  entryAgentVotes: Array<{ agentName: string; signal: string; confidence: number; reasoning: string }>;
  atrEntry: number;
  exitReason: string;
  holdMinutes: number;
  netPnlPct: number;
  netPnlAbs: number;
}

interface Features {
  // Outcome
  win: boolean;
  netPnlPct: number;
  exitReason: string;
  holdMinutes: number;
  // Features
  symbol: string;
  side: string;
  consensusStrength: number;
  agentCount: number;
  alignedAgentCount: number;
  contraAgentCount: number;
  alignedRatio: number;
  avgConfidence: number;
  avgAlignedConf: number;
  hasFunding: boolean;
  fundingAligned: boolean;
  hasTA: boolean;
  taIsRsiExtreme: boolean; // "RSI=XX" with XX outside 30-70
  taIsSmaStack: boolean;   // "RSI=XX sma20>sma50 close>sma20" pattern
  atrPctOfPrice: number;
  hourOfDay: number;
  dayOfWeek: number;
}

function extractFeatures(t: Trade): Features {
  const dir = t.entryConsensus.direction;
  const aligned = t.entryAgentVotes.filter((v) => v.signal === dir);
  const contra = t.entryAgentVotes.filter((v) => v.signal !== dir && v.signal !== 'neutral');
  const alignedConfSum = aligned.reduce((s, v) => s + v.confidence, 0);
  const totalConfSum = t.entryAgentVotes.reduce((s, v) => s + v.confidence, 0);
  const fundingVote = t.entryAgentVotes.find((v) => v.agentName === 'FundingRateAnalyst');
  const taVote = t.entryAgentVotes.find((v) => v.agentName === 'TechnicalAnalyst');
  let taIsRsiExtreme = false, taIsSmaStack = false;
  if (taVote) {
    const m = taVote.reasoning.match(/RSI=([\d.]+)/);
    if (m) {
      const rsi = parseFloat(m[1]);
      taIsRsiExtreme = rsi < 30 || rsi > 70;
      taIsSmaStack = !taIsRsiExtreme; // by elimination — TA only fires if either pattern matched
    }
  }
  const d = new Date(t.entryTime);
  return {
    win: t.netPnlPct > 0,
    netPnlPct: t.netPnlPct,
    exitReason: t.exitReason,
    holdMinutes: t.holdMinutes,
    symbol: t.symbol,
    side: t.side,
    consensusStrength: t.entryConsensus.strength,
    agentCount: t.entryAgentVotes.length,
    alignedAgentCount: aligned.length,
    contraAgentCount: contra.length,
    alignedRatio: aligned.length / Math.max(1, t.entryAgentVotes.length),
    avgConfidence: t.entryAgentVotes.length ? totalConfSum / t.entryAgentVotes.length : 0,
    avgAlignedConf: aligned.length ? alignedConfSum / aligned.length : 0,
    hasFunding: !!fundingVote,
    fundingAligned: !!fundingVote && fundingVote.signal === dir,
    hasTA: !!taVote,
    taIsRsiExtreme,
    taIsSmaStack,
    atrPctOfPrice: (t.atrEntry / t.entryPrice) * 100,
    hourOfDay: d.getUTCHours(),
    dayOfWeek: d.getUTCDay(),
  };
}

function bucketize(features: Features[], key: keyof Features, bins: number[] | string[]): void {
  console.log(`\n=== ${String(key)} ===`);
  if (typeof features[0]?.[key] === 'string' || typeof features[0]?.[key] === 'boolean') {
    const counts = new Map<string, { wins: number; total: number; pnl: number }>();
    for (const f of features) {
      const k = String(f[key]);
      const c = counts.get(k) ?? { wins: 0, total: 0, pnl: 0 };
      c.total++;
      if (f.win) c.wins++;
      c.pnl += f.netPnlPct;
      counts.set(k, c);
    }
    for (const [k, c] of [...counts.entries()].sort((a, b) => b[1].total - a[1].total)) {
      const wr = (c.wins / c.total) * 100;
      console.log(`  ${k.padEnd(12)} n=${String(c.total).padStart(5)}  WR=${wr.toFixed(1)}%  totalPnl%=${c.pnl.toFixed(2)}`);
    }
  } else {
    const numericBins = bins as number[];
    const buckets: Array<{ lo: number; hi: number; wins: number; total: number; pnl: number }> = [];
    for (let i = 0; i < numericBins.length - 1; i++) {
      buckets.push({ lo: numericBins[i], hi: numericBins[i + 1], wins: 0, total: 0, pnl: 0 });
    }
    for (const f of features) {
      const v = Number(f[key]);
      for (const b of buckets) {
        if (v >= b.lo && v < b.hi) {
          b.total++;
          if (f.win) b.wins++;
          b.pnl += f.netPnlPct;
          break;
        }
      }
    }
    for (const b of buckets) {
      const wr = b.total ? (b.wins / b.total) * 100 : 0;
      console.log(`  [${b.lo.toFixed(2)}, ${b.hi.toFixed(2)})  n=${String(b.total).padStart(5)}  WR=${wr.toFixed(1)}%  totalPnl%=${b.pnl.toFixed(2)}`);
    }
  }
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: analyze-trade-features.ts <trade-file.json> [more...]');
    process.exit(1);
  }
  const allTrades: Trade[] = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const trades: Trade[] = data.trades ?? data;
    allTrades.push(...trades);
    console.log(`[loaded] ${path.basename(f)}: ${trades.length} trades`);
  }
  console.log(`[total] ${allTrades.length} trades\n`);
  const features = allTrades.map(extractFeatures);
  const overallWR = features.filter((f) => f.win).length / features.length * 100;
  console.log(`[baseline] overall win rate = ${overallWR.toFixed(1)}%`);

  // Categorical breakdowns
  bucketize(features, 'symbol', []);
  bucketize(features, 'side', []);
  bucketize(features, 'hasFunding', []);
  bucketize(features, 'fundingAligned', []);
  bucketize(features, 'taIsRsiExtreme', []);
  bucketize(features, 'taIsSmaStack', []);
  bucketize(features, 'exitReason', []);

  // Numeric bucketizations
  bucketize(features, 'consensusStrength', [0.74, 0.80, 0.85, 0.90, 0.95, 1.01]);
  bucketize(features, 'alignedRatio', [0, 0.5, 0.66, 0.80, 1.01]);
  bucketize(features, 'avgConfidence', [0.40, 0.55, 0.65, 0.75, 0.90]);
  bucketize(features, 'avgAlignedConf', [0.40, 0.55, 0.65, 0.75, 0.90]);
  bucketize(features, 'agentCount', [1, 2, 3, 4, 5, 6]);
  bucketize(features, 'alignedAgentCount', [1, 2, 3, 4, 5, 6]);
  bucketize(features, 'contraAgentCount', [0, 1, 2, 3, 4]);
  bucketize(features, 'atrPctOfPrice', [0, 0.10, 0.20, 0.40, 0.60, 1.00, 5.00]);
  bucketize(features, 'hourOfDay', Array.from({ length: 9 }, (_, i) => i * 3));
  bucketize(features, 'dayOfWeek', [0, 1, 2, 3, 4, 5, 6, 7]);
  bucketize(features, 'holdMinutes', [0, 30, 60, 120, 240, 480, 1440, 100000]);
}

main();
