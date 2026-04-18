/**
 * Phase 40: Close all stale open positions
 * These are zombie positions from before the fix that need to be closed
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and } from 'drizzle-orm';
import { paperPositions } from '../drizzle/schema';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get all open positions
  const openPositions = await db.select().from(paperPositions).where(eq(paperPositions.status, 'open'));
  
  console.log(`Found ${openPositions.length} open positions to close`);
  
  let totalPnl = 0;
  
  for (const pos of openPositions) {
    const entryPrice = parseFloat(pos.entryPrice);
    const currentPrice = parseFloat(pos.currentPrice || pos.entryPrice);
    const quantity = parseFloat(pos.quantity);
    
    let pnlPercent: number;
    let pnlDollar: number;
    
    if (pos.side === 'long') {
      pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      pnlDollar = (currentPrice - entryPrice) * quantity;
    } else {
      pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
      pnlDollar = (entryPrice - currentPrice) * quantity;
    }
    
    totalPnl += pnlDollar;
    
    console.log(`Closing ${pos.id}: ${pos.symbol} ${pos.side} | Entry: $${entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | P&L: ${pnlPercent.toFixed(2)}% ($${pnlDollar.toFixed(2)}) | Open ${((Date.now() - new Date(pos.createdAt).getTime()) / 3600000).toFixed(1)}h`);
    
    // Close the position
    await db.update(paperPositions)
      .set({
        status: 'closed',
        exitPrice: String(currentPrice),
        exitReason: `Phase 40: Stale position cleanup (P&L: ${pnlPercent.toFixed(2)}%)`,
        realizedPnl: String(pnlDollar),
        realizedPnlPercent: String(pnlPercent),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paperPositions.id, pos.id));
  }
  
  console.log(`\n=== CLEANUP COMPLETE ===`);
  console.log(`Closed ${openPositions.length} stale positions`);
  console.log(`Total P&L from cleanup: $${totalPnl.toFixed(2)}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
