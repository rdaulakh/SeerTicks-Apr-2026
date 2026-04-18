import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();

async function testLogin() {
  console.log('Testing login flow...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
  
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 1,
  });
  
  try {
    console.log('1. Connecting to database...');
    const [rows] = await pool.execute(
      'SELECT id, email, passwordHash, name, role, openId FROM users WHERE email = ? LIMIT 1',
      ['rdaulakh@exoways.com']
    );
    console.log('2. Query result:', rows.length, 'rows');
    
    if (rows.length === 0) {
      console.log('User not found!');
      return;
    }
    
    const user = rows[0];
    console.log('3. User found:', { id: user.id, email: user.email, hasPassword: !!user.passwordHash });
    
    console.log('4. Comparing password...');
    const isValid = await bcrypt.compare('Punjab@123456', user.passwordHash);
    console.log('5. Password valid:', isValid);
    
    if (isValid) {
      console.log('6. Login would succeed!');
    } else {
      console.log('6. Login would fail - password mismatch');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testLogin();
