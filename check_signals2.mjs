import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get recent signals with correct column names
  const [rows] = await conn.execute(`
    SELECT id, userId, agentName, signalType, confidence, executionScore, 
           LEFT(signalData, 200) as signalPreview, timestamp
    FROM agentSignals 
    WHERE agentName IN ('TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst')
    ORDER BY id DESC 
    LIMIT 15
  `);
  
  console.log('Recent fast agent signals:');
  for (const row of rows) {
    console.log(`${row.agentName}: confidence=${row.confidence}, executionScore=${row.executionScore}, type=${row.signalType}`);
    console.log(`  Data: ${row.signalPreview}`);
    console.log('');
  }
  
  await conn.end();
}

check().catch(console.error);
