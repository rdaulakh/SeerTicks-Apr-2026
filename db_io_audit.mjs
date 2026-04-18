import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('DATABASE OPERATIONS & I/O PERFORMANCE AUDIT');
console.log('='.repeat(80));

// Get all table sizes
console.log('\n=== TABLE SIZES ===');
try {
  const [tables] = await connection.execute(`
    SELECT 
      table_name as tableName,
      table_rows as rowCount,
      ROUND(data_length / 1024 / 1024, 2) as dataSizeMB,
      ROUND(index_length / 1024 / 1024, 2) as indexSizeMB,
      ROUND((data_length + index_length) / 1024 / 1024, 2) as totalSizeMB
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY (data_length + index_length) DESC
    LIMIT 20
  `);
  console.log('Top 20 tables by size:');
  console.log('Table Name'.padEnd(35) + 'Rows'.padStart(12) + 'Data MB'.padStart(10) + 'Index MB'.padStart(10) + 'Total MB'.padStart(10));
  console.log('-'.repeat(77));
  for (const t of tables) {
    console.log(
      (t.tableName || '').padEnd(35) + 
      (t.rowCount?.toString() || '0').padStart(12) + 
      (t.dataSizeMB?.toString() || '0').padStart(10) + 
      (t.indexSizeMB?.toString() || '0').padStart(10) + 
      (t.totalSizeMB?.toString() || '0').padStart(10)
    );
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for missing indexes
console.log('\n=== INDEX ANALYSIS ===');
try {
  const [indexes] = await connection.execute(`
    SELECT 
      table_name as tableName,
      index_name as indexName,
      column_name as columnName,
      non_unique as nonUnique
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    ORDER BY table_name, index_name
  `);
  
  // Group by table
  const tableIndexes = {};
  for (const idx of indexes) {
    if (!tableIndexes[idx.tableName]) {
      tableIndexes[idx.tableName] = [];
    }
    tableIndexes[idx.tableName].push(idx.indexName);
  }
  
  // Check critical tables for indexes
  const criticalTables = ['agentSignals', 'paperPositions', 'ticks', 'candleData', 'trades', 'consensusHistory'];
  console.log('Index status for critical tables:');
  for (const table of criticalTables) {
    const idxs = tableIndexes[table] || [];
    const uniqueIdxs = [...new Set(idxs)];
    console.log(`  ${table}: ${uniqueIdxs.length} indexes - ${uniqueIdxs.join(', ') || 'NONE'}`);
  }
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for slow query indicators
console.log('\n=== QUERY PERFORMANCE INDICATORS ===');
try {
  // Check agentSignals query performance
  const start1 = Date.now();
  const [signals] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM agentSignals WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  `);
  const time1 = Date.now() - start1;
  console.log(`  agentSignals (1hr count): ${signals[0].cnt} rows in ${time1}ms`);
  
  // Check paperPositions query performance
  const start2 = Date.now();
  const [positions] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM paperPositions WHERE status = 'open'
  `);
  const time2 = Date.now() - start2;
  console.log(`  paperPositions (open count): ${positions[0].cnt} rows in ${time2}ms`);
  
  // Check consensus history query performance
  const start3 = Date.now();
  const [consensus] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM consensusHistory
  `);
  const time3 = Date.now() - start3;
  console.log(`  consensusHistory (total count): ${consensus[0].cnt} rows in ${time3}ms`);
  
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check for data integrity issues
console.log('\n=== DATA INTEGRITY CHECKS ===');
try {
  // Check for orphaned positions (no user)
  const [orphanedPos] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM paperPositions p
    LEFT JOIN users u ON p.userId = u.id
    WHERE u.id IS NULL
  `);
  console.log(`  Orphaned positions (no user): ${orphanedPos[0].cnt}`);
  
  // Check for signals without valid agent
  const [nullAgentSignals] = await connection.execute(`
    SELECT COUNT(*) as cnt FROM agentSignals WHERE agentName IS NULL OR agentName = ''
  `);
  console.log(`  Signals without agent name: ${nullAgentSignals[0].cnt}`);
  
  // Check for duplicate records
  const [dupSignals] = await connection.execute(`
    SELECT agentName, symbol, createdAt, COUNT(*) as cnt
    FROM agentSignals
    GROUP BY agentName, symbol, createdAt
    HAVING cnt > 1
    LIMIT 5
  `);
  console.log(`  Duplicate signals (same agent/symbol/time): ${dupSignals.length > 0 ? dupSignals.length + ' found' : 'None'}`);
  
} catch (e) {
  console.log(`Error: ${e.message}`);
}

// Check database connection pool status
console.log('\n=== DATABASE CONNECTION STATUS ===');
try {
  const [processlist] = await connection.execute(`SHOW PROCESSLIST`);
  console.log(`  Active connections: ${processlist.length}`);
  
  const [variables] = await connection.execute(`SHOW VARIABLES LIKE 'max_connections'`);
  console.log(`  Max connections: ${variables[0]?.Value || 'Unknown'}`);
  
  const [status] = await connection.execute(`SHOW STATUS LIKE 'Threads_connected'`);
  console.log(`  Threads connected: ${status[0]?.Value || 'Unknown'}`);
} catch (e) {
  console.log(`Error: ${e.message}`);
}

await connection.end();
