import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check open positions
const [open] = await conn.execute(`
  SELECT id, symbol FROM paperPositions WHERE status = 'open' AND userId = 272657
`);
console.log(`Open positions: ${open.length}`);
for (const p of open) console.log(`  ${p.id} (${p.symbol})`);

// Check recently closed
const [closed] = await conn.execute(`
  SELECT id, symbol, exitReason, updatedAt
  FROM paperPositions 
  WHERE status = 'closed' AND userId = 272657
  ORDER BY updatedAt DESC
  LIMIT 3
`);
console.log('\nRecently closed:');
for (const p of closed) {
  console.log(`  ${p.id} (${p.symbol}): ${p.exitReason || 'N/A'} - ${p.updatedAt}`);
}

await conn.end();
