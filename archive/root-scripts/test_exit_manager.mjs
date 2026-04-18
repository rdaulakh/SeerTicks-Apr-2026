import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
const connection = await mysql.createConnection(DATABASE_URL);

// Check if positions have proper IDs that can be used by exit manager
const [openPositions] = await connection.execute(
  `SELECT id, symbol, side, entryPrice, currentPrice, quantity, createdAt 
   FROM paperPositions 
   WHERE userId = 272657 AND status = 'open'
   ORDER BY id DESC`
);

console.log('=== POSITIONS THAT SHOULD BE IN EXIT MANAGER ===');
console.log(`Total: ${openPositions.length} open positions`);

for (const pos of openPositions) {
  const entryPrice = parseFloat(pos.entryPrice);
  const currentPrice = parseFloat(pos.currentPrice);
  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  
  console.log(`\nPosition ID: ${pos.id} (${typeof pos.id})`);
  console.log(`  Symbol: ${pos.symbol} ${pos.side}`);
  console.log(`  Entry: $${entryPrice.toFixed(2)}`);
  console.log(`  Current: $${currentPrice.toFixed(2)}`);
  console.log(`  P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
  console.log(`  Created: ${pos.createdAt}`);
}

// Check if there are any recent trades recorded
const [recentTrades] = await connection.execute(
  `SELECT id, orderId, symbol, side, price, quantity, pnl, strategy, timestamp 
   FROM paperTrades 
   WHERE userId = 272657 
   ORDER BY timestamp DESC
   LIMIT 10`
);

console.log('\n=== RECENT TRADES ===');
for (const trade of recentTrades) {
  const pnl = parseFloat(trade.pnl || '0');
  console.log(`  ${trade.timestamp} | ${trade.symbol} ${trade.side} @ $${trade.price} | P&L: $${pnl.toFixed(2)} | ${trade.strategy}`);
}

await connection.end();
