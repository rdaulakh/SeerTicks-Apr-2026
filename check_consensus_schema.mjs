import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== consensusHistory SCHEMA ===");
const [cols] = await conn.query(`DESCRIBE consensusHistory`);
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type} ${c.Null === 'NO' ? 'NOT NULL' : ''} ${c.Default ? `DEFAULT ${c.Default}` : ''}`));

await conn.end();
