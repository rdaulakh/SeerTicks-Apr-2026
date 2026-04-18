import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== engineState SCHEMA ===");
const [cols] = await conn.query(`DESCRIBE engineState`);
cols.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

console.log("\n=== engineState DATA ===");
const [data] = await conn.query(`SELECT * FROM engineState`);
console.log(JSON.stringify(data, null, 2));

console.log("\n=== engine_state SCHEMA ===");
const [cols2] = await conn.query(`DESCRIBE engine_state`);
cols2.forEach(c => console.log(`  ${c.Field}: ${c.Type}`));

console.log("\n=== engine_state DATA ===");
const [data2] = await conn.query(`SELECT * FROM engine_state`);
console.log(JSON.stringify(data2, null, 2));

await conn.end();
