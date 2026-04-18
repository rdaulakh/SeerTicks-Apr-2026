import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { paperWallets, paperPositions } from "./drizzle/schema";

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  const wallets = await db.select().from(paperWallets).where(eq(paperWallets.userId, 272657));
  console.log("Wallet:", wallets[0]);
  
  const positions = await db.select().from(paperPositions).where(eq(paperPositions.userId, 272657));
  const openPositions = positions.filter(p => p.status === 'open');
  console.log(`Open positions: ${openPositions.length}`);
  
  // Calculate total margin from open positions
  let totalMargin = 0;
  for (const pos of openPositions) {
    const value = Number(pos.entryPrice) * Number(pos.quantity);
    totalMargin += value;
  }
  console.log(`Calculated margin from positions: $${totalMargin.toFixed(2)}`);
  
  process.exit(0);
}

main().catch(console.error);
