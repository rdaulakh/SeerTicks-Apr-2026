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

  // Query recent logs with correct columns
  const [logs] = await conn.execute(`
    SELECT id, symbol, decision, status, decisionReason, fastScore, slowBonus, totalConfidence, threshold, signalType, signalStrength, createdAt 
    FROM tradeDecisionLogs 
    WHERE userId = 272657 
    ORDER BY createdAt DESC 
    LIMIT 30
  `);
  
  console.log('\n=== Recent Trade Decision Logs (Last 30) ===\n');
  
  for (const log of logs as any[]) {
    const date = new Date(log.createdAt);
    const timeStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    
    const emoji = log.decision === 'EXECUTED' ? '✅' : log.decision === 'SKIPPED' ? '⏭️' : '❌';
    
    console.log(`${emoji} [${timeStr}] ${log.symbol}`);
    console.log(`   Decision: ${log.decision} | Status: ${log.status}`);
    console.log(`   Signal: ${log.signalType} (Strength: ${(log.signalStrength * 100).toFixed(1)}%)`);
    console.log(`   Fast Score: ${(log.fastScore * 100).toFixed(1)}% | Slow Bonus: ${(log.slowBonus * 100).toFixed(1)}%`);
    console.log(`   Total Confidence: ${(log.totalConfidence * 100).toFixed(1)}% | Threshold: ${(log.threshold * 100).toFixed(1)}%`);
    console.log(`   Reason: ${log.decisionReason}`);
    console.log('');
  }

  // Summary stats
  const executed = (logs as any[]).filter(l => l.decision === 'EXECUTED').length;
  const skipped = (logs as any[]).filter(l => l.decision === 'SKIPPED').length;
  
  console.log('=== Summary ===');
  console.log(`Total: ${(logs as any[]).length} | Executed: ${executed} | Skipped: ${skipped}`);

  await conn.end();
}

main().catch(console.error);
