import { getDb } from '../server/db';
import { tradeDecisionLogs } from '../drizzle/schema';
import { desc, ne, sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.log('Database not available');
    return;
  }

  // Get non-SKIPPED decisions
  const decisions = await db.select()
    .from(tradeDecisionLogs)
    .where(ne(tradeDecisionLogs.decision, 'SKIPPED'))
    .orderBy(desc(tradeDecisionLogs.id))
    .limit(10);

  console.log('\n=== Trade Decisions (non-SKIPPED) ===');
  for (const row of decisions) {
    console.log(`\nID: ${row.id}`);
    console.log(`Symbol: ${row.symbol}`);
    console.log(`Decision: ${row.decision}`);
    console.log(`Reason: ${row.reason}`);
  }

  // Count EXECUTED
  const [executed] = await db.select({ count: sql<number>`count(*)` })
    .from(tradeDecisionLogs)
    .where(sql`decision = 'EXECUTED'`);
  console.log(`\nTotal EXECUTED: ${executed.count}`);

  process.exit(0);
}

main().catch(console.error);
