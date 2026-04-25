/**
 * Phase 17 verification — same backtest math as `consensus-backtest.ts`
 * but accepts an absolute UTC ISO timestamp instead of `--days=N`.
 *
 * Needed when verifying a deploy: `--days=1` includes 23+ hours of
 * pre-fix rows that drown out the fresh data. With `--since=...` we
 * query only rows recorded AFTER the deploy timestamp so the comparison
 * is fair.
 */

import 'dotenv/config';
import { getDb } from '../db';
import { consensusHistory } from '../../drizzle/schema';
import { gte } from 'drizzle-orm';
import { parseRow, evaluateThreshold } from './consensus-backtest';

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  if (!sinceArg) {
    console.error('Usage: tsx consensus-backtest-since.ts --since=2026-04-25T01:35:00Z');
    process.exit(1);
  }
  const since = new Date(sinceArg.split('=')[1]);
  if (Number.isNaN(since.getTime())) {
    console.error(`Bad --since value: "${sinceArg.split('=')[1]}"`);
    process.exit(1);
  }
  const thresholds = [0.5, 0.55, 0.6, 0.65, 0.7];

  const db = await getDb();
  if (!db) {
    console.error('no db');
    process.exit(1);
  }
  const raw = await db
    .select()
    .from(consensusHistory)
    .where(gte(consensusHistory.timestamp, since));

  const rows = raw.map(parseRow).filter((r) => r !== null) as ReturnType<typeof parseRow>[];
  const parsed = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(
    `[backtest-since] since=${since.toISOString()}  rows=${raw.length} parseable=${parsed.length}`,
  );
  if (parsed.length === 0) {
    console.log('No rows yet — check again later or verify recordConsensus is firing.');
    process.exit(0);
  }

  const results = thresholds.map((t) => evaluateThreshold(parsed, t));
  console.log('\n== THRESHOLD SWEEP (post-deploy data only) ==');
  console.log('threshold |  approved |  rejected | approval% | median elig/row');
  for (const r of results) {
    console.log(
      `   ${r.threshold.toFixed(2)}   | ${String(r.approvedRows).padStart(9)} | ${String(r.rejectedRows).padStart(9)} | ${(r.approvalRate * 100).toFixed(2).padStart(8)}% | ${r.medianEligibleCount}`,
    );
  }

  console.log('\n== AGENT FILTER PASS RATE (post-deploy) ==');
  const allAgents = new Set<string>();
  for (const r of results) for (const k of r.byAgent.keys()) allAgents.add(k);
  const sorted = Array.from(allAgents).sort();
  const header = ['agent'.padEnd(28), ...thresholds.map((t) => `@${t.toFixed(2)}`)];
  console.log(header.join(' | '));
  for (const a of sorted) {
    const row = [a.padEnd(28)];
    for (const r of results) {
      const b = r.byAgent.get(a);
      row.push(
        b && b.totalSeen > 0
          ? `${((b.passedFilter / b.totalSeen) * 100).toFixed(1)}%`.padStart(6)
          : '  n/a',
      );
    }
    console.log(row.join(' | '));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
