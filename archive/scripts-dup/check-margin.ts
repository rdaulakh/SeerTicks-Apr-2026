import { getDb } from '../server/db';
import { paperPositions, paperWallets } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

async function checkMargin() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    return;
  }

  // Get open positions
  const positions = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, 'open'));

  console.log('=== Open Positions ===');
  let totalMargin = 0;

  for (const pos of positions) {
    const entryPrice = parseFloat(pos.entryPrice.toString());
    const quantity = parseFloat(pos.quantity.toString());
    const margin = entryPrice * quantity;
    totalMargin += margin;

    console.log(`\n${pos.symbol} ${pos.side}:`);
    console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`  Quantity: ${quantity}`);
    console.log(`  Margin: $${margin.toFixed(2)}`);
  }

  console.log(`\n=== Total Margin: $${totalMargin.toFixed(2)} ===`);

  // Get wallet
  const wallets = await db.select().from(paperWallets).limit(1);
  if (wallets.length > 0) {
    const wallet = wallets[0];
    console.log('\n=== Wallet Data ===');
    console.log(`Balance: $${wallet.balance}`);
    console.log(`Equity: $${wallet.equity}`);
    console.log(`Margin (stored): $${wallet.margin}`);
    console.log(
      `Available (should be): $${(parseFloat(wallet.balance.toString()) - totalMargin).toFixed(2)}`
    );
  }
}

checkMargin().catch(console.error);
