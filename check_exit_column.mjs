import mysql from 'mysql2/promise';

const connection = await mysql.createConnection(process.env.DATABASE_URL);

const [columns] = await connection.query(`SHOW COLUMNS FROM paperPositions WHERE Field = 'exitReason'`);
console.log("exitReason column:", columns[0]);

await connection.end();
