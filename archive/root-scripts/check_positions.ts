import { drizzle } from "drizzle-orm/mysql2";
import { desc, eq } from "drizzle-orm";
import { paperPositions, paperWallets } from "./drizzle/schema";

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check positions
  const positions = await db.select()
    .from(paperPositions)
    .orderBy(desc(paperPositions.createdAt))
    .limit(10);
  
  console.log("Paper Positions:");
  console.table(positions.map(p => ({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    status: p.status,
    entryPrice: p.entryPrice,
    quantity: p.quantity,
    createdAt: p.createdAt
  })));
  
  console.log("\nTotal positions:", positions.length);
  
  // Check wallet
  const wallets = await db.select().from(paperWallets).limit(5);
  console.log("\nPaper Wallets:");
  console.table(wallets.map(w => ({
    id: w.id,
    userId: w.userId,
    balance: w.balance,
    margin: w.margin
  })));
  
  process.exit(0);
}

main().catch(console.error);
