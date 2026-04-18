import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

console.log("=== DATABASE AUDIT ===\n");

// Check total count
console.log("1. Checking total candle count...");
const totalResult = await db.execute(sql`SELECT COUNT(*) as total FROM historicalCandles`);
const total = totalResult[0]?.[0]?.total || 0;
console.log(`Total candles: ${total}`);

if (total === 0) {
  console.log("\n⚠️ CRITICAL FINDING: historicalCandles table is EMPTY!");
  console.log("Migration document claims 247,906 candles, but database has 0.");
  process.exit(0);
}

// Get breakdown by symbol and interval
console.log("\n2. Breakdown by symbol and interval:");
const breakdown = await db.execute(sql`
  SELECT symbol, \`interval\`, COUNT(*) as count, 
         MIN(timestamp) as earliest, MAX(timestamp) as latest
  FROM historicalCandles 
  GROUP BY symbol, \`interval\` 
  ORDER BY symbol, \`interval\`
`);

for (const row of breakdown[0]) {
  console.log(`  ${row.symbol} ${row.interval}: ${row.count} candles (${row.earliest} to ${row.latest})`);
}

// Get source breakdown
console.log("\n3. Breakdown by source:");
const sources = await db.execute(sql`
  SELECT source, COUNT(*) as count
  FROM historicalCandles 
  GROUP BY source
`);

for (const row of sources[0]) {
  console.log(`  ${row.source}: ${row.count} candles`);
}

console.log("\n=== AUDIT COMPLETE ===");
