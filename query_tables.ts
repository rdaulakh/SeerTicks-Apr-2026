import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function queryTables() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  
  // Get all table names
  const [tables] = await connection.query(`
    SELECT TABLE_NAME, TABLE_ROWS 
    FROM information_schema.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() 
    ORDER BY TABLE_NAME
  `);
  
  console.log('\n=== Database Tables ===\n');
  console.table(tables);
  
  await connection.end();
}

queryTables().catch(console.error);
