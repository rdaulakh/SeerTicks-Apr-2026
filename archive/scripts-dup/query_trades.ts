/**
 * Query trade decision logs to audit the 6:47 buy signal
 */
import { getDb } from '../server/db';
import { tradeDecisionLogs } from '../drizzle/schema';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';

async function queryTrades() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    return;
  }

  // Query BUY signals from today (IST timezone = UTC+5:30)
  const results = await db
    .select({
      id: tradeDecisionLogs.id,
      signalId: tradeDecisionLogs.signalId,
      timestamp: tradeDecisionLogs.timestamp,
      symbol: tradeDecisionLogs.symbol,
      signalType: tradeDecisionLogs.signalType,
      totalConfidence: tradeDecisionLogs.totalConfidence,
      threshold: tradeDecisionLogs.threshold,
      decision: tradeDecisionLogs.decision,
      decisionReason: tradeDecisionLogs.decisionReason,
      status: tradeDecisionLogs.status,
    })
    .from(tradeDecisionLogs)
    .where(
      and(
        eq(tradeDecisionLogs.signalType, 'BUY'),
        gte(tradeDecisionLogs.timestamp, new Date('2026-01-30T00:00:00Z')),
        lte(tradeDecisionLogs.timestamp, new Date('2026-01-30T23:59:59Z'))
      )
    )
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(50);

  console.log('\\n=== BUY Signals on 2026-01-30 ===\\n');
  
  for (const row of results) {
    const istTime = new Date(row.timestamp.getTime() + 5.5 * 60 * 60 * 1000);
    const timeStr = istTime.toISOString().replace('T', ' ').substring(0, 19);
    
    console.log(`${timeStr} IST | ${row.symbol}`);
    console.log(`  Confidence: ${parseFloat(row.totalConfidence.toString()).toFixed(2)}% | Threshold: ${parseFloat(row.threshold.toString()).toFixed(2)}%`);
    console.log(`  Decision: ${row.decision} | Status: ${row.status}`);
    if (row.decisionReason) {
      console.log(`  Reason: ${row.decisionReason}`);
    }
    console.log('');
  }
}

queryTrades().catch(console.error);
