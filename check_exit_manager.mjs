import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  // Check open positions
  const [positions] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, quantity, status, originalConsensus, currentConfidence, peakConfidence
    FROM paperPositions 
    WHERE status = 'open' AND userId = 272657
    ORDER BY id DESC
  `);
  
  console.log(`\n=== OPEN POSITIONS (userId: 272657) ===`);
  console.log(`Total: ${positions.length}`);
  
  for (const pos of positions) {
    const entryThreshold = 65;
    const peak = pos.peakConfidence || pos.originalConsensus || 65;
    const gap = peak - entryThreshold;
    const exitThreshold = peak - (gap * 0.5);
    const current = pos.currentConfidence || pos.originalConsensus || 65;
    const shouldExit = current < exitThreshold;
    
    console.log(`\n  Position ${pos.id} (${pos.symbol} ${pos.side}):`);
    console.log(`    Entry Price: $${pos.entryPrice}`);
    console.log(`    Original Consensus: ${pos.originalConsensus || 'N/A'}%`);
    console.log(`    Current Confidence: ${current}%`);
    console.log(`    Peak Confidence: ${peak}%`);
    console.log(`    Exit Threshold: ${exitThreshold.toFixed(1)}% (PEAK ${peak}% - GAP ${gap}% × 50%)`);
    console.log(`    Should Exit: ${shouldExit ? '🚨 YES' : '❌ NO'} (current ${current}% ${shouldExit ? '<' : '>='} threshold ${exitThreshold.toFixed(1)}%)`);
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
    console.log(`  ${log.symbol}: ${log.direction} @ ${log.confidence}% (${new Date(log.timestamp).toLocaleTimeString()})`);
  }
  
  await conn.end();
}

main().catch(console.error);
