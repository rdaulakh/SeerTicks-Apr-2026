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

  console.log('\n=== Current Market Prices ===');
  console.log(`BTC-USD: $${currentPrices['BTC-USD'].toLocaleString()}`);
  console.log(`ETH-USD: $${currentPrices['ETH-USD'].toLocaleString()}`);

  // Query all positions
  const [positions] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, quantity, status, createdAt, closedAt, exitPrice, realizedPnl
    FROM paperPositions 
    WHERE userId = 272657 
    ORDER BY createdAt DESC
  `);

  const posArr = positions as any[];
  
  console.log(`\n=== Position Analysis (${posArr.length} total positions) ===\n`);

  let totalUnrealizedPnl = 0;
  let totalRealizedPnl = 0;
  let openPositions = 0;
  let closedPositions = 0;

  // Group by status
  const openPos = posArr.filter(p => p.status === 'open');
  const closedPos = posArr.filter(p => p.status === 'closed');

  console.log('--- OPEN POSITIONS ---\n');
  
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
      openPositions++;

      const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
      const date = new Date(pos.createdAt);
      const timeStr = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });

      console.log(`${pnlEmoji} Position #${pos.id} - ${pos.symbol} ${pos.side.toUpperCase()}`);
      console.log(`   Entry: $${entryPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} | Current: $${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      console.log(`   Quantity: ${quantity.toFixed(8)}`);
      console.log(`   Position Value: $${positionValue.toFixed(2)}`);
      console.log(`   Unrealized P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
      console.log(`   Opened: ${timeStr}`);
      console.log('');
    }
  }

  console.log('--- CLOSED POSITIONS ---\n');
  
  if (closedPos.length === 0) {
    console.log('No closed positions\n');
  } else {
    for (const pos of closedPos) {
      const entryPrice = parseFloat(pos.entryPrice);
      const exitPrice = parseFloat(pos.exitPrice || pos.entryPrice);
      const quantity = parseFloat(pos.quantity);
      const realizedPnl = parseFloat(pos.realizedPnl || '0');
      
      totalRealizedPnl += realizedPnl;
      closedPositions++;

      const pnlEmoji = realizedPnl >= 0 ? '🟢' : '🔴';
      const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100 * (pos.side === 'long' ? 1 : -1);

      console.log(`${pnlEmoji} Position #${pos.id} - ${pos.symbol} ${pos.side.toUpperCase()} [CLOSED]`);
      console.log(`   Entry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
      console.log(`   Quantity: ${quantity.toFixed(8)}`);
      console.log(`   Realized P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
      console.log('');
    }
  }

  // Get wallet info
  const [wallets] = await conn.execute(`SELECT balance, margin FROM paperWallets WHERE userId = 272657`);
  const wallet = (wallets as any[])[0];
  const balance = parseFloat(wallet?.balance || '0');
  const margin = parseFloat(wallet?.margin || '0');

  console.log('=== PORTFOLIO SUMMARY ===\n');
  console.log(`Open Positions: ${openPositions}`);
  console.log(`Closed Positions: ${closedPositions}`);
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
