/**
 * scripts/backfill_pnl_attribution.ts — Phase 82
 *
 * Backfills the agentPnlAttribution table from already-closed trades.
 * Without this, the operator would only see attribution for trades that
 * close AFTER the deploy — historical performance would be invisible.
 *
 * Strategy:
 *   1. Pull all closed `trades` rows (where pnl is known and agentSignals
 *      JSON snapshot exists) in the window.
 *   2. For each (trade, agent), compute the signed contribution using the
 *      same formula as live attribution.
 *   3. Insert into agentPnlAttribution — skip if a row already exists for
 *      this (tradeId, agentName) pair (idempotent).
 *
 * Usage:
 *   tsx scripts/backfill_pnl_attribution.ts [--windowDays=30] [--dryRun]
 */

import 'dotenv/config';
import { getDb } from '../server/db';
import { trades, agentPnlAttribution } from '../drizzle/schema';
import { eq, and, gte, desc, isNotNull } from 'drizzle-orm';
import { __agentPnlAttribution_internals__ } from '../server/services/AgentPnlAttributor';

const { normaliseAgentDirection, computeAlignment, wasDirectionallyCorrect } =
  __agentPnlAttribution_internals__;

interface CliArgs {
  windowDays: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { windowDays: 30, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--windowDays=')) args.windowDays = parseInt(arg.split('=')[1], 10);
    else if (arg === '--dryRun') args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  console.log('=== Phase 82 — Attribution backfill ===');
  console.log('Window days:', args.windowDays, '| Dry run:', args.dryRun);

  const db = await getDb();
  if (!db) {
    console.error('DB unavailable');
    process.exit(1);
  }

  const since = new Date(Date.now() - args.windowDays * 24 * 60 * 60 * 1000);

  // Pull closed trades with agentSignals JSON
  const closed = await db
    .select()
    .from(trades)
    .where(and(
      eq(trades.status, 'closed'),
      isNotNull(trades.agentSignals),
      gte(trades.createdAt, since),
    ))
    .orderBy(desc(trades.createdAt))
    .limit(5000);

  console.log(`Found ${closed.length} closed trades in window`);

  // Pre-load existing attribution rows to dedupe
  const existing = await db
    .select({ tradeId: agentPnlAttribution.tradeId, agentName: agentPnlAttribution.agentName })
    .from(agentPnlAttribution);
  const existingKey = new Set(existing.map((e: any) => `${e.tradeId}:${e.agentName}`));
  console.log(`Existing attribution rows: ${existing.length}`);

  let tradesProcessed = 0;
  let rowsInserted = 0;
  let tradesSkipped = 0;

  for (const trade of closed) {
    const pnl = parseFloat(trade.pnlAfterCosts ?? trade.pnl ?? '0');
    if (!Number.isFinite(pnl) || pnl === 0) {
      tradesSkipped++;
      continue;
    }

    const agentSignalsRaw = trade.agentSignals as any;
    if (!agentSignalsRaw || typeof agentSignalsRaw !== 'object') {
      tradesSkipped++;
      continue;
    }

    // agentSignals JSON shape from PostTradeAnalyzer: { [agentName]: { signal, confidence, ... } }
    // OR from DecisionEvaluator: { agentSignals: [{ agentName, signal, confidence }] }
    let votes: Array<{ agentName: string; signal: any; confidence: number }> = [];
    if (Array.isArray(agentSignalsRaw)) {
      votes = agentSignalsRaw.map((v: any) => ({
        agentName: v.agentName ?? v.name ?? 'unknown',
        signal: v.signal ?? v.direction ?? 'neutral',
        confidence: typeof v.confidence === 'number' ? v.confidence : 0,
      }));
    } else {
      votes = Object.entries(agentSignalsRaw).map(([agentName, v]: [string, any]) => ({
        agentName,
        signal: v?.signal ?? v?.direction ?? 'neutral',
        confidence: typeof v?.confidence === 'number' ? v.confidence : 0,
      }));
    }

    if (votes.length === 0) {
      tradesSkipped++;
      continue;
    }

    const closedAt = trade.exitTime ?? trade.updatedAt ?? trade.createdAt;
    const rows = votes
      .filter(v => !existingKey.has(`${trade.id}:${v.agentName}`))
      .map(v => {
        const dir = normaliseAgentDirection(v.signal);
        const align = computeAlignment(dir, trade.side);
        const conf = Number.isFinite(v.confidence) ? Math.abs(v.confidence) : 0;
        const contribution = align * conf * pnl;
        return {
          userId: trade.userId,
          tradeId: trade.id,
          agentName: v.agentName,
          symbol: trade.symbol,
          tradeSide: trade.side,
          agentDirection: dir,
          agentConfidence: conf.toFixed(4),
          pnlContribution: contribution.toFixed(6),
          tradePnl: pnl.toFixed(6),
          wasCorrect: wasDirectionallyCorrect(align, pnl),
          tradeQualityScore: trade.tradeQualityScore?.slice(0, 2) ?? null,
          exitReason: trade.exitReason?.slice(0, 64) ?? null,
          tradingMode: null, // unknown for historical trades
          closedAt,
        };
      });

    if (rows.length === 0) {
      tradesSkipped++;
      continue;
    }

    if (!args.dryRun) {
      try {
        await db.insert(agentPnlAttribution).values(rows);
      } catch (err) {
        console.warn(`  Insert failed for trade ${trade.id}:`, (err as Error).message);
        continue;
      }
    }
    rowsInserted += rows.length;
    tradesProcessed++;

    if (tradesProcessed % 25 === 0) {
      console.log(`  ${tradesProcessed} trades processed, ${rowsInserted} attribution rows ${args.dryRun ? '(would insert)' : 'inserted'}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  Trades processed: ${tradesProcessed}`);
  console.log(`  Trades skipped (no pnl / no agentSignals): ${tradesSkipped}`);
  console.log(`  Attribution rows ${args.dryRun ? 'would insert' : 'inserted'}: ${rowsInserted}`);
  process.exit(0);
}

main().catch(e => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
