import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import fs from 'fs';

async function exportDatabase() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);
  
  // Get all tables
  const [tables] = await connection.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  
  let exportData = {
    exportDate: new Date().toISOString(),
    tables: {}
  };
  
  console.log(`Found ${tableNames.length} tables`);
  
  for (const tableName of tableNames) {
    try {
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
      exportData.tables[tableName] = rows;
      console.log(`Exported ${tableName}: ${rows.length} rows`);
    } catch (err) {
      console.error(`Error exporting ${tableName}:`, err.message);
    }
  }
  
  // Write to JSON file
  fs.writeFileSync('backup/database_export.json', JSON.stringify(exportData, null, 2));
  console.log('Database exported to backup/database_export.json');
  
  // Also create SQL dump format
  let sqlDump = `-- SEER Trading Platform Database Export\n-- Date: ${new Date().toISOString()}\n\n`;
  
  for (const tableName of tableNames) {
    const rows = exportData.tables[tableName];
    if (rows && rows.length > 0) {
      sqlDump += `-- Table: ${tableName} (${rows.length} rows)\n`;
      for (const row of rows) {
        const columns = Object.keys(row).map(k => `\`${k}\``).join(', ');
        const values = Object.values(row).map(v => {
          if (v === null) return 'NULL';
          if (typeof v === 'number') return v;
          if (v instanceof Date) return `'${v.toISOString()}'`;
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ');
        sqlDump += `INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});\n`;
      }
      sqlDump += '\n';
    }
  }
  
  fs.writeFileSync('backup/database_export.sql', sqlDump);
  console.log('SQL dump created at backup/database_export.sql');
  
  await connection.end();
}

exportDatabase().catch(console.error);
