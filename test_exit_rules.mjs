import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get open positions
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, quantity, 
         unrealizedPnL, unrealizedPnLPercent, createdAt,
         TIMESTAMPDIFF(MINUTE, createdAt, NOW()) as holdMinutes
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
  ORDER BY createdAt DESC
`);

console.log('\n=== OPEN POSITIONS ===');
console.log(`Count: ${positions.length}`);

for (const p of positions) {
  const pnlPct = parseFloat(p.unrealizedPnLPercent || 0);
  console.log(`\n${p.symbol} ${p.side.toUpperCase()}`);
  console.log(`  Entry: $${parseFloat(p.entryPrice).toFixed(2)}`);
  console.log(`  Current: $${parseFloat(p.currentPrice).toFixed(2)}`);
  console.log(`  P&L: ${pnlPct.toFixed(2)}%`);
  console.log(`  Hold Time: ${p.holdMinutes} minutes`);
  
  // Check exit rules
  if (pnlPct <= -1.5 && p.holdMinutes >= 5) {
    console.log(`  ⚠️ SHOULD EXIT: Tight Loss Protection (-1.5% after 5min)`);
  } else if (pnlPct <= -4.5) {
    console.log(`  🚨 SHOULD EXIT: Emergency Loss (-4.5%)`);
  } else {
    console.log(`  ✅ HOLDING: P&L within limits`);
  }
}

// Get wallet status
const [wallets] = await conn.execute(`
  SELECT balance, margin, realizedPnl, totalTrades, winningTrades, losingTrades, winRate
  FROM paperWallets WHERE userId = 272657
`);

if (wallets.length > 0) {
  const w = wallets[0];
  console.log('\n=== WALLET STATUS ===');
  console.log(`Balance: $${parseFloat(w.balance).toFixed(2)}`);
  console.log(`Margin Used: $${parseFloat(w.margin).toFixed(2)}`);
  console.log(`Available: $${(parseFloat(w.balance) - parseFloat(w.margin)).toFixed(2)}`);
  console.log(`Realized P&L: $${parseFloat(w.realizedPnl || 0).toFixed(2)}`);
  console.log(`Win Rate: ${parseFloat(w.winRate || 0).toFixed(1)}% (${w.winningTrades}W / ${w.losingTrades}L)`);
}

// Check recent exits
const [recentExits] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnL, exitReason, exitTime
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'closed'
  ORDER BY exitTime DESC
  LIMIT 5
`);

console.log('\n=== RECENT EXITS ===');
for (const e of recentExits) {
  const pnl = parseFloat(e.unrealizedPnL || 0);
  console.log(`${e.symbol} ${e.side}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Reason: ${e.exitReason || 'N/A'}`);
}

await conn.end();
