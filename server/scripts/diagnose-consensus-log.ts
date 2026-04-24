/**
 * Phase 16 diagnostic — answers "is ConsensusRecorder actually writing?"
 *
 * Discovered during Phase 16 rollout that consensusHistory had 0 rows
 * in the last 14 days even though SIGNAL_REJECTED logs are firing every
 * few seconds. This script reports the table's row count, earliest row,
 * and latest row so we know whether the cleanup is truncating or the
 * writer is broken.
 */

import 'dotenv/config';
import { getDb } from '../db';
import { consensusHistory } from '../../drizzle/schema';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('[diagnose] no db');
    process.exit(1);
  }
  const r = await db
    .select({
      total: sql<number>`count(*)`,
      earliest: sql<Date | null>`min(timestamp)`,
      latest: sql<Date | null>`max(timestamp)`,
    })
    .from(consensusHistory);
  console.log('consensusHistory stats:');
  console.log(`  total:    ${r[0].total}`);
  console.log(`  earliest: ${r[0].earliest}`);
  console.log(`  latest:   ${r[0].latest}`);
  if (r[0].total > 0) {
    const last = await db
      .select()
      .from(consensusHistory)
      .orderBy(sql`timestamp desc`)
      .limit(3);
    console.log('last 3 rows:');
    for (const row of last) {
      const votesLen =
        typeof row.agentVotes === 'string' ? row.agentVotes.length : 0;
      console.log(
        `  ${row.timestamp.toISOString()} | ${row.symbol} | ${row.finalSignal} | agentVotes.length=${votesLen}`,
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
