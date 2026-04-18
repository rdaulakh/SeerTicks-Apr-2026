import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// Get all tables
const [tables] = await connection.query(`SHOW TABLES`);
const tableNames = tables.map(t => Object.values(t)[0]);

console.log("=== DATABASE SCHEMA ANALYSIS ===\n");

// Key tables to check
const keyTables = [
  'agentSignals', 'paperPositions', 'paperTrades', 'trades', 
  'tradeDecisionLogs', 'consensusHistory', 'engineState',
  'tradingModeConfig', 'riskLimitBreaches', 'executionLatencyLogs'
];

for (const table of keyTables) {
  if (tableNames.includes(table)) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
    console.log(`\n--- ${table} ---`);
    columns.forEach(col => {
      console.log(`  ${col.Field} (${col.Type})`);
    });
  } else {
    console.log(`\n--- ${table} --- NOT FOUND`);
  }
}

await connection.end();
