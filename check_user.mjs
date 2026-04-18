import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function checkUser() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 1,
  });
  
  try {
    const [rows] = await pool.execute(
      "SELECT id, email, name, CASE WHEN passwordHash IS NOT NULL AND LENGTH(passwordHash) > 0 THEN 'SET' ELSE 'NOT SET' END as pwd_status, role, loginMethod FROM users WHERE email = 'rdaulakh@exoways.com'"
    );
    console.log('User found:', JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkUser();
