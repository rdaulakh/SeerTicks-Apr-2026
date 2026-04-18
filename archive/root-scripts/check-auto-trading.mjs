import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function checkAutoTrading() {
  console.log('Checking auto trading configuration...\n');
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  
  // Check user and engine state
  const [users] = await connection.query('SELECT id, email, role FROM users WHERE email = ?', ['rdaulakh@exoways.com']);
  const userId = users[0]?.id;
  console.log('User:', users[0]);
  
  // Check engine state
  const [engineState] = await connection.query('SELECT * FROM engineState WHERE userId = ?', [userId]);
  console.log('\nEngine State:', engineState[0]);
  if (engineState[0]?.config) {
    const config = typeof engineState[0].config === 'string' ? JSON.parse(engineState[0].config) : engineState[0].config;
    console.log('Engine Config:', config);
    console.log('\n>>> enableAutoTrading:', config?.enableAutoTrading);
  }
  
  // Check trading mode config
  const [tradingMode] = await connection.query('SELECT * FROM tradingModeConfig WHERE userId = ?', [userId]);
  console.log('\nTrading Mode Config:', tradingMode[0]);
  
  // Check recent signals
  const [signals] = await connection.query(`
    SELECT id, symbol, action, confidence, timestamp, consensusScore 
    FROM signals 
    WHERE userId = ? 
    ORDER BY timestamp DESC 
    LIMIT 5
  `, [userId]);
  console.log('\nRecent Signals:');
  signals.forEach(s => console.log(`  ${s.symbol}: ${s.action} (confidence: ${s.confidence}, consensus: ${s.consensusScore})`));
  
  // Check recent positions
  const [positions] = await connection.query(`
    SELECT id, symbol, side, status, entryPrice, quantity, createdAt 
    FROM positions 
    WHERE userId = ? 
    ORDER BY createdAt DESC 
    LIMIT 5
  `, [userId]);
  console.log('\nRecent Positions:');
  positions.forEach(p => console.log(`  ${p.symbol}: ${p.side} ${p.status} - qty: ${p.quantity} @ ${p.entryPrice}`));
  
  await connection.end();
}

checkAutoTrading().catch(console.error);
