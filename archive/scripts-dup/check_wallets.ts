import { getDb } from '../server/db';
import { paperWallets } from '../drizzle/schema';

async function main() {
  const db = await getDb();
  if (!db) {
    console.log('Database not available');
    return;
  }

  const wallets = await db.select().from(paperWallets);
  
  console.log('\n=== Paper Wallets ===');
  for (const wallet of wallets) {
    const availableBalance = parseFloat(wallet.balance as string) - parseFloat(wallet.margin as string);
    console.log(`userId=${wallet.userId}: balance=$${wallet.balance}, margin=$${wallet.margin}, available=$${availableBalance.toFixed(2)}`);
  }
  
  process.exit(0);
}

main().catch(console.error);
