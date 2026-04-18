import { getBalanceTracker } from '../server/services/BalanceTracker';

async function testBalanceTracker() {
  console.log('=== Testing BalanceTracker ===\n');
  
  // Assuming user ID 1 (owner)
  const userId = 1;
  const tracker = getBalanceTracker(userId);
  
  console.log('Getting balance snapshot (async)...');
  const snapshot = await tracker.getBalanceSnapshotAsync();
  
  console.log('\n=== Balance Snapshot ===');
  console.log(`Total Balance: $${snapshot.totalBalance.toFixed(2)}`);
  console.log(`Available Balance: $${snapshot.availableBalance.toFixed(2)}`);
  console.log(`Margin Used: $${snapshot.marginUsed.toFixed(2)}`);
  console.log(`Equity: $${snapshot.equity.toFixed(2)}`);
  console.log(`Unrealized P&L: $${snapshot.unrealizedPnL.toFixed(2)}`);
  console.log(`Realized P&L: $${snapshot.realizedPnL.toFixed(2)}`);
  console.log(`Timestamp: ${snapshot.timestamp.toISOString()}`);
  
  console.log('\n=== Positions ===');
  const positions = tracker.getPositions();
  console.log(`Number of positions: ${positions.length}`);
  
  for (const pos of positions) {
    console.log(`\n${pos.symbol}:`);
    console.log(`  Quantity: ${pos.quantity}`);
    console.log(`  Entry Price: $${pos.entryPrice.toFixed(2)}`);
    console.log(`  Current Price: $${pos.currentPrice.toFixed(2)}`);
    console.log(`  Margin Used: $${pos.marginUsed.toFixed(2)}`);
    console.log(`  Unrealized P&L: $${pos.unrealizedPnL.toFixed(2)}`);
  }
  
  console.log('\n=== Expected vs Actual ===');
  console.log(`Expected Total Balance: $18,212.77`);
  console.log(`Actual Total Balance: $${snapshot.totalBalance.toFixed(2)}`);
  console.log(`Expected Margin: $804.80`);
  console.log(`Actual Margin: $${snapshot.marginUsed.toFixed(2)}`);
  console.log(`Expected Available: $17,407.97`);
  console.log(`Actual Available: $${snapshot.availableBalance.toFixed(2)}`);
}

testBalanceTracker().catch(console.error);
