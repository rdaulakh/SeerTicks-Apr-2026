import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

console.log("=== DATABASE AUDIT ===\n");

// Check table structure
console.log("1. Checking historicalCandles table structure...");
const columns = await db.execute(sql`SHOW COLUMNS FROM historicalCandles`);
console.log("Columns:", JSON.stringify(columns, null, 2));

// Check total count
console.log("\n2. Checking total candle count...");
const totalResult = await db.execute(sql`SELECT COUNT(*) as total FROM historicalCandles`);
console.log("Total candles:", totalResult[0]?.total || 0);

// Check if table is empty
if (totalResult[0]?.total === 0) {
  console.log("\n⚠️ WARNING: historicalCandles table is EMPTY!");
  console.log("The migration document claims 247,906 candles, but the database has 0.");
  process.exit(0);
}

// Get sample data
console.log("\n3. Getting sample data...");
const sample = await db.execute(sql`SELECT * FROM historicalCandles LIMIT 5`);
console.log("Sample data:", JSON.stringify(sample, null, 2));

console.log("\n=== AUDIT COMPLETE ===");
