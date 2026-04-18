import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
console.log('Testing database connection...');
console.log('DATABASE_URL:', DATABASE_URL ? 'Set' : 'Not set');

try {
  const connection = await mysql.createConnection(DATABASE_URL);
  console.log('Connected successfully!');
  
  const [rows] = await connection.execute('SELECT COUNT(*) as count FROM exchanges');
  console.log('Exchanges count:', rows[0].count);
  
  await connection.end();
  console.log('Connection closed');
} catch (error) {
  console.error('Error:', error.message);
}
