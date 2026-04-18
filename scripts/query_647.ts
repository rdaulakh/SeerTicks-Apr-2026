/**
 * Query trade decision logs around 6:47 IST
 */
import { getDb } from '../server/db';
import { tradeDecisionLogs } from '../drizzle/schema';
import { desc, and, gte, lte } from 'drizzle-orm';

async function query() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  // 6:47 IST = 1:17 UTC
  const results = await db
    .select()
    .from(tradeDecisionLogs)
    .where(
      and(
        gte(tradeDecisionLogs.timestamp, new Date('2026-01-30T01:00:00Z')),
        lte(tradeDecisionLogs.timestamp, new Date('2026-01-30T02:00:00Z'))
      )
    )
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(30);

  console.log('\n=== Signals around 6:47 IST (1:00-2:00 UTC) ===\n');
  console.log('Found', results.length, 'signals');
  
  for (const row of results) {
    const istTime = new Date(row.timestamp.getTime() + 5.5 * 60 * 60 * 1000);
    const timeStr = istTime.toISOString().substring(11, 19);
    console.log(`${timeStr} IST | ${row.symbol} | ${row.signalType} | Conf: ${parseFloat(row.totalConfidence.toString()).toFixed(1)}% | ${row.decision} | ${row.status}`);
    if (row.decisionReason) {
      console.log(`  Reason: ${row.decisionReason}`);
    }
  }
  
  process.exit(0);
}

query().catch(err => {
  console.error(err);
  process.exit(1);
});
