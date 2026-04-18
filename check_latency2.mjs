import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log("=== EXECUTION LATENCY LOGS STATUS ===\n");
  
  // Check if table exists
  const [tables] = await connection.query(`SHOW TABLES LIKE 'executionLatencyLogs'`);
  console.log("Table exists:", tables.length > 0);
  
  if (tables.length > 0) {
    const [[{count}]] = await connection.query(`SELECT COUNT(*) as count FROM executionLatencyLogs`);
    console.log("Total records:", count);
  } else {
    console.log("Table does not exist - need to create it");
  }
  
  await connection.end();
}

main().catch(console.error);
