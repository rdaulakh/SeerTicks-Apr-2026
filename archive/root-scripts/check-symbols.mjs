import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

console.log('=== Trading Symbols ===');
const [symbols] = await conn.query('SELECT id, userId, symbol, exchangeName, isActive FROM tradingSymbols ORDER BY id DESC');
symbols.forEach(s => console.log(`  ID: ${s.id}, UserID: ${s.userId}, Symbol: ${s.symbol}, Exchange: ${s.exchangeName}, Active: ${s.isActive}`));

console.log('\n=== Active Exchanges ===');
const [exchanges] = await conn.query('SELECT id, userId, exchangeName, isActive, connectionStatus FROM exchanges ORDER BY id DESC');
exchanges.forEach(e => console.log(`  ID: ${e.id}, UserID: ${e.userId}, Exchange: ${e.exchangeName}, Active: ${e.isActive}, Status: ${e.connectionStatus}`));

console.log('\n=== Users ===');
const [users] = await conn.query('SELECT id, email, name FROM users ORDER BY id DESC LIMIT 5');
users.forEach(u => console.log(`  ID: ${u.id}, Email: ${u.email}, Name: ${u.name}`));

await conn.end();
