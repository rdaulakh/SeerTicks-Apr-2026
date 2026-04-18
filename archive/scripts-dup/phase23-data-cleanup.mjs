/**
 * Phase 23: Historical Data Cleanup — Zero Tolerance
 * 
 * This script:
 * 1. Identifies positions that were backfilled with entryPrice as exitPrice (fabricated data)
 * 2. For positions where exitPrice === entryPrice AND exitReason contains 'backfill': 
 *    - If currentPrice is a real value (different from entryPrice) → recalculate with currentPrice
 *    - If currentPrice === entryPrice or NULL → mark as data_integrity_issue (NULL out P&L)
 * 3. For positions with NULL exitPrice → mark as data_integrity_issue
 * 4. Reports final state
 */

import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== Phase 23: Historical Data Cleanup ===\n');
  
  // Step 1: Find positions backfilled with fabricated exit prices
  // These are positions where exitReason contains 'backfill' (from the bad script)
  const [backfilled] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, exitPrice, currentPrice, realizedPnl, quantity, exitReason
    FROM paperPositions
    WHERE status = 'closed'
    AND exitReason LIKE '%backfill%'
  `);
  
  console.log(`Found ${backfilled.length} backfilled positions to audit\n`);
  
  let fixedWithRealPrice = 0;
  let markedCorrupted = 0;
  
  for (const pos of backfilled) {
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const exitPrice = parseFloat(pos.exitPrice || '0');
    const currentPrice = parseFloat(pos.currentPrice || '0');
    const quantity = parseFloat(pos.quantity || '0');
    
    // Check if currentPrice is a real different value (not just entryPrice copy)
    const hasRealCurrentPrice = currentPrice > 0 && Math.abs(currentPrice - entryPrice) > 0.01;
    
    if (hasRealCurrentPrice) {
      // Recalculate P&L with real currentPrice
      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * quantity
        : (entryPrice - currentPrice) * quantity;
      
      await conn.execute(`
        UPDATE paperPositions 
        SET exitPrice = ?, realizedPnl = ?, exitReason = 'Phase23: recalculated_real_price'
        WHERE id = ?
      `, [currentPrice.toString(), pnl.toFixed(8), pos.id]);
      
      fixedWithRealPrice++;
    } else {
      // No real price data — mark as data_integrity_issue
      await conn.execute(`
        UPDATE paperPositions 
        SET exitPrice = NULL, realizedPnl = NULL, 
            exitReason = 'Phase23: no_real_exit_price'
        WHERE id = ?
      `, [pos.id]);
      
      markedCorrupted++;
    }
  }
  
  console.log(`Backfilled positions fixed with real currentPrice: ${fixedWithRealPrice}`);
  console.log(`Backfilled positions marked as data_integrity_issue: ${markedCorrupted}\n`);
  
  // Step 2: Find any remaining positions with exitPrice === entryPrice (zero P&L suspects)
  // These may be from old system bugs, not backfill
  const [zeroPnlSuspects] = await conn.execute(`
    SELECT id, symbol, side, entryPrice, exitPrice, currentPrice, realizedPnl, quantity, exitReason
    FROM paperPositions
    WHERE status = 'closed'
    AND exitPrice IS NOT NULL
    AND CAST(exitPrice AS DECIMAL(20,8)) = CAST(entryPrice AS DECIMAL(20,8))
    AND (realizedPnl IS NULL OR CAST(realizedPnl AS DECIMAL(20,8)) = 0)
    AND exitReason NOT LIKE '%data_integrity_issue%'
  `);
  
  console.log(`Found ${zeroPnlSuspects.length} zero-P&L suspects (exitPrice = entryPrice)\n`);
  
  let zeroPnlFixed = 0;
  let zeroPnlMarked = 0;
  
  for (const pos of zeroPnlSuspects) {
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const currentPrice = parseFloat(pos.currentPrice || '0');
    const quantity = parseFloat(pos.quantity || '0');
    
    const hasRealCurrentPrice = currentPrice > 0 && Math.abs(currentPrice - entryPrice) > 0.01;
    
    if (hasRealCurrentPrice) {
      // currentPrice is different from entryPrice — this is likely the real exit price
      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * quantity
        : (entryPrice - currentPrice) * quantity;
      
      await conn.execute(`
        UPDATE paperPositions 
        SET exitPrice = ?, realizedPnl = ?,
            exitReason = 'Phase23: recalculated_real_price'
        WHERE id = ?
      `, [currentPrice.toString(), pnl.toFixed(8), pos.id]);
      
      zeroPnlFixed++;
    } else {
      // exitPrice = entryPrice = currentPrice — genuinely no price movement, or data is bad
      // Leave as-is if the exitReason is legitimate (stop_loss, take_profit, manual, etc.)
      // Only mark as suspect if it's from system/cleanup
      const suspectReasons = ['system', 'cleanup', 'orphan', 'ghost', 'WALLET_RESET'];
      const isSuspect = suspectReasons.some(r => (pos.exitReason || '').toLowerCase().includes(r.toLowerCase()));
      
      if (isSuspect) {
        await conn.execute(`
          UPDATE paperPositions 
          SET exitPrice = NULL, realizedPnl = NULL,
              exitReason = 'Phase23: no_real_exit_price'
          WHERE id = ?
        `, [pos.id]);
        zeroPnlMarked++;
      }
      // If not suspect (manual, stop_loss, etc.), leave as-is — could be legitimate breakeven
    }
  }
  
  console.log(`Zero-P&L suspects fixed with real currentPrice: ${zeroPnlFixed}`);
  console.log(`Zero-P&L suspects marked as data_integrity_issue: ${zeroPnlMarked}\n`);
  
  // Step 3: Final state report
  const [finalState] = await conn.execute(`
    SELECT 
      COUNT(*) as total_closed,
      SUM(CASE WHEN realizedPnl IS NULL THEN 1 ELSE 0 END) as null_pnl,
      SUM(CASE WHEN exitPrice IS NULL THEN 1 ELSE 0 END) as null_exit_price,
      SUM(CASE WHEN realizedPnl IS NOT NULL AND CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as profitable,
      SUM(CASE WHEN realizedPnl IS NOT NULL AND CAST(realizedPnl AS DECIMAL(20,8)) < 0 THEN 1 ELSE 0 END) as losing,
      SUM(CASE WHEN realizedPnl IS NOT NULL AND CAST(realizedPnl AS DECIMAL(20,8)) = 0 THEN 1 ELSE 0 END) as breakeven,
      SUM(CASE WHEN realizedPnl IS NOT NULL THEN CAST(realizedPnl AS DECIMAL(20,8)) ELSE 0 END) as total_realized_pnl,
      SUM(CASE WHEN exitReason LIKE '%data_integrity_issue%' THEN 1 ELSE 0 END) as data_integrity_issues
    FROM paperPositions
    WHERE status = 'closed'
  `);
  
  const [openState] = await conn.execute(`
    SELECT COUNT(*) as open_count FROM paperPositions WHERE status = 'open'
  `);
  
  const stats = finalState[0];
  console.log('=== FINAL STATE ===');
  console.log(`Total closed positions: ${stats.total_closed}`);
  console.log(`  With valid P&L: ${stats.total_closed - stats.null_pnl}`);
  console.log(`  Data integrity issues (NULL P&L): ${stats.null_pnl}`);
  console.log(`  NULL exit price: ${stats.null_exit_price}`);
  console.log(`  Profitable: ${stats.profitable}`);
  console.log(`  Losing: ${stats.losing}`);
  console.log(`  Breakeven: ${stats.breakeven}`);
  console.log(`  Total realized P&L: $${parseFloat(stats.total_realized_pnl || 0).toFixed(2)}`);
  console.log(`  Flagged data_integrity_issue: ${stats.data_integrity_issues}`);
  console.log(`Open positions: ${openState[0].open_count}`);
  
  await conn.end();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
