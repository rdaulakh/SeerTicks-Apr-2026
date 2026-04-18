/**
 * Phase 40: Analyze agent signal accuracy vs actual price movement
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // First get column names
  const cols = await db.execute(sql`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'agentSignalLog' ORDER BY ORDINAL_POSITION`);
  console.log('agentSignalLog columns:', (cols as any)[0]?.map((r: any) => r.COLUMN_NAME));
  
  // Get recent agent signals - use signalDirection instead of direction
  const recentSignals = await db.execute(sql`
    SELECT agentName, symbol, agentSignalLog.signal, confidence, timestamp
    FROM agentSignalLog 
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY timestamp DESC
    LIMIT 200
  `);
  
  console.log('\n=== RECENT AGENT SIGNALS (last 30 min) ===');
  const signalsByAgent: Record<string, { bullish: number, bearish: number, neutral: number, totalConf: number, count: number }> = {};
  
  for (const sig of (recentSignals as any)[0] || []) {
    const agent = sig.agentName || 'unknown';
    if (!signalsByAgent[agent]) signalsByAgent[agent] = { bullish: 0, bearish: 0, neutral: 0, totalConf: 0, count: 0 };
    
    const dir = (sig.signal || '').toLowerCase();
    if (dir.includes('bull') || dir === 'long') signalsByAgent[agent].bullish++;
    else if (dir.includes('bear') || dir === 'short') signalsByAgent[agent].bearish++;
    else signalsByAgent[agent].neutral++;
    
    signalsByAgent[agent].totalConf += parseFloat(sig.confidence || '0');
    signalsByAgent[agent].count++;
  }
  
  for (const [agent, stats] of Object.entries(signalsByAgent).sort((a, b) => b[1].count - a[1].count)) {
    const avgConf = stats.count > 0 ? stats.totalConf / stats.count : 0;
    const bias = stats.bullish > stats.bearish ? 'BULLISH' : stats.bearish > stats.bullish ? 'BEARISH' : 'NEUTRAL';
    console.log(`${agent.padEnd(25)} B=${stats.bullish} Be=${stats.bearish} N=${stats.neutral} AvgConf=${(avgConf * 100).toFixed(1)}% Bias=${bias}`);
  }
  
  // Get consensus log for direction analysis
  console.log('\n=== CONSENSUS DIRECTION (last 30 min) ===');
  const consensusEntries = await db.execute(sql`
    SELECT symbol, consensusDirection, consensusConfidence, timestamp
    FROM consensusLog
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    ORDER BY timestamp DESC
    LIMIT 50
  `);
  
  const dirCounts: Record<string, { bullish: number, bearish: number }> = {};
  for (const entry of (consensusEntries as any)[0] || []) {
    const sym = entry.symbol || 'unknown';
    if (!dirCounts[sym]) dirCounts[sym] = { bullish: 0, bearish: 0 };
    const dir = (entry.consensusDirection || '').toLowerCase();
    if (dir.includes('bull')) dirCounts[sym].bullish++;
    else if (dir.includes('bear')) dirCounts[sym].bearish++;
  }
  
  for (const [sym, counts] of Object.entries(dirCounts)) {
    const total = counts.bullish + counts.bearish;
    const bullPct = total > 0 ? (counts.bullish / total * 100) : 0;
    console.log(`${sym}: ${counts.bullish} bullish / ${counts.bearish} bearish (${bullPct.toFixed(0)}% bullish bias)`);
  }
  
  // Check closed positions - were agents right or wrong?
  console.log('\n=== TRADE ACCURACY (last 2 hours, excluding cleanup) ===');
  const closedTrades = await db.execute(sql`
    SELECT 
      symbol, side, 
      CAST(entryPrice AS DECIMAL(30,10)) as ep,
      CAST(exitPrice AS DECIMAL(30,10)) as xp,
      CAST(realizedPnL AS DECIMAL(30,10)) as pnl,
      exitReason,
      TIMESTAMPDIFF(SECOND, entryTime, exitTime) as holdSec,
      entryTime, exitTime
    FROM paperPositions
    WHERE status = 'closed'
    AND exitTime >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
    AND exitReason NOT LIKE '%cleanup%'
    ORDER BY exitTime DESC
  `);
  
  let wins = 0, losses = 0, totalPnl = 0;
  for (const trade of (closedTrades as any)[0] || []) {
    const pnl = parseFloat(trade.pnl || '0');
    totalPnl += pnl;
    if (pnl >= 0) wins++; else losses++;
    const ep = parseFloat(trade.ep || '0');
    const xp = parseFloat(trade.xp || '0');
    const pctMove = ep > 0 ? ((xp - ep) / ep * 100) : 0;
    const icon = pnl >= 0 ? '✅' : '❌';
    console.log(`${icon} ${trade.symbol} ${trade.side} | $${ep.toFixed(2)} → $${xp.toFixed(2)} (${pctMove >= 0 ? '+' : ''}${pctMove.toFixed(3)}%) | PnL: $${pnl.toFixed(4)} | Hold: ${trade.holdSec}s | ${trade.exitReason}`);
  }
  
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses) * 100) : 0;
  console.log(`\nSummary: ${wins}W/${losses}L (${winRate.toFixed(1)}% win rate) | Total PnL: $${totalPnl.toFixed(4)}`);
  
  // Check current open positions
  console.log('\n=== CURRENT OPEN POSITIONS ===');
  const openPos = await db.execute(sql`
    SELECT symbol, side, 
      CAST(entryPrice AS DECIMAL(30,10)) as ep,
      CAST(currentPrice AS DECIMAL(30,10)) as cp,
      CAST(unrealizedPnL AS DECIMAL(30,10)) as upnl,
      entryTime, updatedAt
    FROM paperPositions
    WHERE status = 'open'
    ORDER BY entryTime DESC
  `);
  
  for (const pos of (openPos as any)[0] || []) {
    const ep = parseFloat(pos.ep || '0');
    const cp = parseFloat(pos.cp || '0');
    const upnl = parseFloat(pos.upnl || '0');
    const age = Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 1000);
    const lastUpdate = Math.round((Date.now() - new Date(pos.updatedAt).getTime()) / 1000);
    console.log(`${pos.symbol} ${pos.side} | Entry: $${ep.toFixed(2)} | Current: $${cp.toFixed(2)} | uPnL: $${upnl.toFixed(4)} | Age: ${age}s | LastUpdate: ${lastUpdate}s ago`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
