import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== TRACING CONFIDENCE DECAY EXIT FLOW ===\n');

// Step 1: Check open positions
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, currentPrice, 
         originalConsensus, currentConfidence, peakConfidence, peakConfidenceTime,
         ROUND(((CAST(currentPrice AS DECIMAL(20,8)) - CAST(entryPrice AS DECIMAL(20,8))) / CAST(entryPrice AS DECIMAL(20,8))) * 100, 2) as pnlPercent,
         createdAt
  FROM paperPositions 
  WHERE userId = 272657 AND status = 'open'
  ORDER BY createdAt DESC
  LIMIT 5
`);

console.log('STEP 1: Open Positions with Consensus Tracking');
console.log('─'.repeat(60));

if (positions.length === 0) {
  console.log('No open positions found.');
} else {
  for (const p of positions) {
    console.log(`\nPosition ${p.id} (${p.symbol}):`);
    console.log(`  Entry Price: $${p.entryPrice}`);
    console.log(`  Current Price: $${p.currentPrice}`);
    console.log(`  P&L: ${p.pnlPercent}%`);
    console.log(`  Original Consensus: ${p.originalConsensus || 'NOT SET ❌'}`);
    console.log(`  Current Confidence: ${p.currentConfidence || 'NOT SET ❌'}`);
    console.log(`  Peak Confidence: ${p.peakConfidence || 'NOT SET ❌'}`);
    console.log(`  Peak Time: ${p.peakConfidenceTime || 'NOT SET ❌'}`);
    
    // Calculate expected exit threshold
    if (p.originalConsensus && p.peakConfidence) {
      const entry = parseFloat(p.originalConsensus);
      const peak = parseFloat(p.peakConfidence);
      const gap = peak - 0.65; // Gap from entry threshold (65%)
      const decayRatio = p.pnlPercent >= 0 ? 0.50 : (p.pnlPercent >= -0.5 ? 0.30 : 0.20);
      const exitThreshold = peak - (gap * decayRatio);
      console.log(`  \n  EXIT CALCULATION:`);
      console.log(`    Entry Threshold: 65%`);
      console.log(`    Peak: ${(peak * 100).toFixed(1)}%`);
      console.log(`    GAP: ${(gap * 100).toFixed(1)}%`);
      console.log(`    Decay Ratio: ${decayRatio * 100}% (P&L: ${p.pnlPercent}%)`);
      console.log(`    EXIT THRESHOLD: ${(exitThreshold * 100).toFixed(1)}%`);
      
      const current = parseFloat(p.currentConfidence);
      if (current <= exitThreshold) {
        console.log(`    ⚠️ SHOULD EXIT: Current ${(current * 100).toFixed(1)}% <= Threshold ${(exitThreshold * 100).toFixed(1)}%`);
      } else {
        console.log(`    ✓ HOLD: Current ${(current * 100).toFixed(1)}% > Threshold ${(exitThreshold * 100).toFixed(1)}%`);
      }
    }
  }
}

// Step 2: Check latest consensus signals
console.log('\n\nSTEP 2: Latest Consensus Signals');
console.log('─'.repeat(60));

const [logs] = await conn.execute(`
  SELECT symbol, signalType, totalConfidence, timestamp
  FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY timestamp DESC
  LIMIT 10
`);

for (const log of logs) {
  console.log(`${log.timestamp} | ${log.symbol}: ${log.signalType} @ ${(log.totalConfidence * 100).toFixed(1)}%`);
}

// Step 3: Check if consensus is changing
console.log('\n\nSTEP 3: Consensus Change Analysis');
console.log('─'.repeat(60));

const [btcLogs] = await conn.execute(`
  SELECT totalConfidence, timestamp
  FROM tradeDecisionLogs 
  WHERE userId = 272657 AND symbol = 'BTC-USD'
  ORDER BY timestamp DESC
  LIMIT 20
`);

if (btcLogs.length > 1) {
  const confidences = btcLogs.map(l => l.totalConfidence);
  const min = Math.min(...confidences);
  const max = Math.max(...confidences);
  const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  
  console.log(`BTC-USD Consensus (last 20 signals):`);
  console.log(`  Min: ${(min * 100).toFixed(1)}%`);
  console.log(`  Max: ${(max * 100).toFixed(1)}%`);
  console.log(`  Avg: ${(avg * 100).toFixed(1)}%`);
  console.log(`  Range: ${((max - min) * 100).toFixed(1)}%`);
  
  if (max - min < 0.05) {
    console.log(`  ⚠️ ISSUE: Consensus is NOT changing (range < 5%)`);
  }
}

await conn.end();
