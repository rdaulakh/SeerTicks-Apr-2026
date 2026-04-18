import { getDb } from '../server/db';
import { paperWallets, paperPositions, tradeDecisionLogs } from '../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

async function auditPerformance() {
  const db = await getDb();
  if (!db) {
    console.log('No DB connection');
    return;
  }

  const userId = 1;
  
  console.log('='.repeat(80));
  console.log('PERFORMANCE PAGE AUDIT - DATABASE VERIFICATION');
  console.log('='.repeat(80));
  
  // 1. WALLET DATA
  console.log('\n### 1. WALLET DATA (from paperWallets table) ###');
  const [wallet] = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId)).limit(1);
  if (wallet) {
    console.log(`Balance:       $${parseFloat(wallet.balance).toFixed(2)}`);
    console.log(`Equity:        $${parseFloat(wallet.equity || wallet.balance).toFixed(2)}`);
    console.log(`Margin:        $${parseFloat(wallet.margin).toFixed(2)}`);
    console.log(`Realized P&L:  $${parseFloat(wallet.realizedPnL || '0').toFixed(2)}`);
    console.log(`Total P&L:     $${parseFloat(wallet.totalPnL || '0').toFixed(2)}`);
    console.log(`Win Rate:      ${parseFloat(wallet.winRate || '0').toFixed(1)}%`);
    console.log(`Total Trades:  ${wallet.totalTrades || 0}`);
    console.log(`Winning:       ${wallet.winningTrades || 0}`);
    console.log(`Losing:        ${wallet.losingTrades || 0}`);
  }
  
  // 2. OPEN POSITIONS
  console.log('\n### 2. OPEN POSITIONS ###');
  const openPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')))
    .orderBy(desc(paperPositions.entryTime));
  console.log(`Open Position Count: ${openPositions.length}`);
  let totalUnrealizedPnL = 0;
  for (const pos of openPositions) {
    const unrealized = parseFloat(pos.unrealizedPnl || '0');
    totalUnrealizedPnL += unrealized;
    console.log(`  - ${pos.symbol}: Entry $${parseFloat(pos.entryPrice).toFixed(2)}, Qty ${parseFloat(pos.quantity).toFixed(4)}, Unrealized: $${unrealized.toFixed(2)}`);
  }
  console.log(`Total Unrealized P&L: $${totalUnrealizedPnL.toFixed(2)}`);
  
  // 3. ALL CLOSED POSITIONS
  console.log('\n### 3. ALL CLOSED POSITIONS ###');
  const closedPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'closed')))
    .orderBy(desc(paperPositions.exitTime));
  console.log(`Total Closed Position Count: ${closedPositions.length}`);
  
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
  
  const calculatedWinRate = closedPositions.length > 0 ? (winCount / closedPositions.length * 100) : 0;
  const avgWin = winCount > 0 ? totalWinAmount / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLossAmount / lossCount : 0;
  const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
  
  console.log(`\n### CALCULATED METRICS FROM CLOSED POSITIONS ###`);
  console.log(`Total Realized P&L:  $${totalRealizedPnL.toFixed(2)}`);
  console.log(`Win Count:           ${winCount}`);
  console.log(`Loss Count:          ${lossCount}`);
  console.log(`Win Rate:            ${calculatedWinRate.toFixed(1)}%`);
  console.log(`Avg Win:             $${avgWin.toFixed(2)}`);
  console.log(`Avg Loss:            $${avgLoss.toFixed(2)}`);
  console.log(`Largest Win:         $${largestWin.toFixed(2)}`);
  console.log(`Largest Loss:        $${largestLoss.toFixed(2)}`);
  console.log(`Profit Factor:       ${profitFactor.toFixed(2)}`);
  
  // 4. TRADE DECISION LOGS
  console.log('\n### 4. TRADE DECISION LOGS (Last 50) ###');
  const decisions = await db.select().from(tradeDecisionLogs)
    .where(eq(tradeDecisionLogs.userId, userId))
    .orderBy(desc(tradeDecisionLogs.timestamp))
    .limit(50);
  
  let executed = 0;
  let skipped = 0;
  let missed = 0;
  for (const d of decisions) {
    if (d.decision === 'EXECUTED') executed++;
    else if (d.decision === 'SKIPPED') skipped++;
    else if (d.decision === 'MISSED') missed++;
  }
  console.log(`Total Decisions:     ${decisions.length}`);
  console.log(`Executed:            ${executed}`);
  console.log(`Skipped:             ${skipped}`);
  console.log(`Missed:              ${missed}`);
  
  // 5. BEST/WORST TRADES
  console.log('\n### 5. TOP 5 BEST TRADES ###');
  const bestTrades = [...closedPositions].sort((a, b) => 
    parseFloat(b.realizedPnl || '0') - parseFloat(a.realizedPnl || '0')
  ).slice(0, 5);
  for (const t of bestTrades) {
    const exitDate = t.exitTime ? new Date(t.exitTime).toLocaleDateString() : 'N/A';
    console.log(`  ${t.symbol}: $${parseFloat(t.realizedPnl || '0').toFixed(2)} on ${exitDate}`);
  }
  
  console.log('\n### 6. TOP 5 WORST TRADES ###');
  const worstTrades = [...closedPositions].sort((a, b) => 
    parseFloat(a.realizedPnl || '0') - parseFloat(b.realizedPnl || '0')
  ).slice(0, 5);
  for (const t of worstTrades) {
    const exitDate = t.exitTime ? new Date(t.exitTime).toLocaleDateString() : 'N/A';
    console.log(`  ${t.symbol}: $${parseFloat(t.realizedPnl || '0').toFixed(2)} on ${exitDate}`);
  }
  
  // 7. EXPECTED VS ACTUAL COMPARISON
  console.log('\n' + '='.repeat(80));
  console.log('EXPECTED VS ACTUAL COMPARISON');
  console.log('='.repeat(80));
  
  const walletRealizedPnL = parseFloat(wallet?.realizedPnL || '0');
  const walletWinRate = parseFloat(wallet?.winRate || '0');
  const walletTotalTrades = wallet?.totalTrades || 0;
  const walletWins = wallet?.winningTrades || 0;
  const walletLosses = wallet?.losingTrades || 0;
  
  console.log('\n| Metric              | Wallet Value       | Calculated Value   | Match? |');
  console.log('|---------------------|--------------------|--------------------|--------|');
  
  const matchRealizedPnL = Math.abs(walletRealizedPnL - totalRealizedPnL) < 1 ? '✅' : '❌';
  const matchWinRate = Math.abs(walletWinRate - calculatedWinRate) < 1 ? '✅' : '❌';
  const matchTotalTrades = walletTotalTrades === closedPositions.length ? '✅' : '❌';
  const matchWins = walletWins === winCount ? '✅' : '❌';
  const matchLosses = walletLosses === lossCount ? '✅' : '❌';
  
  console.log(`| Realized P&L        | $${walletRealizedPnL.toFixed(2).padEnd(16)} | $${totalRealizedPnL.toFixed(2).padEnd(16)} | ${matchRealizedPnL}     |`);
  console.log(`| Win Rate            | ${walletWinRate.toFixed(1).padEnd(17)}% | ${calculatedWinRate.toFixed(1).padEnd(17)}% | ${matchWinRate}     |`);
  console.log(`| Total Trades        | ${String(walletTotalTrades).padEnd(18)} | ${String(closedPositions.length).padEnd(18)} | ${matchTotalTrades}     |`);
  console.log(`| Winning Trades      | ${String(walletWins).padEnd(18)} | ${String(winCount).padEnd(18)} | ${matchWins}     |`);
  console.log(`| Losing Trades       | ${String(walletLosses).padEnd(18)} | ${String(lossCount).padEnd(18)} | ${matchLosses}     |`);
  
  // 8. ISSUES FOUND
  console.log('\n' + '='.repeat(80));
  console.log('ISSUES FOUND');
  console.log('='.repeat(80));
  
  const issues: string[] = [];
  
  if (matchRealizedPnL === '❌') {
    issues.push(`ISSUE: Realized P&L mismatch - Wallet shows $${walletRealizedPnL.toFixed(2)} but calculated from positions is $${totalRealizedPnL.toFixed(2)}`);
  }
  if (matchWinRate === '❌') {
    issues.push(`ISSUE: Win Rate mismatch - Wallet shows ${walletWinRate.toFixed(1)}% but calculated is ${calculatedWinRate.toFixed(1)}%`);
  }
  if (matchTotalTrades === '❌') {
    issues.push(`ISSUE: Total Trades mismatch - Wallet shows ${walletTotalTrades} but actual closed positions is ${closedPositions.length}`);
  }
  if (matchWins === '❌') {
    issues.push(`ISSUE: Winning Trades mismatch - Wallet shows ${walletWins} but calculated is ${winCount}`);
  }
  if (matchLosses === '❌') {
    issues.push(`ISSUE: Losing Trades mismatch - Wallet shows ${walletLosses} but calculated is ${lossCount}`);
  }
  
  if (issues.length === 0) {
    console.log('\n✅ All metrics match! No issues found.');
  } else {
    for (const issue of issues) {
      console.log(`\n❌ ${issue}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(80));
  
  process.exit(0);
}

auditPerformance().catch(console.error);
