import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
const connection = await mysql.createConnection(DATABASE_URL);

console.log('=== CTO AUDIT: CONSENSUS EXIT STRATEGY ===\n');

// Get open positions with full details
const [openPositions] = await connection.execute(
  `SELECT id, symbol, side, entryPrice, currentPrice, quantity, 
          unrealizedPnL, unrealizedPnLPercent, createdAt, stopLoss, takeProfit
   FROM paperPositions 
   WHERE userId = 272657 AND status = 'open'
   ORDER BY id DESC`
);

console.log(`Open Positions: ${openPositions.length}\n`);

for (const pos of openPositions) {
  const entry = parseFloat(pos.entryPrice);
  const current = parseFloat(pos.currentPrice);
  const pnl = parseFloat(pos.unrealizedPnL || '0');
  const pnlPct = parseFloat(pos.unrealizedPnLPercent || '0');
  const holdTime = (Date.now() - new Date(pos.createdAt).getTime()) / (1000 * 60 * 60);
  
  console.log(`Position ${pos.id}: ${pos.symbol} ${pos.side}`);
  console.log(`  Entry: $${entry.toFixed(2)}`);
  console.log(`  Current: $${current.toFixed(2)}`);
  console.log(`  P&L: ${pnlPct.toFixed(2)}% ($${pnl.toFixed(2)})`);
  console.log(`  Hold Time: ${holdTime.toFixed(2)} hours`);
  console.log(`  Stop Loss: ${pos.stopLoss || 'NOT SET'}`);
  console.log(`  Take Profit: ${pos.takeProfit || 'NOT SET'}`);
  
  // Check if position should have exited based on rules
  if (pnlPct <= -4.5) {
    console.log(`  ⚠️ SHOULD EXIT: Emergency loss rule (-4.5%)`);
  }
  if (holdTime >= 4.5) {
    console.log(`  ⚠️ SHOULD EXIT: Capital rotation rule (4.5h)`);
  }
  console.log('');
}

// Get recent trade decision logs to check consensus tracking
console.log('=== RECENT CONSENSUS DECISIONS ===\n');
const [decisions] = await connection.execute(
  `SELECT symbol, signalType, totalConfidence, threshold, decision, decisionReason, timestamp
   FROM tradeDecisionLogs 
   WHERE userId = 272657 
   ORDER BY timestamp DESC
   LIMIT 10`
);

for (const d of decisions) {
  const conf = parseFloat(d.totalConfidence || '0');
  const thresh = parseFloat(d.threshold || '0');
  console.log(`[${d.timestamp}] ${d.symbol}`);
  console.log(`  Signal: ${d.signalType} | Confidence: ${conf.toFixed(1)}% | Threshold: ${thresh.toFixed(1)}%`);
  console.log(`  Decision: ${d.decision}`);
  if (d.decisionReason) console.log(`  Reason: ${d.decisionReason}`);
  console.log('');
}

// Check wallet status
console.log('=== WALLET STATUS ===');
const [wallets] = await connection.execute(
  `SELECT * FROM paperWallets WHERE userId = 272657`
);

if (wallets.length > 0) {
  const w = wallets[0];
  console.log(`Balance: $${parseFloat(w.balance).toFixed(2)}`);
  console.log(`Margin: $${parseFloat(w.margin).toFixed(2)}`);
  console.log(`Available: $${(parseFloat(w.balance) - parseFloat(w.margin)).toFixed(2)}`);
  console.log(`Realized P&L: $${parseFloat(w.realizedPnl || '0').toFixed(2)}`);
  console.log(`Win Rate: ${parseFloat(w.winRate || '0').toFixed(1)}% (${w.winningTrades}W / ${w.losingTrades}L)`);
}

await connection.end();
