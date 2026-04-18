import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const db = drizzle(process.env.DATABASE_URL!);

async function audit() {
  console.log('========================================');
  console.log('PERFORMANCE PAGE DATA AUDIT');
  console.log('========================================\n');
  
  // Check wallet
  const wallet = await db.execute(sql`SELECT balance, margin, equity, totalPnL, realizedPnL, winRate, totalTrades, winningTrades, losingTrades FROM paperWallets WHERE userId = 1`);
  console.log('=== WALLET DATA ===');
  const w = wallet[0][0] as any;
  console.log(`Balance (deposited): $${parseFloat(w.balance).toFixed(2)}`);
  console.log(`Margin (in use): $${parseFloat(w.margin).toFixed(2)}`);
  console.log(`Equity (actual value): $${parseFloat(w.equity).toFixed(2)}`);
  console.log(`Total P&L: $${parseFloat(w.totalPnL).toFixed(2)}`);
  console.log(`Realized P&L: $${parseFloat(w.realizedPnL).toFixed(2)}`);
  console.log(`Win Rate: ${(parseFloat(w.winRate) * 100).toFixed(1)}%`);
  console.log(`Total Trades: ${w.totalTrades}`);
  console.log(`Winning Trades: ${w.winningTrades}`);
  console.log(`Losing Trades: ${w.losingTrades}`);
  
  // Check closed positions count
  const closedCount = await db.execute(sql`SELECT COUNT(*) as total, SUM(CASE WHEN realizedPnl > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN realizedPnl <= 0 THEN 1 ELSE 0 END) as losses FROM paperPositions WHERE status = 'closed'`);
  console.log('\n=== ACTUAL CLOSED POSITIONS (from paperPositions table) ===');
  const c = closedCount[0][0] as any;
  console.log(`Total Closed: ${c.total}`);
  console.log(`Wins (P&L > 0): ${c.wins}`);
  console.log(`Losses (P&L <= 0): ${c.losses}`);
  console.log(`Actual Win Rate: ${((parseInt(c.wins) / parseInt(c.total)) * 100).toFixed(1)}%`);
  
  // Check open positions
  const openPositions = await db.execute(sql`SELECT id, symbol, side, quantity, entryPrice, currentPrice, unrealizedPnl, status FROM paperPositions WHERE status = 'open'`);
  console.log('\n=== OPEN POSITIONS ===');
  const openPos = openPositions[0] as any[];
  if (openPos.length === 0) {
    console.log('No open positions');
  } else {
    openPos.forEach((p: any) => {
      console.log(`${p.symbol} ${p.side.toUpperCase()} | Qty: ${p.quantity} | Entry: $${parseFloat(p.entryPrice).toFixed(2)} | Current: $${parseFloat(p.currentPrice).toFixed(2)} | Unrealized P&L: $${parseFloat(p.unrealizedPnl).toFixed(2)}`);
    });
  }
  
  // Check recent trades sorted by date
  const recentTrades = await db.execute(sql`SELECT id, symbol, side, entryPrice, realizedPnl, createdAt, updatedAt FROM paperPositions WHERE status = 'closed' ORDER BY updatedAt DESC LIMIT 10`);
  console.log('\n=== RECENT CLOSED TRADES (newest first) ===');
  const recent = recentTrades[0] as any[];
  recent.forEach((t: any, i: number) => {
    const pnl = parseFloat(t.realizedPnl);
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    console.log(`${i+1}. ${t.symbol} ${t.side.toUpperCase()} | Entry: $${parseFloat(t.entryPrice).toFixed(2)} | P&L: ${pnlStr} | Closed: ${new Date(t.updatedAt).toLocaleString()}`);
  });
  
  // Check best trades (highest P&L)
  const bestTrades = await db.execute(sql`SELECT id, symbol, side, entryPrice, realizedPnl FROM paperPositions WHERE status = 'closed' AND realizedPnl > 0 ORDER BY realizedPnl DESC LIMIT 5`);
  console.log('\n=== BEST TRADES (highest P&L) ===');
  const best = bestTrades[0] as any[];
  if (best.length === 0) {
    console.log('No winning trades');
  } else {
    best.forEach((t: any, i: number) => {
      console.log(`${i+1}. ${t.symbol} ${t.side.toUpperCase()} | Entry: $${parseFloat(t.entryPrice).toFixed(2)} | P&L: +$${parseFloat(t.realizedPnl).toFixed(2)}`);
    });
  }
  
  // Check worst trades (lowest P&L)
  const worstTrades = await db.execute(sql`SELECT id, symbol, side, entryPrice, realizedPnl FROM paperPositions WHERE status = 'closed' ORDER BY realizedPnl ASC LIMIT 5`);
  console.log('\n=== WORST TRADES (lowest P&L) ===');
  const worst = worstTrades[0] as any[];
  worst.forEach((t: any, i: number) => {
    console.log(`${i+1}. ${t.symbol} ${t.side.toUpperCase()} | Entry: $${parseFloat(t.entryPrice).toFixed(2)} | P&L: -$${Math.abs(parseFloat(t.realizedPnl)).toFixed(2)}`);
  });
  
  // Data integrity check
  console.log('\n========================================');
  console.log('DATA INTEGRITY CHECK');
  console.log('========================================');
  console.log(`Wallet shows ${w.totalTrades} total trades, but actual closed positions: ${c.total}`);
  console.log(`Wallet shows ${w.winningTrades} wins, but actual wins: ${c.wins}`);
  console.log(`Wallet shows ${w.losingTrades} losses, but actual losses: ${c.losses}`);
  
  if (parseInt(w.totalTrades) !== parseInt(c.total)) {
    console.log('\n⚠️ WARNING: Wallet trade count does not match actual positions!');
  }
  if (parseInt(w.winningTrades) !== parseInt(c.wins)) {
    console.log('⚠️ WARNING: Wallet winning trades does not match actual wins!');
  }
  
  process.exit(0);
}

audit().catch(e => { console.error(e); process.exit(1); });
