import mysql from 'mysql2/promise';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const sslParam = url.searchParams.get('ssl');
  let ssl: any = false;
  if (sslParam) {
    try { ssl = JSON.parse(sslParam); } catch { ssl = { rejectUnauthorized: true }; }
  }

  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl
  });

  // Get column names
  const [columns] = await conn.execute(`SHOW COLUMNS FROM tradeDecisionLogs`);
  console.log('\n=== Table Columns ===');
  const colNames = (columns as any[]).map(c => c.Field);
  console.log(colNames.join(', '));

  // Query recent logs
  const [logs] = await conn.execute(`
    SELECT id, userId, symbol, decision, status, reasoning, createdAt 
    FROM tradeDecisionLogs 
    WHERE userId = 272657 
    ORDER BY createdAt DESC 
    LIMIT 30
  `);
  
  console.log('\n=== Recent Trade Decision Logs ===');
  for (const log of logs as any[]) {
    console.log(`\n--- ${log.createdAt} ---`);
    console.log(`Symbol: ${log.symbol}`);
    console.log(`Decision: ${log.decision}`);
    console.log(`Status: ${log.status}`);
    console.log(`Reasoning: ${log.reasoning?.substring(0, 200)}...`);
  }

  await conn.end();
}

main().catch(console.error);
