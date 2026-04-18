import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { users, paperWallets, paperPositions } from "./drizzle/schema";

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Find user by email
  const user = await db.select()
    .from(users)
    .where(eq(users.email, 'rdaulakh@exoways.com'))
    .limit(1);
  
  console.log("User:");
  console.table(user);
  
  if (user.length > 0) {
    const userId = user[0].id;
    console.log("\nUser ID:", userId);
    
    // Check wallet for this user
    const wallet = await db.select()
      .from(paperWallets)
      .where(eq(paperWallets.userId, userId));
    
    console.log("\nWallet for user:");
    console.table(wallet);
    
    // Check positions for this user
    const positions = await db.select()
      .from(paperPositions)
      .where(eq(paperPositions.userId, userId));
    
    console.log("\nPositions for user:", positions.length);
  }
  
  process.exit(0);
}

main().catch(console.error);
