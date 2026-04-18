import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

console.log("=== CHECKING SOURCE TABLE ===\n");

try {
  console.log("1. Checking if historicalPriceData table exists...");
  const tables = await db.execute(sql`SHOW TABLES LIKE 'historicalPriceData'`);
  
  if (tables[0].length === 0) {
    console.log("❌ historicalPriceData table does NOT exist");
  } else {
    console.log("✅ historicalPriceData table exists");
    
    // Check count
    const count = await db.execute(sql`SELECT COUNT(*) as total FROM historicalPriceData`);
    const total = count[0]?.[0]?.total || 0;
    console.log(`   Total records: ${total}`);
    
    if (total > 0) {
      // Get sample
      const sample = await db.execute(sql`SELECT * FROM historicalPriceData LIMIT 3`);
      console.log("\n   Sample data:");
      for (const row of sample[0]) {
        console.log(`   - ${JSON.stringify(row)}`);
      }
    }
  }
} catch (error) {
  console.log("❌ Error checking historicalPriceData:", error.message);
}

console.log("\n2. Checking all tables in database...");
const allTables = await db.execute(sql`SHOW TABLES`);
console.log("Available tables:");
for (const table of allTables[0]) {
  const tableName = Object.values(table)[0];
  console.log(`  - ${tableName}`);
}

console.log("\n=== CHECK COMPLETE ===");
