import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [cols] = await conn.query("DESCRIBE agentSignals");
cols.forEach(c => console.log(c.Field));
await conn.end();
