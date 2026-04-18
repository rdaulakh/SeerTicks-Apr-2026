import mysql from 'mysql2/promise';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const sslParam = url.searchParams.get('ssl');
  let ssl: any = false;
  if (sslParam) {
    try { ssl = JSON.parse(sslParam); } catch { ssl = { rejectUnauthorized: true }; }
  }

  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl
  });

  // Get current prices from Coinbase
  const btcRes = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
  const ethRes = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
  const btcData = await btcRes.json();
  const ethData = await ethRes.json();
  const currentPrices: Record<string, number> = {
    'BTC-USD': parseFloat(btcData.data.amount),
    'ETH-USD': parseFloat(ethData.data.amount)
  };

  console.log('\n========================================');
  console.log('   COMPREHENSIVE POSITION ANALYSIS');
  console.log('========================================\n');
  
  console.log('=== Current Market Prices ===');
  console.log(`BTC-USD: $${currentPrices['BTC-USD'].toLocaleString()}`);
  console.log(`ETH-USD: $${currentPrices['ETH-USD'].toLocaleString()}`);

  // Get table columns first
  const [columns] = await conn.execute(`SHOW COLUMNS FROM paperPositions`);
  const colNames = (columns as any[]).map(c => c.Field);
  console.log('\n=== Position Table Columns ===');
  console.log(colNames.join(', '));

  // Query ALL positions
  const [positions] = await conn.execute(`
    SELECT *
    FROM paperPositions 
    WHERE userId = 272657 
    ORDER BY createdAt DESC
  `);

  const posArr = positions as any[];
  
  console.log(`\n=== Total Positions Found: ${posArr.length} ===\n`);

  // Separate by status
  const openPos = posArr.filter(p => p.status === 'open');
  const closedPos = posArr.filter(p => p.status === 'closed');
  const otherPos = posArr.filter(p => p.status !== 'open' && p.status !== 'closed');

  console.log(`Open: ${openPos.length} | Closed: ${closedPos.length} | Other: ${otherPos.length}`);

  let totalUnrealizedPnl = 0;
  let totalRealizedPnl = 0;

  // ========== OPEN POSITIONS ==========
  console.log('\n========================================');
  console.log('   OPEN POSITIONS');
  console.log('========================================\n');
  
  if (openPos.length === 0) {
    console.log('No open positions\n');
  } else {
    for (const pos of openPos) {
      const entryPrice = parseFloat(pos.entryPrice);
      const quantity = parseFloat(pos.quantity);
      const currentPrice = currentPrices[pos.symbol] || entryPrice;
      
      let pnl = 0;
      if (pos.side === 'long') {
        pnl = (currentPrice - entryPrice) * quantity;
      } else {
        pnl = (entryPrice - currentPrice) * quantity;
      }
      
      const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (pos.side === 'long' ? 1 : -1);
      const positionValue = currentPrice * quantity;
      
      totalUnrealizedPnl += pnl;

      const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
      const date = new Date(pos.createdAt);
      const timeStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });

      console.log(`${pnlEmoji} Position #${pos.id} - ${pos.symbol} ${pos.side.toUpperCase()} [OPEN]`);
      console.log(`   Entry: $${entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)}`);
      console.log(`   Quantity: ${quantity.toFixed(8)} | Value: $${positionValue.toFixed(2)}`);
      console.log(`   Unrealized P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
      console.log(`   Opened: ${timeStr}`);
      console.log(`   Stop Loss: ${pos.stopLoss || 'Not set'} | Take Profit: ${pos.takeProfit || 'Not set'}`);
      console.log('');
    }
  }

  // ========== CLOSED POSITIONS ==========
  console.log('\n========================================');
  console.log('   CLOSED POSITIONS');
  console.log('========================================\n');
  
  if (closedPos.length === 0) {
    console.log('No closed positions\n');
  } else {
    for (const pos of closedPos) {
      const entryPrice = parseFloat(pos.entryPrice);
      const exitPrice = parseFloat(pos.exitPrice || pos.entryPrice);
      const quantity = parseFloat(pos.quantity);
      
      let realizedPnl = 0;
      if (pos.side === 'long') {
        realizedPnl = (exitPrice - entryPrice) * quantity;
      } else {
        realizedPnl = (entryPrice - exitPrice) * quantity;
      }
      
      totalRealizedPnl += realizedPnl;

      const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100 * (pos.side === 'long' ? 1 : -1);
      const pnlEmoji = realizedPnl >= 0 ? '🟢' : '🔴';
      
      const openDate = new Date(pos.createdAt);
      const closeDate = pos.updatedAt ? new Date(pos.updatedAt) : null;
      const openStr = openDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
      const closeStr = closeDate ? closeDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false }) : 'Unknown';

      console.log(`${pnlEmoji} Position #${pos.id} - ${pos.symbol} ${pos.side.toUpperCase()} [CLOSED]`);
      console.log(`   Entry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
      console.log(`   Quantity: ${quantity.toFixed(8)}`);
      console.log(`   Realized P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
      console.log(`   Opened: ${openStr}`);
      console.log(`   Closed: ${closeStr}`);
      console.log(`   Exit Reason: ${pos.exitReason || 'Not recorded'}`);
      console.log('');
    }
  }

  // ========== OTHER STATUS POSITIONS ==========
  if (otherPos.length > 0) {
    console.log('\n========================================');
    console.log('   OTHER STATUS POSITIONS');
    console.log('========================================\n');
    
    for (const pos of otherPos) {
      console.log(`Position #${pos.id} - ${pos.symbol} ${pos.side.toUpperCase()} [${pos.status}]`);
      console.log(`   Entry: $${parseFloat(pos.entryPrice).toFixed(2)}`);
      console.log(`   Quantity: ${parseFloat(pos.quantity).toFixed(8)}`);
      console.log('');
    }
  }

  // ========== CHECK EXIT LOGIC ==========
  console.log('\n========================================');
  console.log('   EXIT STRATEGY ANALYSIS');
  console.log('========================================\n');

  // Check trade decision logs for exit-related decisions
  const [exitLogs] = await conn.execute(`
    SELECT * FROM tradeDecisionLogs 
    WHERE userId = 272657 
    AND (signalType = 'SELL' OR decision LIKE '%EXIT%' OR decisionReason LIKE '%exit%' OR decisionReason LIKE '%close%')
    ORDER BY createdAt DESC
    LIMIT 20
  `);

  const exitLogsArr = exitLogs as any[];
  
  if (exitLogsArr.length === 0) {
    console.log('No exit signals found in trade decision logs.\n');
    console.log('This means:');
    console.log('1. The consensus has remained bullish (no SELL signals generated)');
    console.log('2. Stop-loss/take-profit levels have not been hit');
    console.log('3. No manual exit commands have been issued\n');
  } else {
    console.log(`Found ${exitLogsArr.length} exit-related decisions:\n`);
    for (const log of exitLogsArr) {
      const date = new Date(log.createdAt);
      const timeStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
      console.log(`[${timeStr}] ${log.symbol} - ${log.signalType} - ${log.decision}`);
      console.log(`   Reason: ${log.decisionReason}`);
      console.log('');
    }
  }

  // Check for SELL signals in recent logs
  const [recentLogs] = await conn.execute(`
    SELECT signalType, COUNT(*) as count 
    FROM tradeDecisionLogs 
    WHERE userId = 272657 
    AND createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)
    GROUP BY signalType
  `);

  console.log('=== Signal Distribution (Last Hour) ===');
  for (const log of recentLogs as any[]) {
    console.log(`${log.signalType}: ${log.count} signals`);
  }

  // Get wallet info
  const [wallets] = await conn.execute(`SELECT balance, margin FROM paperWallets WHERE userId = 272657`);
  const wallet = (wallets as any[])[0];
  const balance = parseFloat(wallet?.balance || '0');
  const margin = parseFloat(wallet?.margin || '0');

  console.log('\n========================================');
  console.log('   PORTFOLIO SUMMARY');
  console.log('========================================\n');
  
  console.log(`Open Positions: ${openPos.length}`);
  console.log(`Closed Positions: ${closedPos.length}`);
  console.log('');
  console.log(`Wallet Balance: $${balance.toFixed(2)}`);
  console.log(`Margin Used: $${margin.toFixed(2)}`);
  console.log(`Available Balance: $${(balance - margin).toFixed(2)}`);
  console.log('');
  console.log(`Unrealized P&L: ${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}`);
  console.log(`Realized P&L: ${totalRealizedPnl >= 0 ? '+' : ''}$${totalRealizedPnl.toFixed(2)}`);
  console.log(`Total P&L: ${(totalUnrealizedPnl + totalRealizedPnl) >= 0 ? '+' : ''}$${(totalUnrealizedPnl + totalRealizedPnl).toFixed(2)}`);
  console.log('');
  console.log(`Portfolio Value: $${(balance + totalUnrealizedPnl).toFixed(2)}`);

  await conn.end();
}

main().catch(console.error);
