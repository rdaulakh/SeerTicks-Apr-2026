import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [logs] = await conn.execute(`
  SELECT id, symbol, signalType, totalConfidence, threshold
  FROM tradeDecisionLogs
  WHERE userId = 272657
  ORDER BY id DESC
  LIMIT 3
`);

console.log('=== RAW DATABASE VALUES ===\n');
for (const log of logs) {
  console.log(`ID ${log.id}: ${log.symbol}`);
  console.log(`  totalConfidence (raw): ${log.totalConfidence}`);
  console.log(`  threshold (raw): ${log.threshold}`);
  console.log('');
}

await conn.end();
