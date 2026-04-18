import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
const connection = await mysql.createConnection(DATABASE_URL);

console.log('=== TRADE DECISION LOGS AUDIT ===\n');

// Get recent trade decision logs
const [decisionLogs] = await connection.execute(
  `SELECT * FROM tradeDecisionLogs 
   WHERE userId = 272657 
   ORDER BY timestamp DESC
   LIMIT 20`
);

console.log(`Total recent decisions: ${decisionLogs.length}\n`);

// Categorize by status
const byStatus = {};
for (const log of decisionLogs) {
  const status = log.status || 'UNKNOWN';
  if (!byStatus[status]) byStatus[status] = [];
  byStatus[status].push(log);
}

console.log('=== BY STATUS ===');
for (const [status, logs] of Object.entries(byStatus)) {
  console.log(`${status}: ${logs.length} decisions`);
}

console.log('\n=== RECENT DECISIONS (Last 10) ===');
for (const log of decisionLogs.slice(0, 10)) {
  const time = new Date(log.timestamp).toISOString();
  console.log(`\n[${time}] ${log.symbol}`);
  console.log(`  Action: ${log.action} | Status: ${log.status}`);
  console.log(`  Consensus: ${log.consensusScore}% | Confidence: ${log.confidence}%`);
  console.log(`  Price: $${log.price}`);
  if (log.reason) console.log(`  Reason: ${log.reason}`);
  if (log.executionDetails) {
    try {
      const details = JSON.parse(log.executionDetails);
      if (details.positionId) console.log(`  Position ID: ${details.positionId}`);
      if (details.quantity) console.log(`  Quantity: ${details.quantity}`);
    } catch (e) {}
  }
}

// Check open positions
console.log('\n\n=== CURRENT OPEN POSITIONS ===');
const [openPositions] = await connection.execute(
  `SELECT id, symbol, side, entryPrice, currentPrice, quantity, unrealizedPnL, createdAt 
   FROM paperPositions 
   WHERE userId = 272657 AND status = 'open'
   ORDER BY id DESC`
);

console.log(`Total open positions: ${openPositions.length}\n`);
for (const pos of openPositions) {
  const entry = parseFloat(pos.entryPrice);
  const current = parseFloat(pos.currentPrice);
  const pnl = parseFloat(pos.unrealizedPnL || '0');
  const pnlPct = ((current - entry) / entry * 100).toFixed(2);
  console.log(`ID: ${pos.id} | ${pos.symbol} ${pos.side}`);
  console.log(`  Entry: $${entry.toFixed(2)} | Current: $${current.toFixed(2)}`);
  console.log(`  P&L: ${pnlPct}% ($${pnl.toFixed(2)})`);
  console.log(`  Qty: ${parseFloat(pos.quantity).toFixed(6)}`);
  console.log(`  Opened: ${pos.createdAt}`);
  console.log('');
}

// Check wallet status
console.log('=== WALLET STATUS ===');
const [wallets] = await connection.execute(
  `SELECT * FROM paperWallets WHERE userId = 272657`
);

if (wallets.length > 0) {
  const w = wallets[0];
  const balance = parseFloat(w.balance);
  const margin = parseFloat(w.margin);
  const available = balance - margin;
  const realizedPnl = parseFloat(w.realizedPnl || '0');
  
  console.log(`Balance: $${balance.toFixed(2)}`);
  console.log(`Margin Used: $${margin.toFixed(2)}`);
  console.log(`Available: $${available.toFixed(2)}`);
  console.log(`Realized P&L: $${realizedPnl.toFixed(2)}`);
  console.log(`Win Rate: ${parseFloat(w.winRate || '0').toFixed(1)}%`);
  console.log(`Trades: ${w.winningTrades}W / ${w.losingTrades}L`);
}

// Check recent closed positions
console.log('\n=== RECENT CLOSED POSITIONS ===');
const [closedPositions] = await connection.execute(
  `SELECT id, symbol, side, entryPrice, currentPrice, realizedPnl, exitReason, exitTime 
   FROM paperPositions 
   WHERE userId = 272657 AND status = 'closed'
   ORDER BY exitTime DESC
   LIMIT 5`
);

for (const pos of closedPositions) {
  const pnl = parseFloat(pos.realizedPnl || '0');
  const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
  console.log(`ID: ${pos.id} | ${pos.symbol} | P&L: ${pnlStr} | Reason: ${pos.exitReason || 'N/A'}`);
}

await connection.end();
