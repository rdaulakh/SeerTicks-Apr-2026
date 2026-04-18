/**
 * Comprehensive trade audit script
 */
import { getDb } from '../server/db';
import { tradeDecisionLogs, positions } from '../drizzle/schema';
import { desc, and, gte, lte, eq, sql } from 'drizzle-orm';

async function audit() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  // Check signals from Jan 29 and Jan 30
  console.log('\n=== TRADE DECISION LOG AUDIT ===\n');
  
  // Get date range of all signals
  const dateRange = await db
    .select({
      minDate: sql<Date>`MIN(timestamp)`,
      maxDate: sql<Date>`MAX(timestamp)`,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(tradeDecisionLogs);
  
  console.log('Date Range:', dateRange[0]);
  
  // Get signals from Jan 29 around 6:47 IST (1:17 UTC)
  console.log('\n--- Jan 29, 2026 Signals (6:00-7:30 IST / 0:30-2:00 UTC) ---');
  const jan29Signals = await db
    .select()
    .from(tradeDecisionLogs)
    .where(
      and(
        gte(tradeDecisionLogs.timestamp, new Date('2026-01-29T00:30:00Z')),
        lte(tradeDecisionLogs.timestamp, new Date('2026-01-29T02:00:00Z'))
      )
    )
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(20);
  
  console.log('Found', jan29Signals.length, 'signals');
  for (const row of jan29Signals) {
    const istTime = new Date(row.timestamp.getTime() + 5.5 * 60 * 60 * 1000);
    console.log(`${istTime.toISOString().substring(0, 19)} IST | ${row.symbol} | ${row.signalType} | ${row.decision}`);
  }
  
  // Get all BUY signals with EXECUTED decision
  console.log('\n--- All EXECUTED BUY Signals (Last 48 hours) ---');
  const executedSignals = await db
    .select()
    .from(tradeDecisionLogs)
    .where(
      and(
        eq(tradeDecisionLogs.signalType, 'BUY'),
        eq(tradeDecisionLogs.decision, 'EXECUTED'),
        gte(tradeDecisionLogs.timestamp, new Date(Date.now() - 48 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(30);
  
  console.log('Found', executedSignals.length, 'executed BUY signals');
  for (const row of executedSignals) {
    const istTime = new Date(row.timestamp.getTime() + 5.5 * 60 * 60 * 1000);
    console.log(`${istTime.toISOString().substring(0, 19)} IST | ${row.symbol} | Conf: ${parseFloat(row.totalConfidence.toString()).toFixed(1)}% | Status: ${row.status}`);
  }
  
  // Check positions table
  console.log('\n=== POSITIONS AUDIT ===\n');
  const allPositions = await db
    .select()
    .from(positions)
    .orderBy(desc(positions.createdAt))
    .limit(20);
  
  console.log('Found', allPositions.length, 'positions');
  for (const pos of allPositions) {
    const istTime = new Date(pos.createdAt.getTime() + 5.5 * 60 * 60 * 1000);
    console.log(`${istTime.toISOString().substring(0, 19)} IST | ${pos.symbol} | ${pos.side} | Status: ${pos.status} | Entry: ${pos.entryPrice}`);
  }
  
  // Check for SKIPPED signals with reasons
  console.log('\n--- SKIPPED Signals (Last 24 hours) ---');
  const skippedSignals = await db
    .select()
    .from(tradeDecisionLogs)
    .where(
      and(
        eq(tradeDecisionLogs.decision, 'SKIPPED'),
        gte(tradeDecisionLogs.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(20);
  
  console.log('Found', skippedSignals.length, 'skipped signals');
  const reasonCounts: Record<string, number> = {};
  for (const row of skippedSignals) {
    const reason = row.decisionReason || 'Unknown';
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  console.log('Skip reasons:', reasonCounts);
  
  process.exit(0);
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
