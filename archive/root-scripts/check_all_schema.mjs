import mysql from 'mysql2/promise';
const connection = await mysql.createConnection(process.env.DATABASE_URL);

const tables = ['agentSignals', 'paperTrades', 'paperPositions', 'paperWallets', 
                'seerEngineState', 'tradeLogs', 'consensusHistory', 'mlOptimizationLogs',
                'agentWeights', 'trades'];

for (const table of tables) {
  try {
    const [columns] = await connection.execute(`DESCRIBE ${table}`);
    console.log(`\n${table}:`);
    for (const col of columns) {
      console.log(`  ${col.Field}: ${col.Type}`);
    }
  } catch (e) {
    console.log(`\n${table}: TABLE NOT FOUND`);
  }
}
await connection.end();
