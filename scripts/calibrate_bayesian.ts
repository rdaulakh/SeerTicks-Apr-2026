/**
 * scripts/calibrate_bayesian.ts — Phase 80
 *
 * Analyzes bayesianConsensusLog data over a window, scores how the gate's
 * approve/reject decisions correlated with downstream trade outcomes, and
 * suggests tuned thresholds.
 *
 * Designed to be scheduled (e.g. weekly cron) so the gate auto-adapts to
 * the observed signal density / market regime as the platform matures.
 *
 * Usage:
 *   npx tsx scripts/calibrate_bayesian.ts                # last 7 days
 *   npx tsx scripts/calibrate_bayesian.ts --days 30
 *   npx tsx scripts/calibrate_bayesian.ts --apply        # write suggested
 *                                                        # thresholds to .env
 *
 * Output:
 *   calibration-report-<ts>.json with:
 *     - distribution of posteriorStd, posteriorMean, effectiveN
 *     - approve/reject ratio, by gate reason
 *     - signal volume per symbol per hour
 *     - suggested thresholds based on actual data quantiles
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import { bayesianConsensusLog, paperPositions } from '../drizzle/schema';
import { and, gte, asc, sql, eq } from 'drizzle-orm';
import { promises as fs } from 'fs';

interface Args {
  days: number;
  apply: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let days = 7;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') days = parseInt(argv[++i], 10);
    if (argv[i] === '--apply') apply = true;
  }
  return { days, apply };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

interface Report {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totalSignals: number;
  gateDistribution: Record<string, number>;
  approveRate: number;
  perSymbol: Array<{
    symbol: string;
    totalSignals: number;
    approveRate: number;
    avgNaive: number;
    avgPosteriorMean: number;
    avgPosteriorStd: number;
    avgEffectiveN: number;
    avgRawN: number;
  }>;
  posteriorStdQuantiles: { p25: number; p50: number; p75: number; p95: number };
  posteriorMeanQuantiles: { p25: number; p50: number; p75: number; p95: number };
  effectiveNQuantiles: { p25: number; p50: number; p75: number; p95: number };
  currentThresholds: {
    maxUncertainty: number;
    minDistanceFromHalf: number;
    minEffectiveN: number;
  };
  suggestedThresholds: {
    maxUncertainty: number;
    minDistanceFromHalf: number;
    minEffectiveN: number;
    rationale: string[];
  };
  approvedSignalOutcomes?: {
    approved: number;
    matchedWithTrades: number;
    avgPnl: number;
    winRate: number;
  };
}

async function main() {
  const args = parseArgs();
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - args.days * 24 * 60 * 60 * 1000);

  console.log(`Phase 80 — Bayesian gate calibration`);
  console.log(`Window: ${windowStart.toISOString()} → ${windowEnd.toISOString()} (${args.days}d)`);

  // Pull all entries
  const rows = await db
    .select()
    .from(bayesianConsensusLog)
    .where(gte(bayesianConsensusLog.timestamp, windowStart))
    .orderBy(asc(bayesianConsensusLog.timestamp));

  console.log(`Total Bayesian signals: ${rows.length}`);
  if (rows.length === 0) {
    console.log('No data — nothing to calibrate.');
    process.exit(0);
  }

  // Distribution by gate decision
  const gateDistribution: Record<string, number> = {};
  for (const r of rows) {
    const d = r.gateDecision;
    gateDistribution[d] = (gateDistribution[d] ?? 0) + 1;
  }
  const approveRate = (gateDistribution['approved'] ?? 0) / rows.length;

  // Per-symbol breakdown
  const perSymbolMap = new Map<string, any[]>();
  for (const r of rows) {
    if (!perSymbolMap.has(r.symbol)) perSymbolMap.set(r.symbol, []);
    perSymbolMap.get(r.symbol)!.push(r);
  }
  const perSymbol: Report['perSymbol'] = [];
  for (const [symbol, symRows] of perSymbolMap) {
    const approved = symRows.filter(r => r.gateDecision === 'approved').length;
    const naive = symRows.map((r: any) => parseFloat(r.naiveMean));
    const post = symRows.map((r: any) => parseFloat(r.posteriorMean));
    const std = symRows.map((r: any) => parseFloat(r.posteriorStd));
    const effN = symRows.map((r: any) => parseFloat(r.effectiveN));
    const rawN = symRows.map((r: any) => r.rawN);
    perSymbol.push({
      symbol,
      totalSignals: symRows.length,
      approveRate: approved / symRows.length,
      avgNaive: avg(naive),
      avgPosteriorMean: avg(post),
      avgPosteriorStd: avg(std),
      avgEffectiveN: avg(effN),
      avgRawN: avg(rawN),
    });
  }
  perSymbol.sort((a, b) => b.totalSignals - a.totalSignals);

  // Quantiles
  const allStd = rows.map((r: any) => parseFloat(r.posteriorStd));
  const allMean = rows.map((r: any) => parseFloat(r.posteriorMean));
  const allEffN = rows.map((r: any) => parseFloat(r.effectiveN));

  const stdQ = {
    p25: percentile(allStd, 0.25),
    p50: percentile(allStd, 0.50),
    p75: percentile(allStd, 0.75),
    p95: percentile(allStd, 0.95),
  };
  const meanQ = {
    p25: percentile(allMean, 0.25),
    p50: percentile(allMean, 0.50),
    p75: percentile(allMean, 0.75),
    p95: percentile(allMean, 0.95),
  };
  const effNQ = {
    p25: percentile(allEffN, 0.25),
    p50: percentile(allEffN, 0.50),
    p75: percentile(allEffN, 0.75),
    p95: percentile(allEffN, 0.95),
  };

  // Current thresholds (from env or defaults)
  const currentThresholds = {
    maxUncertainty: parseFloat(process.env.BAYESIAN_MAX_UNCERTAINTY ?? '0.30'),
    minDistanceFromHalf: parseFloat(process.env.BAYESIAN_MIN_DISTANCE ?? '0.05'),
    minEffectiveN: parseFloat(process.env.BAYESIAN_MIN_EFF_N ?? '1.5'),
  };

  // Suggest tuned thresholds based on quantiles + target approve rate.
  // Goal: 15-25% approve rate (selective but actionable). Anchoring rules:
  //   - maxUncertainty just above p75 (admits the "less noisy 75%" of signals)
  //   - minDistanceFromHalf at p75 distance from 0.5 (signals with real bias)
  //   - minEffectiveN at p25 (admits typical voter density)
  const rationale: string[] = [];
  const targetApproveRate = 0.20;
  const distancesFromHalf = allMean.map(m => Math.abs(m - 0.5));
  const distP75 = percentile(distancesFromHalf, 0.75);
  const distP60 = percentile(distancesFromHalf, 0.60);

  const suggestedThresholds = {
    maxUncertainty: Math.min(0.40, Math.max(0.25, stdQ.p75 + 0.01)),
    minDistanceFromHalf: Math.max(0.03, Math.min(0.10, distP60)),
    minEffectiveN: Math.max(1.5, effNQ.p25 * 0.9),
  };

  rationale.push(`P75 posterior std observed = ${stdQ.p75.toFixed(3)} → maxUncertainty just above`);
  rationale.push(`P60 distance from 0.5 = ${distP60.toFixed(3)} → minDistanceFromHalf`);
  rationale.push(`P25 effectiveN = ${effNQ.p25.toFixed(2)} → minEffectiveN at ~90%`);
  if (approveRate < 0.05) {
    rationale.push(`Current approve rate ${(approveRate * 100).toFixed(1)}% < 5% — relaxing minDistance`);
    suggestedThresholds.minDistanceFromHalf = Math.max(0.03, suggestedThresholds.minDistanceFromHalf * 0.7);
  } else if (approveRate > 0.40) {
    rationale.push(`Current approve rate ${(approveRate * 100).toFixed(1)}% > 40% — tightening minDistance`);
    suggestedThresholds.minDistanceFromHalf = Math.min(0.15, suggestedThresholds.minDistanceFromHalf * 1.3);
  }

  // Outcome correlation — were approved signals followed by profitable trades?
  let outcomeStats: Report['approvedSignalOutcomes'] | undefined;
  try {
    const approvedRows = rows.filter((r: any) => r.gateDecision === 'approved');
    if (approvedRows.length > 0) {
      // For each approved signal, find a paperPositions row opened within 60s
      let matched = 0;
      const pnls: number[] = [];
      let wins = 0;
      for (const sig of approvedRows) {
        const sigTime = new Date((sig as any).timestamp).getTime();
        const positionsForSym = await db
          .select()
          .from(paperPositions)
          .where(and(
            eq(paperPositions.symbol, (sig as any).symbol),
            gte(paperPositions.entryTime, new Date(sigTime - 60_000)),
          ))
          .limit(1);
        if (positionsForSym.length > 0) {
          matched++;
          const p = positionsForSym[0] as any;
          if (p.status === 'closed' && p.realizedPnl) {
            const pnl = parseFloat(p.realizedPnl);
            pnls.push(pnl);
            if (pnl > 0) wins++;
          }
        }
      }
      outcomeStats = {
        approved: approvedRows.length,
        matchedWithTrades: matched,
        avgPnl: pnls.length > 0 ? avg(pnls) : 0,
        winRate: pnls.length > 0 ? wins / pnls.length : 0,
      };
    }
  } catch (e) {
    console.warn('Outcome correlation skipped:', (e as Error).message);
  }

  const report: Report = {
    windowDays: args.days,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalSignals: rows.length,
    gateDistribution,
    approveRate,
    perSymbol,
    posteriorStdQuantiles: stdQ,
    posteriorMeanQuantiles: meanQ,
    effectiveNQuantiles: effNQ,
    currentThresholds,
    suggestedThresholds: { ...suggestedThresholds, rationale },
    approvedSignalOutcomes: outcomeStats,
  };

  console.log('\n=== Report ===');
  console.log(`Total: ${report.totalSignals} signals over ${args.days}d`);
  console.log(`Approve rate: ${(approveRate * 100).toFixed(1)}% (target 15-25%)`);
  console.log('Distribution:');
  for (const [k, v] of Object.entries(gateDistribution)) {
    console.log(`  ${k}: ${v} (${(v / rows.length * 100).toFixed(1)}%)`);
  }
  console.log('\nQuantiles:');
  console.log(`  posteriorStd     p25=${stdQ.p25.toFixed(3)} p50=${stdQ.p50.toFixed(3)} p75=${stdQ.p75.toFixed(3)} p95=${stdQ.p95.toFixed(3)}`);
  console.log(`  posteriorMean    p25=${meanQ.p25.toFixed(3)} p50=${meanQ.p50.toFixed(3)} p75=${meanQ.p75.toFixed(3)} p95=${meanQ.p95.toFixed(3)}`);
  console.log(`  effectiveN       p25=${effNQ.p25.toFixed(2)} p50=${effNQ.p50.toFixed(2)} p75=${effNQ.p75.toFixed(2)} p95=${effNQ.p95.toFixed(2)}`);

  console.log('\nCurrent thresholds:');
  console.log(`  maxUncertainty     = ${currentThresholds.maxUncertainty}`);
  console.log(`  minDistanceFromHalf = ${currentThresholds.minDistanceFromHalf}`);
  console.log(`  minEffectiveN      = ${currentThresholds.minEffectiveN}`);

  console.log('\nSuggested thresholds:');
  console.log(`  maxUncertainty     = ${suggestedThresholds.maxUncertainty.toFixed(3)}`);
  console.log(`  minDistanceFromHalf = ${suggestedThresholds.minDistanceFromHalf.toFixed(3)}`);
  console.log(`  minEffectiveN      = ${suggestedThresholds.minEffectiveN.toFixed(2)}`);
  console.log('Rationale:');
  for (const r of rationale) console.log(`  • ${r}`);

  if (outcomeStats) {
    console.log('\nApproved signal outcomes:');
    console.log(`  Approved: ${outcomeStats.approved}, Matched with trades: ${outcomeStats.matchedWithTrades}`);
    if (outcomeStats.winRate > 0) {
      console.log(`  Win rate: ${(outcomeStats.winRate * 100).toFixed(1)}%, Avg PnL: $${outcomeStats.avgPnl.toFixed(2)}`);
    }
  }

  // Save report
  const reportPath = `calibration-report-${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}`);

  if (args.apply) {
    // Append-or-replace BAYESIAN_* entries in .env
    const envPath = '.env';
    let envContent = '';
    try { envContent = await fs.readFile(envPath, 'utf8'); } catch {}
    const newEntries = [
      `BAYESIAN_MAX_UNCERTAINTY=${suggestedThresholds.maxUncertainty.toFixed(3)}`,
      `BAYESIAN_MIN_DISTANCE=${suggestedThresholds.minDistanceFromHalf.toFixed(3)}`,
      `BAYESIAN_MIN_EFF_N=${suggestedThresholds.minEffectiveN.toFixed(2)}`,
    ];
    let updated = envContent;
    for (const entry of newEntries) {
      const [key] = entry.split('=');
      const re = new RegExp(`^${key}=.*$`, 'm');
      if (re.test(updated)) {
        updated = updated.replace(re, entry);
      } else {
        updated += `\n${entry}`;
      }
    }
    await fs.writeFile(envPath, updated.trim() + '\n');
    console.log(`\n✓ Applied suggested thresholds to .env. Restart pm2 to pick up.`);
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write suggestions to .env.`);
  }

  process.exit(0);
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

main().catch(e => {
  console.error('Calibration failed:', e);
  process.exit(1);
});
