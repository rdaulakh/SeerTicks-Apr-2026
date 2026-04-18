import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // First get column names
  const cols = await db.execute(sql`SHOW COLUMNS FROM tradeDecisionLog`);
  console.log('=== COLUMNS ===');
  for (const c of (cols as any)[0]) {
    console.log(`  ${c.Field} (${c.Type})`);
  }
  
  // Get recent decisions
  const decisions = await db.execute(sql`
    SELECT * FROM tradeDecisionLog 
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY timestamp DESC
    LIMIT 10
  `);
  
  console.log('\n=== RECENT TRADE DECISIONS ===');
  for (const d of (decisions as any)[0]) {
    const keys = Object.keys(d);
    console.log(`  Decision #${d.id}:`);
    for (const k of keys) {
      if (d[k] !== null && d[k] !== undefined) {
        console.log(`    ${k}: ${d[k]}`);
      }
    }
    console.log('');
  }

  process.exit(0);
}

main().catch(console.error);
