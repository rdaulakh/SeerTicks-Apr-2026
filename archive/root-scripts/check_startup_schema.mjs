import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== systemStartupLog SCHEMA ===");
const [cols] = await conn.query(`DESCRIBE systemStartupLog`);
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

console.log("\n=== SAMPLE DATA ===");
const [rows] = await conn.query(`SELECT * FROM systemStartupLog ORDER BY id DESC LIMIT 3`);
console.log(JSON.stringify(rows, null, 2));

await conn.end();
