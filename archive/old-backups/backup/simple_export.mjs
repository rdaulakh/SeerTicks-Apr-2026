import mysql from 'mysql2/promise';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;

async function exportDatabase() {
  console.log('Connecting to database...');
  const connection = await mysql.createConnection({
    uri: DATABASE_URL,
    connectTimeout: 30000
  });
  
  console.log('Connected. Getting tables...');
  const [tables] = await connection.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  
  console.log(`Found ${tableNames.length} tables`);
  
  let exportData = {
    exportDate: new Date().toISOString(),
    tables: {}
  };
  
  // Export important tables only (skip large history tables)
  const priorityTables = [
    'users', 'tradingModeConfig', 'exchangeConfigs', 'symbolConfigs',
    'positions', 'orders', 'trades', 'engineState', 'agentSignals',
    'portfolioSnapshots', 'userSettings'
  ];
  
  for (const tableName of tableNames) {
    try {
      // Limit rows for large tables
      const limit = priorityTables.includes(tableName) ? '' : ' LIMIT 1000';
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\`${limit}`);
      exportData.tables[tableName] = rows;
      console.log(`${tableName}: ${rows.length} rows`);
    } catch (err) {
      console.error(`Error ${tableName}:`, err.message);
    }
  }
  
  fs.writeFileSync('backup/database_export.json', JSON.stringify(exportData, null, 2));
  console.log('\nExported to backup/database_export.json');
  
  await connection.end();
  console.log('Done!');
}

exportDatabase().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
