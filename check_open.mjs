import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
const connection = await mysql.createConnection(DATABASE_URL);

// Check open positions
const [openPositions] = await connection.execute(
  `SELECT id, symbol, side, entryPrice, currentPrice, quantity, status, createdAt 
   FROM paperPositions 
   WHERE userId = 272657 AND status = 'open'
   ORDER BY id DESC`
);

console.log('=== OPEN POSITIONS ===');
console.log(`Count: ${openPositions.length}`);
for (const pos of openPositions) {
  console.log(`  ID: ${pos.id} | ${pos.symbol} ${pos.side} @ $${pos.entryPrice} | qty: ${pos.quantity} | created: ${pos.createdAt}`);
}

await connection.end();
