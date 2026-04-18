import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check table sizes
const [tables] = await conn.execute(`
  SELECT 
    TABLE_NAME as tableName,
    TABLE_ROWS as rowCount,
    ROUND(DATA_LENGTH / 1024 / 1024, 2) as dataSizeMB,
    ROUND(INDEX_LENGTH / 1024 / 1024, 2) as indexSizeMB
  FROM information_schema.TABLES 
  WHERE TABLE_SCHEMA = DATABASE()
  ORDER BY DATA_LENGTH DESC
  LIMIT 20
`);
console.log('Table Sizes:');
console.table(tables);

// Check for any orphaned records or data inconsistencies
const [positionCount] = await conn.execute('SELECT COUNT(*) as count FROM paperPositions WHERE status = "open"');
console.log('\nOpen Positions:', positionCount[0].count);

// Check agentSignals schema
const [columns] = await conn.execute('DESCRIBE agentSignals');
const timestampCol = columns.find(c => c.Field.toLowerCase().includes('timestamp') || c.Field.toLowerCase().includes('created'));
console.log('\nagentSignals timestamp column:', timestampCol?.Field || 'not found');

const [candleCount] = await conn.execute('SELECT COUNT(*) as count FROM historicalCandles');
console.log('Historical Candles:', candleCount[0].count);

// Check engine state
const [engineState] = await conn.execute('SELECT * FROM engineState ORDER BY id DESC LIMIT 1');
console.log('\nEngine State:', engineState[0] || 'No state found');

await conn.end();
