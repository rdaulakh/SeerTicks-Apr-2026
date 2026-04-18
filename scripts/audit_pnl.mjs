/**
 * P&L Audit Script
 * Queries all relevant tables to understand where P&L values come from
 */
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, and, desc, sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(DATABASE_URL);
  const db = drizzle(connection);

  const userId = 272657;

  console.log('='.repeat(60));
  console.log('P&L AUDIT REPORT');
  console.log('='.repeat(60));

  // 1. Paper Wallet
  console.log('\n1. PAPER WALLET (paperWallets table)');
  console.log('-'.repeat(40));
  const [walletRows] = await connection.execute(
    `SELECT balance, totalPnl, realizedPnL, unrealizedPnL, totalTrades, winningTrades, losingTrades 
     FROM paperWallets WHERE userId = ?`,
    [userId]
  );
  console.log(JSON.stringify(walletRows[0], null, 2));

  // 2. Open Positions
  console.log('\n2. OPEN POSITIONS (paperPositions WHERE status=open)');
  console.log('-'.repeat(40));
  const [openRows] = await connection.execute(
    `SELECT COUNT(*) as count, 
            SUM(CAST(unrealizedPnl AS DECIMAL(20,2))) as total_unrealized_pnl
     FROM paperPositions WHERE userId = ? AND status = 'open'`,
    [userId]
  );
  console.log(JSON.stringify(openRows[0], null, 2));

  // 3. Closed Positions Summary
  console.log('\n3. CLOSED POSITIONS SUMMARY (paperPositions WHERE status=closed)');
  console.log('-'.repeat(40));
  const [closedSummary] = await connection.execute(
    `SELECT 
       COUNT(*) as total_closed,
       SUM(CAST(realizedPnl AS DECIMAL(20,2))) as total_realized_pnl,
       SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) > 0 THEN 1 ELSE 0 END) as wins,
       SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) < 0 THEN 1 ELSE 0 END) as losses,
       SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) > 0 THEN CAST(realizedPnl AS DECIMAL(20,2)) ELSE 0 END) as total_profit,
       SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,2)) < 0 THEN CAST(realizedPnl AS DECIMAL(20,2)) ELSE 0 END) as total_loss
     FROM paperPositions WHERE userId = ? AND status = 'closed'`,
    [userId]
  );
  console.log(JSON.stringify(closedSummary[0], null, 2));

  // 4. Individual Closed Positions
  console.log('\n4. INDIVIDUAL CLOSED POSITIONS (last 15)');
  console.log('-'.repeat(40));
  const [closedPositions] = await connection.execute(
    `SELECT id, symbol, side, 
            CAST(quantity AS DECIMAL(20,8)) as quantity,
            CAST(entryPrice AS DECIMAL(20,2)) as entryPrice, 
            CAST(currentPrice AS DECIMAL(20,2)) as exitPrice,
            CAST(realizedPnl AS DECIMAL(20,2)) as realizedPnl, 
            exitReason, exitTime 
     FROM paperPositions 
     WHERE userId = ? AND status = 'closed' 
     ORDER BY exitTime DESC LIMIT 15`,
    [userId]
  );
  closedPositions.forEach((p, i) => {
    console.log(`${i+1}. ${p.symbol} ${p.side}: Entry=$${p.entryPrice}, Exit=$${p.exitPrice}, Qty=${p.quantity}, P&L=$${p.realizedPnl}, Reason=${p.exitReason}`);
  });

  // 5. Portfolio Funds
  console.log('\n5. PORTFOLIO FUNDS (tradingModeConfig table)');
  console.log('-'.repeat(40));
  const [fundsRows] = await connection.execute(
    `SELECT portfolioFunds FROM tradingModeConfig WHERE userId = ?`,
    [userId]
  );
  console.log(JSON.stringify(fundsRows[0], null, 2));

  // 6. Calculate what the balance SHOULD be
  console.log('\n6. CALCULATED VALUES');
  console.log('-'.repeat(40));
  const portfolioFunds = parseFloat(fundsRows[0]?.portfolioFunds || '20000');
  const realizedPnl = parseFloat(closedSummary[0]?.total_realized_pnl || '0');
  const unrealizedPnl = parseFloat(openRows[0]?.total_unrealized_pnl || '0');
  const expectedBalance = portfolioFunds + realizedPnl;
  const expectedEquity = expectedBalance + unrealizedPnl;
  
  console.log(`Portfolio Funds (initial): $${portfolioFunds}`);
  console.log(`Realized P&L (from closed): $${realizedPnl}`);
  console.log(`Unrealized P&L (from open): $${unrealizedPnl}`);
  console.log(`Expected Balance: $${expectedBalance}`);
  console.log(`Expected Equity: $${expectedEquity}`);
  console.log(`Actual Wallet Balance: $${walletRows[0]?.balance || 'N/A'}`);

  // 7. Discrepancy Analysis
  console.log('\n7. DISCREPANCY ANALYSIS');
  console.log('-'.repeat(40));
  const actualBalance = parseFloat(walletRows[0]?.balance || '0');
  const discrepancy = actualBalance - expectedBalance;
  console.log(`Discrepancy: $${discrepancy.toFixed(2)}`);
  if (Math.abs(discrepancy) > 0.01) {
    console.log('⚠️ BALANCE MISMATCH DETECTED!');
    console.log('The wallet balance does not reflect the realized P&L from closed positions.');
  } else {
    console.log('✅ Balance matches expected value.');
  }

  await connection.end();
}

main().catch(console.error);
