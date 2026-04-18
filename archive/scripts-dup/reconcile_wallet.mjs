/**
 * Wallet Reconciliation Script
 * 
 * This script:
 * 1. Calculates the correct wallet balance from closed positions
 * 2. Updates the paperWallets table with correct values
 * 3. Clears old trade decision logs
 * 4. Resets the system to a clean state
 */
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(DATABASE_URL);
  const userId = 272657;

  console.log('='.repeat(60));
  console.log('WALLET RECONCILIATION');
  console.log('='.repeat(60));

  // Step 1: Get portfolio funds (initial balance)
  console.log('\n1. Getting initial portfolio funds...');
  const [fundsRows] = await connection.execute(
    `SELECT portfolioFunds FROM tradingModeConfig WHERE userId = ?`,
    [userId]
  );
  const portfolioFunds = parseFloat(fundsRows[0]?.portfolioFunds || '20000');
  console.log(`   Initial Portfolio Funds: $${portfolioFunds}`);

  // Step 2: Calculate realized P&L from closed positions
  console.log('\n2. Calculating realized P&L from closed positions...');
  const [closedSummary] = await connection.execute(
    `SELECT 
       COUNT(*) as total_closed,
       COALESCE(SUM(CAST(realizedPnl AS DECIMAL(20,2))), 0) as total_realized_pnl,
       COALESCE(SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) > 0 THEN 1 ELSE 0 END), 0) as wins,
       COALESCE(SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) < 0 THEN 1 ELSE 0 END), 0) as losses
     FROM paperPositions WHERE userId = ? AND status = 'closed'`,
    [userId]
  );
  
  const totalClosed = parseInt(closedSummary[0]?.total_closed || '0');
  const realizedPnl = parseFloat(closedSummary[0]?.total_realized_pnl || '0');
  const wins = parseInt(closedSummary[0]?.wins || '0');
  const losses = parseInt(closedSummary[0]?.losses || '0');
  
  console.log(`   Total Closed Positions: ${totalClosed}`);
  console.log(`   Total Realized P&L: $${realizedPnl.toFixed(2)}`);
  console.log(`   Wins: ${wins}, Losses: ${losses}`);

  // Step 3: Calculate correct balance
  const correctBalance = portfolioFunds + realizedPnl;
  const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
  
  console.log('\n3. Calculated correct values:');
  console.log(`   Correct Balance: $${correctBalance.toFixed(2)}`);
  console.log(`   Win Rate: ${winRate.toFixed(2)}%`);

  // Step 4: Update paperWallets table
  console.log('\n4. Updating paperWallets table...');
  await connection.execute(
    `UPDATE paperWallets 
     SET balance = ?,
         totalPnl = ?,
         realizedPnL = ?,
         unrealizedPnL = 0,
         totalTrades = ?,
         winningTrades = ?,
         losingTrades = ?,
         winRate = ?,
         updatedAt = NOW()
     WHERE userId = ?`,
    [
      correctBalance.toFixed(2),
      realizedPnl.toFixed(2),
      realizedPnl.toFixed(2),
      totalClosed,
      wins,
      losses,
      winRate.toFixed(2),
      userId
    ]
  );
  console.log('   ✅ paperWallets updated');

  // Step 5: Clear old trade decision logs (keep last 100)
  console.log('\n5. Clearing old trade decision logs...');
  const [logCount] = await connection.execute(
    `SELECT COUNT(*) as count FROM tradeDecisionLogs WHERE userId = ?`,
    [userId]
  );
  const totalLogs = parseInt(logCount[0]?.count || '0');
  
  if (totalLogs > 100) {
    // Get the ID of the 100th most recent log
    const [keepLogs] = await connection.execute(
      `SELECT id FROM tradeDecisionLogs WHERE userId = ? ORDER BY timestamp DESC LIMIT 100`,
      [userId]
    );
    
    if (keepLogs.length > 0) {
      const keepIds = keepLogs.map(r => r.id);
      const minKeepId = Math.min(...keepIds);
      
      await connection.execute(
        `DELETE FROM tradeDecisionLogs WHERE userId = ? AND id < ?`,
        [userId, minKeepId]
      );
      console.log(`   ✅ Deleted ${totalLogs - 100} old trade decision logs`);
    }
  } else {
    console.log(`   ℹ️ Only ${totalLogs} logs exist, no cleanup needed`);
  }

  // Step 6: Verify the fix
  console.log('\n6. Verifying the fix...');
  const [verifyWallet] = await connection.execute(
    `SELECT balance, totalPnl, realizedPnL, totalTrades, winningTrades, losingTrades, winRate
     FROM paperWallets WHERE userId = ?`,
    [userId]
  );
  console.log('   Updated wallet values:');
  console.log(JSON.stringify(verifyWallet[0], null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('RECONCILIATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nBalance corrected from $11,131.84 to $${correctBalance.toFixed(2)}`);

  await connection.end();
}

main().catch(console.error);
