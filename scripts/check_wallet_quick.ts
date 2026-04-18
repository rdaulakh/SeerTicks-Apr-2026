import mysql from 'mysql2/promise';

async function check() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // Check wallet
  const [wallets] = await conn.execute('SELECT id, userId, balance, margin, realizedPnL FROM paperWallets WHERE userId = 1');
  console.log('Wallet:', JSON.stringify((wallets as any[])[0], null, 2));
  
  // Check open positions
  const [positions] = await conn.execute('SELECT id, symbol, side, entryPrice, quantity, status FROM paperPositions WHERE userId = 1 AND status = "open"');
  console.log('Open Positions:', JSON.stringify(positions, null, 2));
  
  // Check recent trade decision logs
  const [logs] = await conn.execute('SELECT id, symbol, decision, decisionReason, timestamp FROM tradeDecisionLogs ORDER BY timestamp DESC LIMIT 10');
  console.log('Recent Trade Decisions:', JSON.stringify(logs, null, 2));
  
  await conn.end();
}

check().catch(console.error);
