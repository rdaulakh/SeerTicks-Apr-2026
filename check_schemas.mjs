import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function checkSchemas() {
  const connection = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== TICKS TABLE COLUMNS ===');
  const [ticksCols] = await connection.execute('DESCRIBE ticks');
  console.table(ticksCols);
  
  console.log('\n=== AGENT SIGNALS TABLE COLUMNS ===');
  const [signalsCols] = await connection.execute('DESCRIBE agentSignals');
  console.table(signalsCols);
  
  console.log('\n=== ROOT CAUSE SUMMARY ===');
  console.log('1. ticks table uses "timestampMs" (bigint) NOT "timestamp"');
  console.log('2. Need to check agentSignals timestamp column name');
  
  await connection.end();
}

checkSchemas().catch(console.error);
