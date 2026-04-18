import { drizzle } from 'drizzle-orm/mysql2';
import { paperWallets, paperPositions } from './drizzle/schema.ts';
import { eq } from 'drizzle-orm';

const db = drizzle(process.env.DATABASE_URL);

// Get wallet for user 1260007
const wallets = await db.select().from(paperWallets).where(eq(paperWallets.userId, 1260007));
console.log('\n=== PAPER WALLET ===');
console.log(JSON.stringify(wallets, null, 2));

// Get open positions
const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, 1260007));
console.log('\n=== PAPER POSITIONS (showing first 3) ===');
console.log(JSON.stringify(positions.slice(0, 3), null, 2));

console.log('\n=== SUMMARY ===');
if (wallets.length > 0) {
  const wallet = wallets[0];
  console.log(`Balance: $${wallet.balance}`);
  console.log(`Equity: $${wallet.equity}`);
  console.log(`Total P&L: $${wallet.totalPnL}`);
  console.log(`Realized P&L: $${wallet.realizedPnL}`);
  console.log(`Unrealized P&L: $${wallet.unrealizedPnL}`);
  console.log(`Total Trades: ${wallet.totalTrades}`);
  console.log(`Win Rate: ${wallet.winRate}%`);
}

const openPositions = positions.filter(p => p.status === 'open');
console.log(`\nOpen Positions: ${openPositions.length}`);
console.log(`Closed Positions: ${positions.length - openPositions.length}`);

if (openPositions.length > 0) {
  console.log('\n=== OPEN POSITION DETAILS ===');
  openPositions.forEach(pos => {
    console.log(`\nSymbol: ${pos.symbol}`);
    console.log(`Side: ${pos.side}`);
    console.log(`Entry: $${pos.entryPrice}`);
    console.log(`Current: $${pos.currentPrice}`);
    console.log(`Stop Loss: ${pos.stopLoss ? '$' + pos.stopLoss : 'Not set'}`);
    console.log(`Take Profit: ${pos.takeProfit ? '$' + pos.takeProfit : 'Not set'}`);
    console.log(`Partial Exits: ${pos.partialExits ? JSON.stringify(pos.partialExits) : 'None'}`);
  });
}

process.exit(0);
