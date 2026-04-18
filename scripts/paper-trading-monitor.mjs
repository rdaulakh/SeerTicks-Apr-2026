/**
 * Paper Trading Monitor Script
 * Monitors paper trading activity and generates reports
 * 
 * Usage: node scripts/paper-trading-monitor.mjs [--report]
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const USER_ID = 272657;
const REPORTS_DIR = '/home/ubuntu/seer/reports';

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

async function getConnection() {
  return mysql.createConnection(process.env.DATABASE_URL);
}

async function getPaperWallet(conn) {
  const [rows] = await conn.execute(
    'SELECT * FROM paperWallets WHERE userId = ?',
    [USER_ID]
  );
  return rows[0];
}

async function getOpenPositions(conn) {
  const [rows] = await conn.execute(
    'SELECT * FROM paperPositions WHERE userId = ? AND status = "open" ORDER BY entryTime DESC',
    [USER_ID]
  );
  return rows;
}

async function getClosedPositions(conn, since = null) {
  let query = 'SELECT * FROM paperPositions WHERE userId = ? AND status = "closed"';
  const params = [USER_ID];
  
  if (since) {
    query += ' AND exitTime >= ?';
    params.push(since);
  }
  
  query += ' ORDER BY exitTime DESC';
  
  const [rows] = await conn.execute(query, params);
  return rows;
}

async function getEngineState(conn) {
  const [rows] = await conn.execute(
    'SELECT * FROM engineState WHERE userId = ?',
    [USER_ID]
  );
  return rows[0];
}

async function getSymbols(conn) {
  const [rows] = await conn.execute(
    'SELECT * FROM tradingSymbols WHERE userId = ? AND isActive = 1',
    [USER_ID]
  );
  return rows;
}

async function collectSnapshot() {
  const conn = await getConnection();
  
  try {
    const wallet = await getPaperWallet(conn);
    const openPositions = await getOpenPositions(conn);
    const engineState = await getEngineState(conn);
    const symbols = await getSymbols(conn);
    
    const snapshot = {
      timestamp: new Date().toISOString(),
      wallet: {
        balance: parseFloat(wallet.balance),
        equity: parseFloat(wallet.equity),
        unrealizedPnL: parseFloat(wallet.unrealizedPnL),
        realizedPnL: parseFloat(wallet.realizedPnL),
        totalPnL: parseFloat(wallet.totalPnL),
        totalTrades: wallet.totalTrades,
        winningTrades: wallet.winningTrades,
        losingTrades: wallet.losingTrades,
        winRate: parseFloat(wallet.winRate),
        totalCommission: parseFloat(wallet.totalCommission),
      },
      openPositions: openPositions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: parseFloat(p.quantity),
        entryPrice: parseFloat(p.entryPrice),
        currentPrice: parseFloat(p.currentPrice),
        unrealizedPnL: parseFloat(p.unrealizedPnL),
        entryTime: p.entryTime,
      })),
      engine: {
        isRunning: !!engineState.isRunning,
        config: JSON.parse(engineState.config || '{}'),
        startedAt: engineState.startedAt,
      },
      activeSymbols: symbols.map(s => s.symbol),
    };
    
    return snapshot;
  } finally {
    await conn.end();
  }
}

async function generateReport(startTime, endTime) {
  const conn = await getConnection();
  
  try {
    const wallet = await getPaperWallet(conn);
    const openPositions = await getOpenPositions(conn);
    const closedPositions = await getClosedPositions(conn, startTime);
    const engineState = await getEngineState(conn);
    const symbols = await getSymbols(conn);
    
    // Calculate statistics
    const totalClosedTrades = closedPositions.length;
    const winningTrades = closedPositions.filter(p => parseFloat(p.realizedPnl || 0) > 0).length;
    const losingTrades = closedPositions.filter(p => parseFloat(p.realizedPnl || 0) < 0).length;
    const breakEvenTrades = closedPositions.filter(p => parseFloat(p.realizedPnl || 0) === 0).length;
    
    const totalRealizedPnL = closedPositions.reduce((sum, p) => sum + parseFloat(p.realizedPnl || 0), 0);
    const avgPnLPerTrade = totalClosedTrades > 0 ? totalRealizedPnL / totalClosedTrades : 0;
    const winRate = totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0;
    
    // Group trades by symbol
    const tradesBySymbol = {};
    closedPositions.forEach(p => {
      if (!tradesBySymbol[p.symbol]) {
        tradesBySymbol[p.symbol] = { trades: 0, pnl: 0 };
      }
      tradesBySymbol[p.symbol].trades++;
      tradesBySymbol[p.symbol].pnl += parseFloat(p.realizedPnl || 0);
    });
    
    const report = {
      reportPeriod: {
        start: startTime,
        end: endTime,
        durationHours: Math.round((new Date(endTime) - new Date(startTime)) / (1000 * 60 * 60)),
      },
      summary: {
        startingBalance: parseFloat(wallet.balance) - totalRealizedPnL,
        endingBalance: parseFloat(wallet.balance),
        totalRealizedPnL,
        totalUnrealizedPnL: parseFloat(wallet.unrealizedPnL),
        netPnL: totalRealizedPnL + parseFloat(wallet.unrealizedPnL),
        returnPercent: ((totalRealizedPnL / (parseFloat(wallet.balance) - totalRealizedPnL)) * 100).toFixed(2),
      },
      trades: {
        totalClosed: totalClosedTrades,
        winning: winningTrades,
        losing: losingTrades,
        breakEven: breakEvenTrades,
        winRate: winRate.toFixed(2),
        avgPnLPerTrade: avgPnLPerTrade.toFixed(2),
      },
      bySymbol: tradesBySymbol,
      openPositions: openPositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        quantity: parseFloat(p.quantity),
        entryPrice: parseFloat(p.entryPrice),
        currentPrice: parseFloat(p.currentPrice),
        unrealizedPnL: parseFloat(p.unrealizedPnL),
        holdingTime: Math.round((Date.now() - new Date(p.entryTime).getTime()) / (1000 * 60)),
      })),
      engineStatus: {
        isRunning: !!engineState.isRunning,
        autoTradingEnabled: JSON.parse(engineState.config || '{}').enableAutoTrading,
        startedAt: engineState.startedAt,
      },
      generatedAt: new Date().toISOString(),
    };
    
    return report;
  } finally {
    await conn.end();
  }
}

function formatReportMarkdown(report) {
  let md = `# SEER Paper Trading Report\n\n`;
  md += `**Report Period:** ${report.reportPeriod.start} to ${report.reportPeriod.end}\n`;
  md += `**Duration:** ${report.reportPeriod.durationHours} hours\n`;
  md += `**Generated:** ${report.generatedAt}\n\n`;
  
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Starting Balance | $${report.summary.startingBalance.toFixed(2)} |\n`;
  md += `| Ending Balance | $${report.summary.endingBalance.toFixed(2)} |\n`;
  md += `| Realized P&L | $${report.summary.totalRealizedPnL.toFixed(2)} |\n`;
  md += `| Unrealized P&L | $${report.summary.totalUnrealizedPnL.toFixed(2)} |\n`;
  md += `| Net P&L | $${report.summary.netPnL.toFixed(2)} |\n`;
  md += `| Return % | ${report.summary.returnPercent}% |\n\n`;
  
  md += `## Trade Statistics\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Closed Trades | ${report.trades.totalClosed} |\n`;
  md += `| Winning Trades | ${report.trades.winning} |\n`;
  md += `| Losing Trades | ${report.trades.losing} |\n`;
  md += `| Break-Even Trades | ${report.trades.breakEven} |\n`;
  md += `| Win Rate | ${report.trades.winRate}% |\n`;
  md += `| Avg P&L per Trade | $${report.trades.avgPnLPerTrade} |\n\n`;
  
  if (Object.keys(report.bySymbol).length > 0) {
    md += `## Performance by Symbol\n\n`;
    md += `| Symbol | Trades | P&L |\n`;
    md += `|--------|--------|-----|\n`;
    for (const [symbol, data] of Object.entries(report.bySymbol)) {
      md += `| ${symbol} | ${data.trades} | $${data.pnl.toFixed(2)} |\n`;
    }
    md += `\n`;
  }
  
  if (report.openPositions.length > 0) {
    md += `## Open Positions\n\n`;
    md += `| Symbol | Side | Qty | Entry | Current | P&L | Holding (min) |\n`;
    md += `|--------|------|-----|-------|---------|-----|---------------|\n`;
    for (const pos of report.openPositions) {
      md += `| ${pos.symbol} | ${pos.side} | ${pos.quantity} | $${pos.entryPrice.toFixed(2)} | $${pos.currentPrice.toFixed(2)} | $${pos.unrealizedPnL.toFixed(2)} | ${pos.holdingTime} |\n`;
    }
    md += `\n`;
  }
  
  md += `## Engine Status\n\n`;
  md += `- **Running:** ${report.engineStatus.isRunning ? 'Yes' : 'No'}\n`;
  md += `- **Auto Trading:** ${report.engineStatus.autoTradingEnabled ? 'Enabled' : 'Disabled'}\n`;
  md += `- **Started At:** ${report.engineStatus.startedAt}\n`;
  
  return md;
}

async function saveSnapshot(snapshot) {
  const filename = `snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved: ${filepath}`);
  return filepath;
}

async function saveReport(report) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Save JSON
  const jsonPath = path.join(REPORTS_DIR, `report_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  
  // Save Markdown
  const mdPath = path.join(REPORTS_DIR, `report_${timestamp}.md`);
  fs.writeFileSync(mdPath, formatReportMarkdown(report));
  
  console.log(`Report saved: ${jsonPath}`);
  console.log(`Report saved: ${mdPath}`);
  
  return { jsonPath, mdPath };
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--report')) {
  // Generate full report for the last 12 hours
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  
  console.log('Generating 12-hour paper trading report...');
  const report = await generateReport(startTime, endTime);
  const { mdPath } = await saveReport(report);
  
  // Print report to console
  console.log('\n' + formatReportMarkdown(report));
} else {
  // Collect snapshot
  console.log('Collecting paper trading snapshot...');
  const snapshot = await collectSnapshot();
  await saveSnapshot(snapshot);
  
  console.log('\nCurrent Status:');
  console.log(`  Balance: $${snapshot.wallet.balance.toFixed(2)}`);
  console.log(`  Equity: $${snapshot.wallet.equity.toFixed(2)}`);
  console.log(`  Unrealized P&L: $${snapshot.wallet.unrealizedPnL.toFixed(2)}`);
  console.log(`  Open Positions: ${snapshot.openPositions.length}`);
  console.log(`  Total Trades: ${snapshot.wallet.totalTrades}`);
  console.log(`  Engine Running: ${snapshot.engine.isRunning}`);
  console.log(`  Auto Trading: ${snapshot.engine.config.enableAutoTrading}`);
}
