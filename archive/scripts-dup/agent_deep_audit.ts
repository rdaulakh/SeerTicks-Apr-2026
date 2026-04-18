import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  console.log("=== DEEP AGENT-BY-AGENT AUDIT ===\n");
  
  // 1. Get all agent-related tables
  const [tables] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_NAME LIKE '%agent%' AND TABLE_SCHEMA = DATABASE()"
  );
  console.log("Agent Tables:", JSON.stringify(tables, null, 2));
  
  // 2. Check agentSignals table structure
  try {
    const [columns] = await connection.execute("DESCRIBE agentSignals");
    console.log("\nagentSignals columns:", JSON.stringify(columns, null, 2));
  } catch (e) {
    console.log("\nagentSignals table not found, checking alternatives...");
  }
  
  // 3. Check for signal history tables
  const [allTables] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  console.log("\nAll tables:", JSON.stringify(allTables, null, 2));
  
  // 4. Get signal counts by agent if table exists
  try {
    const [counts] = await connection.execute(
      "SELECT agentName, COUNT(*) as count FROM agentSignals GROUP BY agentName ORDER BY count DESC"
    );
    console.log("\nSignals by agent:", JSON.stringify(counts, null, 2));
  } catch (e) {
    console.log("\nCould not get signal counts:", (e as Error).message);
  }
  
  // 5. Get sample signals with all fields
  try {
    const [sample] = await connection.execute(
      "SELECT * FROM agentSignals ORDER BY createdAt DESC LIMIT 3"
    );
    console.log("\nSample signals:", JSON.stringify(sample, null, 2));
  } catch (e) {
    console.log("\nCould not get sample signals:", (e as Error).message);
  }
  
  // 6. Get positions with entry consensus data
  const [positions] = await connection.execute(`
    SELECT 
      id, symbol, side, entryPrice, exitPrice, realizedPnl, status,
      entryTime, exitTime, exitReason,
      TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSeconds
    FROM paperPositions 
    WHERE status = 'closed' 
    ORDER BY entryTime DESC 
    LIMIT 20
  `);
  console.log("\nRecent closed positions:", JSON.stringify(positions, null, 2));
  
  await connection.end();
}

main().catch(console.error);
