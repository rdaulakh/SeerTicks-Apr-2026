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

const [signalCount] = await conn.execute('SELECT COUNT(*) as count FROM agentSignals WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)');
console.log('Signals (last hour):', signalCount[0].count);

const [candleCount] = await conn.execute('SELECT COUNT(*) as count FROM historicalCandles');
console.log('Historical Candles:', candleCount[0].count);

await conn.end();
