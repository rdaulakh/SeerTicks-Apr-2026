import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();

async function verifyPassword() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 1,
  });
  
  try {
    const [rows] = await pool.execute(
      "SELECT id, email, passwordHash FROM users WHERE email = 'rdaulakh@exoways.com'"
    );
    
    if (rows.length === 0) {
      console.log('User not found');
      return;
    }
    
    const user = rows[0];
    console.log('User ID:', user.id);
    console.log('Password hash length:', user.passwordHash?.length || 0);
    console.log('Password hash starts with $2:', user.passwordHash?.startsWith('$2'));
    
    const testPassword = 'Punjab@123456';
    const isValid = await bcrypt.compare(testPassword, user.passwordHash);
    console.log('Password valid:', isValid);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyPassword();
