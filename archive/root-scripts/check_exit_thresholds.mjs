import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check open positions
const [positions] = await conn.execute(`
  SELECT id, symbol, side, entryPrice, quantity, status, originalConsensus, currentConfidence, peakConfidence, createdAt
  FROM paperPositions 
  WHERE status = 'open' AND userId = 272657
  ORDER BY id DESC
`);

console.log(`\n=== OPEN POSITIONS (userId: 272657) ===`);
console.log(`Total: ${positions.length}`);

const ENTRY_THRESHOLD = 65;
const DECAY_RATIO = 0.5;

for (const pos of positions) {
  const original = parseFloat(pos.originalConsensus || '65') * 100;
  const current = parseFloat(pos.currentConfidence || pos.originalConsensus || '65') * 100;
  const peak = parseFloat(pos.peakConfidence || pos.originalConsensus || '65') * 100;
  
  const gap = peak - ENTRY_THRESHOLD;
  const exitThreshold = peak - (gap * DECAY_RATIO);
  const shouldExit = current < exitThreshold;
  
  console.log(`\n  Position ${pos.id} (${pos.symbol} ${pos.side}):`);
  console.log(`    Entry Price: $${pos.entryPrice}`);
  console.log(`    Created: ${pos.createdAt}`);
  console.log(`    Original Consensus: ${original.toFixed(1)}%`);
  console.log(`    Current Confidence: ${current.toFixed(1)}%`);
  console.log(`    Peak Confidence: ${peak.toFixed(1)}%`);
  console.log(`    Exit Threshold: ${exitThreshold.toFixed(1)}% (PEAK ${peak.toFixed(1)}% - GAP ${gap.toFixed(1)}% × 50%)`);
  console.log(`    Should Exit: ${shouldExit ? '🚨 YES' : '❌ NO'} (current ${current.toFixed(1)}% ${shouldExit ? '<' : '>='} threshold ${exitThreshold.toFixed(1)}%)`);
}

// Check recent trade decision logs for consensus updates
const [logs] = await conn.execute(`
  SELECT symbol, direction, confidence, timestamp
  FROM tradeDecisionLogs 
  WHERE userId = 272657
  ORDER BY timestamp DESC
  LIMIT 10
`);

console.log(`\n=== RECENT CONSENSUS SIGNALS ===`);
for (const log of logs) {
  console.log(`  ${log.symbol}: ${log.direction} @ ${(parseFloat(log.confidence) * 100).toFixed(1)}% (${new Date(log.timestamp).toLocaleTimeString()})`);
}

await conn.end();
