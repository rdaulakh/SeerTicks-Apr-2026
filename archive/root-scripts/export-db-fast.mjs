import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

async function exportDatabase() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  // Get all tables
  const [tables] = await connection.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  
  let output = `-- SEER Trading Platform Database Export\n`;
  output += `-- Generated: ${new Date().toISOString()}\n`;
  output += `-- Tables: ${tableNames.length}\n\n`;
  
  // Important tables to export with data (limited rows)
  const dataExportTables = [
    'users', 'apiKeys', 'exchangeSettings', 'accountSettings', 
    'alertPreferences', 'automatedTradingSettings', 'tradingSymbols',
    'patterns', 'strategies', 'strategyPerformance', 'agentWeights',
    'engineState', 'engine_state', 'externalApiKeys'
  ];
  
  for (const tableName of tableNames) {
    console.log(`Exporting table: ${tableName}`);
    
    // Get CREATE TABLE statement
    const [createResult] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
    const createStatement = createResult[0]['Create Table'];
    
    output += `-- Table: ${tableName}\n`;
    output += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
    output += `${createStatement};\n\n`;
    
    // Export data only for important config tables
    if (dataExportTables.includes(tableName)) {
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT 1000`);
      
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        
        for (const row of rows) {
          const values = columns.map(col => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'number') return val;
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
            return `'${String(val).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
          });
          output += `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${values.join(', ')});\n`;
        }
        output += '\n';
      }
    }
  }
  
  await connection.end();
  
  fs.writeFileSync('/home/ubuntu/seer_database_backup.sql', output);
  console.log(`\nDatabase exported to /home/ubuntu/seer_database_backup.sql`);
  console.log(`Total tables: ${tableNames.length}`);
}

exportDatabase().catch(console.error);
