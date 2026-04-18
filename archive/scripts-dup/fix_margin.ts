import { getDb } from '../server/db';
import { paperWallets, paperPositions } from '../drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.log('Database not available');
    return;
  }

  const userId = 272657;
  
  // Get open positions
  const openPositions = await db.select()
    .from(paperPositions)
    .where(and(
      eq(paperPositions.userId, userId),
      eq(paperPositions.status, 'open')
    ));
  
  console.log(`\n=== Open Positions for userId=${userId} ===`);
  console.log(`Count: ${openPositions.length}`);
  
  let totalMargin = 0;
  for (const pos of openPositions) {
    const margin = parseFloat(pos.quantity as string) * parseFloat(pos.entryPrice as string);
    totalMargin += margin;
    console.log(`  ${pos.symbol}: qty=${pos.quantity}, entry=$${pos.entryPrice}, margin=$${margin.toFixed(2)}`);
  }
  
  console.log(`\nTotal margin from open positions: $${totalMargin.toFixed(2)}`);
  
  // Get current wallet
  const [wallet] = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId));
  console.log(`\nCurrent wallet: balance=$${wallet.balance}, margin=$${wallet.margin}`);
  
  // Fix the margin
  if (openPositions.length === 0) {
    console.log('\nNo open positions - margin should be 0');
    await db.update(paperWallets)
      .set({ margin: '0' })
      .where(eq(paperWallets.userId, userId));
    console.log('✅ Margin reset to 0');
  } else {
    console.log(`\nSetting margin to $${totalMargin.toFixed(2)}`);
    await db.update(paperWallets)
      .set({ margin: totalMargin.toFixed(2) })
      .where(eq(paperWallets.userId, userId));
    console.log('✅ Margin updated');
  }
  
  // Verify
  const [updatedWallet] = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId));
  const availableBalance = parseFloat(updatedWallet.balance as string) - parseFloat(updatedWallet.margin as string);
  console.log(`\nUpdated wallet: balance=$${updatedWallet.balance}, margin=$${updatedWallet.margin}, available=$${availableBalance.toFixed(2)}`);
  
  process.exit(0);
}

main().catch(console.error);
