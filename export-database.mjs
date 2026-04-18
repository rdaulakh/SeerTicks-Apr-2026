import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import fs from 'fs';

async function exportDatabase() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);
  
  // Get all tables
  const [tables] = await connection.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  
  const backup = {
    exportDate: new Date().toISOString(),
    tables: {}
  };
  
  for (const tableName of tableNames) {
    try {
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
      backup.tables[tableName] = {
        rowCount: rows.length,
        data: rows
      };
      console.log(`Exported ${tableName}: ${rows.length} rows`);
    } catch (err) {
      console.error(`Error exporting ${tableName}:`, err.message);
    }
  }
  
  fs.writeFileSync('/home/ubuntu/seer-database-backup.json', JSON.stringify(backup, null, 2));
  console.log('\nDatabase backup saved to /home/ubuntu/seer-database-backup.json');
  
  await connection.end();
}

exportDatabase().catch(console.error);
