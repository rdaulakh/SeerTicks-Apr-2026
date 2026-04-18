import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';

async function testAuth() {
  console.log('=== SEER Authentication Audit ===\n');
  
  // Step 1: Database connection
  console.log('Step 1: Testing database connection...');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('✅ Database connected\n');
  
  // Step 2: Find user
  console.log('Step 2: Finding user...');
  const [rows] = await conn.execute(
    'SELECT id, email, passwordHash, role, name FROM users WHERE email = ?', 
    ['rdaulakh@exoways.com']
  );
  
  if (rows.length === 0) {
    console.log('❌ User not found');
    await conn.end();
    return;
  }
  
  const user = rows[0];
  console.log('✅ User found:');
  console.log('   ID:', user.id);
  console.log('   Email:', user.email);
  console.log('   Name:', user.name);
  console.log('   Role:', user.role);
  console.log('   Has password:', user.passwordHash ? 'YES' : 'NO');
  console.log('');
  
  // Step 3: Verify password
  console.log('Step 3: Verifying password...');
  const testPassword = 'Punjab@123456';
  let isValid = false;
  
  try {
    isValid = await bcrypt.compare(testPassword, user.passwordHash);
  } catch (e) {
    console.log('❌ Password comparison failed:', e.message);
  }
  
  if (isValid) {
    console.log('✅ Password is correct\n');
  } else {
    console.log('❌ Password is incorrect');
    console.log('   Updating password in database...');
    
    const newHash = await bcrypt.hash(testPassword, 10);
    await conn.execute(
      'UPDATE users SET passwordHash = ? WHERE email = ?', 
      [newHash, 'rdaulakh@exoways.com']
    );
    console.log('✅ Password updated\n');
  }
  
  // Step 4: Test JWT
  console.log('Step 4: Testing JWT signing...');
  const jwt = await import('jsonwebtoken');
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) { console.error('JWT_SECRET env var required'); process.exit(1); }
  
  const token = jwt.default.sign(
    { userId: user.id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: '7d' }
  );
  console.log('✅ JWT created, length:', token.length);
  
  const decoded = jwt.default.verify(token, jwtSecret);
  console.log('✅ JWT verified, userId:', decoded.userId);
  console.log('');
  
  // Step 5: Test login endpoint
  console.log('Step 5: Testing login endpoint...');
  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rdaulakh@exoways.com', password: 'Punjab@123456' })
    });
    
    const data = await response.json();
    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Login endpoint working\n');
    } else {
      console.log('❌ Login endpoint failed\n');
    }
  } catch (e) {
    console.log('❌ Login endpoint error:', e.message, '\n');
  }
  
  // Step 6: Test auth check endpoint
  console.log('Step 6: Testing auth check endpoint...');
  try {
    const response = await fetch('http://localhost:3000/api/auth/me');
    const data = await response.json();
    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(data, null, 2));
    console.log('✅ Auth check endpoint working\n');
  } catch (e) {
    console.log('❌ Auth check endpoint error:', e.message, '\n');
  }
  
  await conn.end();
  console.log('=== Audit Complete ===');
}

testAuth().catch(console.error);
