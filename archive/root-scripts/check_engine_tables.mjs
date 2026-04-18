import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ENGINE-RELATED TABLES ===");
const [tables] = await conn.query(`SHOW TABLES LIKE '%engine%'`);
tables.forEach(t => console.log(`  ${Object.values(t)[0]}`));

console.log("\n=== ALL TABLES ===");
const [allTables] = await conn.query(`SHOW TABLES`);
allTables.forEach(t => console.log(`  ${Object.values(t)[0]}`));

await conn.end();
