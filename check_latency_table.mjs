import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== EXECUTION LATENCY LOGS STATUS ===\n");

// Check if table exists
try {
  const [columns] = await connection.query(`DESCRIBE executionLatencyLogs`);
  console.log("Table columns:");
  columns.forEach(c => console.log(`  ${c.Field}: ${c.Type} ${c.Null === 'YES' ? '(nullable)' : ''}`));
  
  // Check record count
  const [[{count}]] = await connection.query(`SELECT COUNT(*) as count FROM executionLatencyLogs`);
  console.log(`\nTotal records: ${count}`);
  
  // Check recent records
  const [recent] = await connection.query(`
    SELECT * FROM executionLatencyLogs ORDER BY createdAt DESC LIMIT 3
  `);
  console.log("\nRecent records:");
  if (recent.length === 0) {
    console.log("  (no records)");
  } else {
    recent.forEach(r => {
      console.log(`  ID: ${r.id}, User: ${r.userId}, Symbol: ${r.symbol}`);
      console.log(`    Signal->Consensus: ${r.signalToConsensusMs}ms`);
      console.log(`    Total: ${r.totalLatencyMs}ms`);
    });
  }
} catch (err) {
  console.log("Table does not exist or error:", err.message);
}

await connection.end();
