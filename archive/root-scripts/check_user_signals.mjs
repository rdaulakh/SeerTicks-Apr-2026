import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check signals for user 272657
const [signals272657] = await conn.execute(`
  SELECT agentName, signalType, confidence, timestamp 
  FROM agentSignals 
  WHERE userId = 272657
  ORDER BY timestamp DESC 
  LIMIT 20
`);
console.log('=== SIGNALS FOR USER 272657 ===');
console.log(`Total: ${signals272657.length}`);
signals272657.forEach(s => {
  console.log(`  ${s.agentName}: ${s.signalType} ${(parseFloat(s.confidence) * 100).toFixed(1)}% @ ${new Date(s.timestamp).toISOString()}`);
});

// Check signals for user 1
const [signals1] = await conn.execute(`
  SELECT agentName, signalType, confidence, timestamp 
  FROM agentSignals 
  WHERE userId = 1
  ORDER BY timestamp DESC 
  LIMIT 10
`);
console.log('\n=== SIGNALS FOR USER 1 ===');
console.log(`Total: ${signals1.length}`);
signals1.forEach(s => {
  console.log(`  ${s.agentName}: ${s.signalType} ${(parseFloat(s.confidence) * 100).toFixed(1)}% @ ${new Date(s.timestamp).toISOString()}`);
});

// Check if any signals have non-zero confidence in last hour
const [goodSignals] = await conn.execute(`
  SELECT agentName, signalType, confidence, userId, timestamp 
  FROM agentSignals 
  WHERE confidence > 0 AND timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  ORDER BY timestamp DESC 
  LIMIT 20
`);
console.log('\n=== SIGNALS WITH CONFIDENCE > 0 (LAST HOUR) ===');
console.log(`Total: ${goodSignals.length}`);
goodSignals.forEach(s => {
  console.log(`  User ${s.userId} | ${s.agentName}: ${s.signalType} ${(parseFloat(s.confidence) * 100).toFixed(1)}%`);
});

await conn.end();
