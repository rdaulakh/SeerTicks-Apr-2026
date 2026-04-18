import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, 
         unrealizedPnLPercent, createdAt, updatedAt
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
`);

console.log('Open positions:', positions.length);
for (const p of positions) {
  console.log(`${p.id}: ${p.symbol} ${p.side} Entry=$${p.entryPrice} Current=$${p.currentPrice} PnL=${p.unrealizedPnLPercent}%`);
}

await conn.end();
