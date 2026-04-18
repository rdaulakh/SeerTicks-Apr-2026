import { drizzle } from "drizzle-orm/mysql2";
import { desc } from "drizzle-orm";
import { tradeDecisionLogs } from "./drizzle/schema";

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  const logs = await db.select({
    id: tradeDecisionLogs.id,
    symbol: tradeDecisionLogs.symbol,
    signalType: tradeDecisionLogs.signalType,
    decision: tradeDecisionLogs.decision,
    status: tradeDecisionLogs.status,
    totalConfidence: tradeDecisionLogs.totalConfidence,
    timestamp: tradeDecisionLogs.timestamp,
  })
  .from(tradeDecisionLogs)
  .orderBy(desc(tradeDecisionLogs.timestamp))
  .limit(10);
  
  console.log("Trade Decision Logs:");
  console.table(logs);
  
  const count = await db.select().from(tradeDecisionLogs);
  console.log("\nTotal logs:", count.length);
  
  process.exit(0);
}

main().catch(console.error);
