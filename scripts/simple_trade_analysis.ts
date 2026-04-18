import { drizzle } from 'drizzle-orm/mysql2';
import { desc, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import * as fs from 'fs';

const db = drizzle(process.env.DATABASE_URL!);

async function analyze() {
  const positions = await db.select().from(schema.paperPositions).where(eq(schema.paperPositions.status, 'closed')).orderBy(desc(schema.paperPositions.id));
  
  const output: string[] = [];
  output.push('='.repeat(80));
  output.push('DEEP TRADE ANALYSIS - All Closed Positions');
  output.push('='.repeat(80));
  output.push(`Total Positions: ${positions.length}`);
  output.push('');
  
  const winners = positions.filter(p => parseFloat(p.realizedPnl || '0') >= 0);
  const losers = positions.filter(p => parseFloat(p.realizedPnl || '0') < 0);
  
  output.push(`Winners: ${winners.length}`);
  output.push(`Losers: ${losers.length}`);
  output.push(`Win Rate: ${((winners.length / positions.length) * 100).toFixed(1)}%`);
  output.push('');
  
  output.push('='.repeat(80));
  output.push('WINNING TRADES');
  output.push('='.repeat(80));
  
  for (const p of winners) {
    const entryPrice = parseFloat(p.entryPrice || '0');
    const exitPrice = parseFloat(p.currentPrice || '0');
    const pnl = parseFloat(p.realizedPnl || '0');
    const qty = parseFloat(p.quantity || '0');
    const openTime = p.createdAt;
    const closeTime = p.updatedAt;
    const holdMs = closeTime && openTime ? closeTime.getTime() - openTime.getTime() : 0;
    
    output.push(`ID: ${p.id} | ${p.symbol} | ${p.side}`);
    output.push(`  Entry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
    output.push(`  Qty: ${qty.toFixed(4)} | P&L: $${pnl.toFixed(2)}`);
    output.push(`  Hold Time: ${(holdMs/1000).toFixed(1)}s (${holdMs}ms)`);
    output.push(`  Exit Reason: ${p.exitReason || 'N/A'}`);
    output.push(`  Entry Consensus: ${p.entryConsensus || 'N/A'}`);
    output.push('');
  }
  
  output.push('='.repeat(80));
  output.push('LOSING TRADES');
  output.push('='.repeat(80));
  
  for (const p of losers) {
    const entryPrice = parseFloat(p.entryPrice || '0');
    const exitPrice = parseFloat(p.currentPrice || '0');
    const pnl = parseFloat(p.realizedPnl || '0');
    const qty = parseFloat(p.quantity || '0');
    const openTime = p.createdAt;
    const closeTime = p.updatedAt;
    const holdMs = closeTime && openTime ? closeTime.getTime() - openTime.getTime() : 0;
    
    output.push(`ID: ${p.id} | ${p.symbol} | ${p.side}`);
    output.push(`  Entry: $${entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
    output.push(`  Qty: ${qty.toFixed(4)} | P&L: $${pnl.toFixed(2)}`);
    output.push(`  Hold Time: ${(holdMs/1000).toFixed(1)}s (${holdMs}ms)`);
    output.push(`  Exit Reason: ${p.exitReason || 'N/A'}`);
    output.push(`  Entry Consensus: ${p.entryConsensus || 'N/A'}`);
    output.push('');
  }
  
  // Exit Reason Analysis
  output.push('='.repeat(80));
  output.push('EXIT REASON ANALYSIS');
  output.push('='.repeat(80));
  
  const exitReasons: Record<string, {wins: number, losses: number, totalPnl: number}> = {};
  for (const p of positions) {
    const reason = p.exitReason || 'UNKNOWN';
    if (!exitReasons[reason]) exitReasons[reason] = {wins: 0, losses: 0, totalPnl: 0};
    const pnl = parseFloat(p.realizedPnl || '0');
    if (pnl >= 0) exitReasons[reason].wins++;
    else exitReasons[reason].losses++;
    exitReasons[reason].totalPnl += pnl;
  }
  
  for (const [reason, stats] of Object.entries(exitReasons)) {
    const total = stats.wins + stats.losses;
    output.push(`${reason}:`);
    output.push(`  Total: ${total} | Wins: ${stats.wins} | Losses: ${stats.losses}`);
    output.push(`  Win Rate: ${((stats.wins/total)*100).toFixed(1)}%`);
    output.push(`  Total P&L: $${stats.totalPnl.toFixed(2)}`);
    output.push('');
  }
  
  // Hold Time Analysis
  output.push('='.repeat(80));
  output.push('HOLD TIME ANALYSIS');
  output.push('='.repeat(80));
  
  const winHoldTimes = winners.map(p => {
    const openTime = p.createdAt;
    const closeTime = p.updatedAt;
    return closeTime && openTime ? closeTime.getTime() - openTime.getTime() : 0;
  });
  const lossHoldTimes = losers.map(p => {
    const openTime = p.createdAt;
    const closeTime = p.updatedAt;
    return closeTime && openTime ? closeTime.getTime() - openTime.getTime() : 0;
  });
  
  const avgWinHold = winHoldTimes.length > 0 ? winHoldTimes.reduce((a,b) => a+b, 0) / winHoldTimes.length : 0;
  const avgLossHold = lossHoldTimes.length > 0 ? lossHoldTimes.reduce((a,b) => a+b, 0) / lossHoldTimes.length : 0;
  
  output.push(`Average Win Hold Time: ${(avgWinHold/1000).toFixed(1)}s`);
  output.push(`Average Loss Hold Time: ${(avgLossHold/1000).toFixed(1)}s`);
  output.push('');
  
  // Write to file
  fs.writeFileSync('/tmp/trade_analysis.txt', output.join('\n'));
  console.log('Analysis written to /tmp/trade_analysis.txt');
}

analyze().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
