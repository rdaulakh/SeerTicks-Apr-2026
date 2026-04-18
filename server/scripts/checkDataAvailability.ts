import { getDb } from '../db';
import { historicalCandles, candleData, agentSignals, trades } from '../../drizzle/schema';
import { sql, count, desc, and, gte, lte } from 'drizzle-orm';

async function checkData() {
  const db = await getDb();
  if (!db) {
    console.log('No database connection');
    return;
  }
  
  console.log('\n========================================');
  console.log('SEER PLATFORM DATA AVAILABILITY CHECK');
  console.log('========================================\n');
  
  // Check historicalCandles
  console.log('=== Historical Candles ===');
  try {
    const hcStats = await db.select({
      symbol: historicalCandles.symbol,
      interval: historicalCandles.interval,
      count: count(),
      earliest: sql<string>`MIN(timestamp)`,
      latest: sql<string>`MAX(timestamp)`,
    }).from(historicalCandles)
      .groupBy(historicalCandles.symbol, historicalCandles.interval);
    
    if (hcStats.length === 0) {
      console.log('No historical candles found');
    } else {
      for (const stat of hcStats) {
        console.log(`${stat.symbol} ${stat.interval}: ${stat.count} candles (${stat.earliest} to ${stat.latest})`);
      }
    }
  } catch (e: any) {
    console.log('Error checking historicalCandles:', e.message);
  }
  
  // Check candleData
  console.log('\n=== Candle Data ===');
  try {
    const cdStats = await db.select({
      symbol: candleData.symbol,
      interval: candleData.interval,
      count: count(),
      earliest: sql<string>`MIN(timestamp)`,
      latest: sql<string>`MAX(timestamp)`,
    }).from(candleData)
      .groupBy(candleData.symbol, candleData.interval);
    
    if (cdStats.length === 0) {
      console.log('No candle data found');
    } else {
      for (const stat of cdStats) {
        console.log(`${stat.symbol} ${stat.interval}: ${stat.count} candles (${stat.earliest} to ${stat.latest})`);
      }
    }
  } catch (e: any) {
    console.log('Error checking candleData:', e.message);
  }
  
  // Check agent signals
  console.log('\n=== Agent Signals ===');
  try {
    const signalStats = await db.select({
      agentName: agentSignals.agentName,
      count: count(),
    }).from(agentSignals)
      .groupBy(agentSignals.agentName);
    
    if (signalStats.length === 0) {
      console.log('No agent signals found');
    } else {
      let total = 0;
      for (const stat of signalStats) {
        console.log(`${stat.agentName}: ${stat.count} signals`);
        total += Number(stat.count);
      }
      console.log(`Total: ${total} signals`);
    }
  } catch (e: any) {
    console.log('Error checking agentSignals:', e.message);
  }
  
  // Check trades
  console.log('\n=== Trades ===');
  try {
    const tradeStats = await db.select({
      status: trades.status,
      count: count(),
    }).from(trades)
      .groupBy(trades.status);
    
    if (tradeStats.length === 0) {
      console.log('No trades found');
    } else {
      for (const stat of tradeStats) {
        console.log(`${stat.status}: ${stat.count} trades`);
      }
    }
    
    // Get recent trades
    const recentTrades = await db.select({
      id: trades.id,
      symbol: trades.symbol,
      side: trades.side,
      entryPrice: trades.entryPrice,
      exitPrice: trades.exitPrice,
      pnl: trades.pnl,
      status: trades.status,
      entryTime: trades.entryTime,
    }).from(trades)
      .orderBy(desc(trades.entryTime))
      .limit(10);
    
    if (recentTrades.length > 0) {
      console.log('\nRecent trades:');
      for (const trade of recentTrades) {
        console.log(`  #${trade.id}: ${trade.symbol} ${trade.side} @ ${trade.entryPrice} -> ${trade.exitPrice || 'open'} (${trade.status}, P&L: ${trade.pnl || 'N/A'})`);
      }
    }
  } catch (e: any) {
    console.log('Error checking trades:', e.message);
  }
  
  console.log('\n========================================');
  console.log('DATA CHECK COMPLETE');
  console.log('========================================\n');
  
  process.exit(0);
}

checkData().catch(console.error);
