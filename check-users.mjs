import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const [rows] = await connection.execute("SELECT id, openId, name, email FROM users WHERE email LIKE '%rdaulakh%' OR email LIKE '%exoways%'");
  console.log('Users:');
  console.log(JSON.stringify(rows, null, 2));
  await connection.end();
}

main().catch(console.error);
