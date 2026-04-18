import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check if consensus columns are being populated for open positions
const [positions] = await conn.execute(`
  SELECT 
    id,
    symbol,
    side,
    entryPrice,
    currentPrice,
    ROUND((CAST(currentPrice AS DECIMAL(20,8)) - CAST(entryPrice AS DECIMAL(20,8))) / CAST(entryPrice AS DECIMAL(20,8)) * 100, 2) as pnlPercent,
    originalConsensus,
    currentConfidence,
    peakConfidence,
    peakConfidenceTime,
    createdAt,
    updatedAt
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
  ORDER BY id DESC
  LIMIT 5
`);

console.log('\n=== CONSENSUS TRACKING STATUS ===\n');

if (positions.length === 0) {
  console.log('No open positions found');
} else {
  for (const pos of positions) {
    console.log(`Position ${pos.id} (${pos.symbol} ${pos.side}):`);
    console.log(`  Entry: $${pos.entryPrice}`);
    console.log(`  Current: $${pos.currentPrice}`);
    console.log(`  P&L: ${pos.pnlPercent}%`);
    console.log(`  Original Consensus: ${pos.originalConsensus ? (parseFloat(pos.originalConsensus) * 100).toFixed(1) + '%' : 'NOT SET ❌'}`);
    console.log(`  Current Confidence: ${pos.currentConfidence ? (parseFloat(pos.currentConfidence) * 100).toFixed(1) + '%' : 'NOT SET ❌'}`);
    console.log(`  Peak Confidence: ${pos.peakConfidence ? (parseFloat(pos.peakConfidence) * 100).toFixed(1) + '%' : 'NOT SET ❌'}`);
    console.log(`  Peak Time: ${pos.peakConfidenceTime || 'NOT SET'}`);
    console.log(`  Last Updated: ${pos.updatedAt}`);
    console.log('');
  }
}

// Check latest trade decision logs for consensus values
const [logs] = await conn.execute(`
  SELECT symbol, signalType, totalConfidence, threshold, decision, createdAt
  FROM tradeDecisionLogs
  WHERE userId = 272657
  ORDER BY id DESC
  LIMIT 3
`);

console.log('=== LATEST CONSENSUS SIGNALS ===\n');
for (const log of logs) {
  console.log(`${log.symbol}: ${log.signalType} @ ${(log.totalConfidence * 100).toFixed(1)}% (threshold: ${(log.threshold * 100).toFixed(1)}%)`);
  console.log(`  Decision: ${log.decision}`);
  console.log(`  Time: ${log.createdAt}`);
  console.log('');
}

await conn.end();
