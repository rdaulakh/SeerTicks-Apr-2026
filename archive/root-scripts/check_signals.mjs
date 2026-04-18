import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get column names
  const [cols] = await conn.execute('SHOW COLUMNS FROM agentSignals');
  console.log('Columns:', cols.map(c => c.Field).join(', '));
  
  // Get recent signals
  const [rows] = await conn.execute(`
    SELECT * FROM agentSignals 
    WHERE agent_name IN ('TechnicalAnalyst', 'PatternMatcher', 'OrderFlowAnalyst')
    ORDER BY id DESC 
    LIMIT 10
  `);
  
  console.log('\nRecent fast agent signals:');
  for (const row of rows) {
    console.log(`${row.agent_name}: confidence=${row.confidence}, reasoning=${row.reasoning?.substring(0, 100)}`);
  }
  
  await conn.end();
}

check().catch(console.error);
