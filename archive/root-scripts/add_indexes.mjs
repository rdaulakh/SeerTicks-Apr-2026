import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ADDING DATABASE INDEXES ===\n");

// Check existing indexes first
async function getExistingIndexes(table) {
  const [indexes] = await conn.query(`SHOW INDEX FROM ${table}`);
  return indexes.map(i => i.Key_name);
}

// Add index if it doesn't exist
async function addIndex(table, indexName, columns) {
  const existing = await getExistingIndexes(table);
  if (existing.includes(indexName)) {
    console.log(`  ⏭️  Index ${indexName} already exists on ${table}`);
    return false;
  }
  
  console.log(`  ➕ Creating index ${indexName} on ${table}(${columns})...`);
  const start = Date.now();
  try {
    await conn.query(`CREATE INDEX ${indexName} ON ${table}(${columns})`);
    console.log(`  ✅ Created in ${Date.now() - start}ms`);
    return true;
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    return false;
  }
}

// 1. agentSignals indexes (17.7 GB table - this is critical)
console.log("1. agentSignals table:");
await addIndex('agentSignals', 'idx_agentSignals_userId', 'userId');
await addIndex('agentSignals', 'idx_agentSignals_symbol', 'symbol(50)');
await addIndex('agentSignals', 'idx_agentSignals_createdAt', 'createdAt');
await addIndex('agentSignals', 'idx_agentSignals_agentName', 'agentName(50)');
await addIndex('agentSignals', 'idx_agentSignals_userId_symbol', 'userId, symbol(50)');
await addIndex('agentSignals', 'idx_agentSignals_userId_createdAt', 'userId, createdAt');

// 2. paperPositions indexes
console.log("\n2. paperPositions table:");
await addIndex('paperPositions', 'idx_paperPositions_userId', 'userId');
await addIndex('paperPositions', 'idx_paperPositions_status', 'status(20)');
await addIndex('paperPositions', 'idx_paperPositions_symbol', 'symbol(50)');
await addIndex('paperPositions', 'idx_paperPositions_userId_status', 'userId, status(20)');

// 3. trades indexes
console.log("\n3. trades table:");
await addIndex('trades', 'idx_trades_userId', 'userId');
await addIndex('trades', 'idx_trades_symbol', 'symbol(50)');
await addIndex('trades', 'idx_trades_createdAt', 'createdAt');
await addIndex('trades', 'idx_trades_userId_symbol', 'userId, symbol(50)');

// 4. paperTrades indexes
console.log("\n4. paperTrades table:");
await addIndex('paperTrades', 'idx_paperTrades_userId', 'userId');
await addIndex('paperTrades', 'idx_paperTrades_positionId', 'positionId');
await addIndex('paperTrades', 'idx_paperTrades_symbol', 'symbol(50)');

// 5. consensusHistory indexes
console.log("\n5. consensusHistory table:");
await addIndex('consensusHistory', 'idx_consensusHistory_userId', 'userId');
await addIndex('consensusHistory', 'idx_consensusHistory_symbol', 'symbol(50)');

// 6. tradeDecisionLogs indexes
console.log("\n6. tradeDecisionLogs table:");
await addIndex('tradeDecisionLogs', 'idx_tradeDecisionLogs_userId', 'userId');
await addIndex('tradeDecisionLogs', 'idx_tradeDecisionLogs_decision', 'decision(20)');

// Verify indexes were created
console.log("\n=== VERIFICATION ===");
for (const table of ['agentSignals', 'paperPositions', 'trades', 'paperTrades']) {
  const indexes = await getExistingIndexes(table);
  console.log(`${table}: ${indexes.length} indexes - ${indexes.join(', ')}`);
}

await conn.end();
console.log("\n=== INDEX CREATION COMPLETE ===");
