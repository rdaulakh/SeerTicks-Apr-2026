import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`SELECT * FROM engineState WHERE userId = 272657`);
console.log('Engine State:', JSON.stringify(rows, null, 2));

await conn.end();
