/**
 * PatternMatcher Audit Script
 * Traces complete data flow to identify why confidence/execution scores aren't updating
 */

import { getSEERMultiEngine } from './server/seerMainMulti.js';
import { getCandleCache } from './server/WebSocketCandleCache.js';

async function auditPatternMatcher() {
  console.log('\n=== PATTERNMATCHER AUDIT ===\n');
  
  // 1. Check if engine is running
  console.log('1. Checking engine status...');
  const engine = await getSEERMultiEngine(1); // userId 1
  const status = engine.getStatus();
  console.log(`   Engine running: ${status.isRunning}`);
  console.log(`   Active symbols: ${status.symbolStates.map(s => s.symbol).join(', ')}`);
  console.log(`   Tick count: ${status.tickCount}`);
  
  if (!status.isRunning) {
    console.log('\n❌ Engine is not running! Start engine first.\n');
    return;
  }
  
  // 2. Check candle cache
  console.log('\n2. Checking candle cache...');
  const cache = getCandleCache();
  const btc1d = cache.getCandles('BTCUSDT', '1d', 50);
  const btc4h = cache.getCandles('BTCUSDT', '4h', 50);
  const btc5m = cache.getCandles('BTCUSDT', '5m', 50);
  console.log(`   BTCUSDT 1d candles: ${btc1d.length}`);
  console.log(`   BTCUSDT 4h candles: ${btc4h.length}`);
  console.log(`   BTCUSDT 5m candles: ${btc5m.length}`);
  
  if (btc1d.length < 20 || btc4h.length < 20 || btc5m.length < 20) {
    console.log('\n⚠️  Insufficient candle data! PatternMatcher needs 20+ candles.\n');
  }
  
  // 3. Check recent signals
  console.log('\n3. Checking recent signals from database...');
  const { getDb } = await import('./server/db.js');
  const db = await getDb();
  if (db) {
    const recentSignals = await db.execute(`
      SELECT agentName, symbol, signal, confidence, executionScore, timestamp
      FROM agentSignals
      WHERE agentName = 'PatternMatcher'
      ORDER BY timestamp DESC
      LIMIT 10
    `);
    
    console.log(`   Found ${recentSignals.rows.length} recent PatternMatcher signals:`);
    for (const row of recentSignals.rows) {
      const signal: any = row;
      const time = new Date(Number(signal.timestamp)).toLocaleTimeString();
      console.log(`   - ${time}: ${signal.symbol} ${signal.signal} (confidence: ${(signal.confidence * 100).toFixed(1)}%, exec: ${signal.executionScore})`);
    }
  }
  
  // 4. Manually trigger PatternMatcher to see live output
  console.log('\n4. Manually triggering PatternMatcher for BTCUSDT...');
  const symbolState = status.symbolStates.find(s => s.symbol === 'BTCUSDT');
  if (symbolState) {
    console.log('   Waiting for next tick...');
    
    // Wait for 5 seconds to collect new signals
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if new signals were generated
    if (db) {
      const newSignals = await db.execute(`
        SELECT agentName, symbol, signal, confidence, executionScore, timestamp
        FROM agentSignals
        WHERE agentName = 'PatternMatcher' AND symbol = 'BTCUSDT'
        ORDER BY timestamp DESC
        LIMIT 3
      `);
      
      console.log(`\n   Latest 3 signals after waiting:`);
      for (const row of newSignals.rows) {
        const signal: any = row;
        const time = new Date(Number(signal.timestamp)).toLocaleTimeString();
        const age = Date.now() - Number(signal.timestamp);
        console.log(`   - ${time} (${Math.floor(age / 1000)}s ago): confidence=${(signal.confidence * 100).toFixed(1)}%, exec=${signal.executionScore}`);
      }
      
      // Check if confidence/exec score changed
      if (newSignals.rows.length >= 2) {
        const latest: any = newSignals.rows[0];
        const previous: any = newSignals.rows[1];
        const confChange = Math.abs(latest.confidence - previous.confidence) * 100;
        const execChange = Math.abs(latest.executionScore - previous.executionScore);
        
        console.log(`\n   📊 Changes between last 2 signals:`);
        console.log(`      Confidence: ${confChange.toFixed(2)}% change`);
        console.log(`      Execution Score: ${execChange.toFixed(0)} points change`);
        
        if (confChange < 0.1 && execChange < 1) {
          console.log(`\n   ❌ PROBLEM IDENTIFIED: Values are nearly identical!`);
          console.log(`      This means confidence/execution score are NOT updating dynamically.`);
        } else {
          console.log(`\n   ✅ Values are changing - dynamic updates working!`);
        }
      }
    }
  }
  
  // 5. Check WebSocket trade events
  console.log('\n5. Checking if WebSocket trade events are firing...');
  console.log('   (Check server console for "[SymbolOrchestrator] ⚡ RECEIVED TRADE" logs)');
  
  console.log('\n=== AUDIT COMPLETE ===\n');
  process.exit(0);
}

auditPatternMatcher().catch(console.error);
