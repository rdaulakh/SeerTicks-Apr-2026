/**
 * Wallet Reconciliation Script for Performance Page
 * 
 * This script recalculates and fixes wallet statistics based on actual closed positions.
 * It ensures the Performance page displays accurate data.
 */

import { getDb } from '../server/db';
import { paperWallets, paperPositions } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

async function reconcileWallet() {
  const db = await getDb();
  if (!db) {
    console.log('No DB connection');
    return;
  }

  const userId = 1;
  
  console.log('='.repeat(80));
  console.log('WALLET RECONCILIATION - FIXING PERFORMANCE METRICS');
  console.log('='.repeat(80));
  
  // 1. Get current wallet state
  console.log('\n### CURRENT WALLET STATE ###');
  const [wallet] = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId)).limit(1);
  if (!wallet) {
    console.log('No wallet found for user');
    process.exit(1);
  }
  
  console.log(`Balance:       $${parseFloat(wallet.balance).toFixed(2)}`);
  console.log(`Realized P&L:  $${parseFloat(wallet.realizedPnL || '0').toFixed(2)}`);
  console.log(`Win Rate:      ${parseFloat(wallet.winRate || '0').toFixed(1)}%`);
  console.log(`Total Trades:  ${wallet.totalTrades || 0}`);
  console.log(`Winning:       ${wallet.winningTrades || 0}`);
  console.log(`Losing:        ${wallet.losingTrades || 0}`);
  
  // 2. Calculate correct values from closed positions
  console.log('\n### CALCULATING FROM CLOSED POSITIONS ###');
  const closedPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'closed')))
    .orderBy(desc(paperPositions.exitTime));
  
  let totalRealizedPnL = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;
  let largestWin = 0;
  let largestLoss = 0;
  
  for (const pos of closedPositions) {
    const pnl = parseFloat(pos.realizedPnl || '0');
    totalRealizedPnL += pnl;
    if (pnl > 0) {
      winCount++;
      totalWinAmount += pnl;
      if (pnl > largestWin) largestWin = pnl;
    } else if (pnl < 0) {
      lossCount++;
      totalLossAmount += Math.abs(pnl);
      if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl);
    }
  }
  
  const totalTrades = closedPositions.length;
  const calculatedWinRate = totalTrades > 0 ? (winCount / totalTrades * 100) : 0;
  const avgWin = winCount > 0 ? totalWinAmount / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLossAmount / lossCount : 0;
  const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
  
  console.log(`Closed Positions: ${totalTrades}`);
  console.log(`Total Realized P&L: $${totalRealizedPnL.toFixed(2)}`);
  console.log(`Win Count: ${winCount}`);
  console.log(`Loss Count: ${lossCount}`);
  console.log(`Win Rate: ${calculatedWinRate.toFixed(1)}%`);
  
  // 3. Update wallet with correct values
  console.log('\n### UPDATING WALLET ###');
  
  await db.update(paperWallets)
    .set({
      realizedPnL: totalRealizedPnL.toFixed(8),
      totalPnL: totalRealizedPnL.toFixed(8),
      winRate: calculatedWinRate.toFixed(2),
      totalTrades: totalTrades,
      winningTrades: winCount,
      losingTrades: lossCount,
    })
    .where(eq(paperWallets.userId, userId));
  
  console.log('✅ Wallet updated successfully!');
  
  // 4. Verify update
  console.log('\n### VERIFICATION ###');
  const [updatedWallet] = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId)).limit(1);
  
  console.log(`Balance:       $${parseFloat(updatedWallet.balance).toFixed(2)}`);
  console.log(`Realized P&L:  $${parseFloat(updatedWallet.realizedPnL || '0').toFixed(2)}`);
  console.log(`Win Rate:      ${parseFloat(updatedWallet.winRate || '0').toFixed(1)}%`);
  console.log(`Total Trades:  ${updatedWallet.totalTrades || 0}`);
  console.log(`Winning:       ${updatedWallet.winningTrades || 0}`);
  console.log(`Losing:        ${updatedWallet.losingTrades || 0}`);
  
  // 5. Summary
  console.log('\n' + '='.repeat(80));
  console.log('RECONCILIATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`
Changes Applied:
- Realized P&L: $${parseFloat(wallet.realizedPnL || '0').toFixed(2)} → $${totalRealizedPnL.toFixed(2)}
- Win Rate: ${parseFloat(wallet.winRate || '0').toFixed(1)}% → ${calculatedWinRate.toFixed(1)}%
- Total Trades: ${wallet.totalTrades || 0} → ${totalTrades}
- Winning Trades: ${wallet.winningTrades || 0} → ${winCount}
- Losing Trades: ${wallet.losingTrades || 0} → ${lossCount}
`);
  
  process.exit(0);
}

reconcileWallet().catch(console.error);
