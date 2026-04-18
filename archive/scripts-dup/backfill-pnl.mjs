/**
 * Phase 23: Backfill missing P&L and exitPrice for historically closed positions
 * 
 * Problem:
 * 1. 319 positions closed by exit manager have NULL exitPrice (closePosition didn't update DB)
 * 2. 96 positions have NULL realizedPnl (system/orphaned cleanup didn't calculate P&L)
 * 
 * Strategy:
 * - For positions with exitPrice but NULL realizedPnl: calculate P&L from entry/exit prices
 * - For positions with NULL exitPrice: use currentPrice as exitPrice, then calculate P&L
 * - For positions with NULL exitPrice AND NULL currentPrice: use entryPrice (P&L = 0)
 */

import mysql from 'mysql2/promise';

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const sslParam = url.searchParams.get('ssl');
  let ssl = false;
  if (sslParam) { try { ssl = JSON.parse(sslParam); } catch { ssl = { rejectUnauthorized: true }; } }
  
  const conn = await mysql.createConnection({
    host: url.hostname, port: parseInt(url.port) || 3306,
    user: url.username, password: url.password,
    database: url.pathname.slice(1), ssl
  });

  console.log('=== Phase 23: P&L Backfill Script ===\n');

  // Step 1: Fix positions with NULL exitPrice (319 positions)
  // Use currentPrice as exitPrice, or entryPrice as last resort
  console.log('Step 1: Fixing positions with NULL exitPrice...');
  const [nullExitPrice] = await conn.query(`
    SELECT id, symbol, side, entryPrice, currentPrice, quantity, realizedPnl, exitReason
    FROM paperPositions 
    WHERE status = 'closed' AND exitPrice IS NULL
  `);
  
  let fixedExitPrice = 0;
  for (const pos of nullExitPrice) {
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const currentPrice = parseFloat(pos.currentPrice || '0');
    const quantity = parseFloat(pos.quantity || '0');
    
    // Use currentPrice if available, otherwise entryPrice
    const exitPrice = currentPrice > 0 ? currentPrice : entryPrice;
    
    // Calculate P&L
    let realizedPnl = 0;
    if (entryPrice > 0 && quantity > 0 && exitPrice > 0) {
      if (pos.side === 'long') {
        realizedPnl = (exitPrice - entryPrice) * quantity;
      } else {
        realizedPnl = (entryPrice - exitPrice) * quantity;
      }
    }
    
    await conn.query(`
      UPDATE paperPositions 
      SET exitPrice = ?, realizedPnl = ?, updatedAt = NOW()
      WHERE id = ?
    `, [exitPrice.toString(), realizedPnl.toFixed(8), pos.id]);
    fixedExitPrice++;
  }
  console.log(`  Fixed ${fixedExitPrice} positions with NULL exitPrice`);

  // Step 2: Fix positions with exitPrice but NULL realizedPnl (remaining after step 1)
  console.log('\nStep 2: Fixing positions with NULL realizedPnl (but have exitPrice)...');
  const [nullPnl] = await conn.query(`
    SELECT id, symbol, side, entryPrice, exitPrice, quantity
    FROM paperPositions 
    WHERE status = 'closed' AND realizedPnl IS NULL AND exitPrice IS NOT NULL
  `);
  
  let fixedPnl = 0;
  for (const pos of nullPnl) {
    const entryPrice = parseFloat(pos.entryPrice || '0');
    const exitPrice = parseFloat(pos.exitPrice || '0');
    const quantity = parseFloat(pos.quantity || '0');
    
    let realizedPnl = 0;
    if (entryPrice > 0 && quantity > 0 && exitPrice > 0) {
      if (pos.side === 'long') {
        realizedPnl = (exitPrice - entryPrice) * quantity;
      } else {
        realizedPnl = (entryPrice - exitPrice) * quantity;
      }
    }
    
    await conn.query(`
      UPDATE paperPositions SET realizedPnl = ?, updatedAt = NOW() WHERE id = ?
    `, [realizedPnl.toFixed(8), pos.id]);
    fixedPnl++;
  }
  console.log(`  Fixed ${fixedPnl} positions with NULL realizedPnl`);

  // Step 3: Verify results
  console.log('\n=== Verification ===');
  const [verify] = await conn.query(`
    SELECT 
      COUNT(*) as total_closed,
      SUM(CASE WHEN realizedPnl IS NULL THEN 1 ELSE 0 END) as null_pnl,
      SUM(CASE WHEN exitPrice IS NULL THEN 1 ELSE 0 END) as null_exit_price,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) > 0 THEN 1 ELSE 0 END) as profitable,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) < 0 THEN 1 ELSE 0 END) as losing,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,8)) = 0 THEN 1 ELSE 0 END) as breakeven,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,8))), 2) as total_realized_pnl
    FROM paperPositions WHERE status = 'closed'
  `);
  console.log('After backfill:', JSON.stringify(verify[0], null, 2));
  
  const [openCount] = await conn.query('SELECT COUNT(*) as cnt FROM paperPositions WHERE status = \'open\'');
  console.log(`Open positions: ${openCount[0].cnt}`);

  await conn.end();
  console.log('\n=== Backfill Complete ===');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
