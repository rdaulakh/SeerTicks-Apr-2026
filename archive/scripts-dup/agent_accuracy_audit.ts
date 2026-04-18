import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  
  console.log("=== DEEP AGENT ACCURACY AUDIT ===\n");
  
  // 1. Get agentSignals table structure
  const [columns] = await connection.execute("DESCRIBE agentSignals");
  console.log("agentSignals columns:");
  for (const col of columns as any[]) {
    console.log(`  - ${col.Field}: ${col.Type}`);
  }
  
  // 2. Get sample signal to understand data format
  const [sample] = await connection.execute(
    "SELECT * FROM agentSignals ORDER BY timestamp DESC LIMIT 1"
  );
  console.log("\nSample signal:", JSON.stringify(sample, null, 2));
  
  // 3. Get ticks table structure to understand price data
  const [tickColumns] = await connection.execute("DESCRIBE ticks");
  console.log("\nticks columns:");
  for (const col of tickColumns as any[]) {
    console.log(`  - ${col.Field}: ${col.Type}`);
  }
  
  // 4. Get sample tick
  const [tickSample] = await connection.execute(
    "SELECT * FROM ticks ORDER BY timestamp DESC LIMIT 1"
  );
  console.log("\nSample tick:", JSON.stringify(tickSample, null, 2));
  
  // 5. Count ticks available
  const [tickCount] = await connection.execute("SELECT COUNT(*) as count FROM ticks");
  console.log("\nTotal ticks:", (tickCount as any[])[0].count);
  
  // 6. Get paperPositions table structure
  const [posColumns] = await connection.execute("DESCRIBE paperPositions");
  console.log("\npaperPositions columns:");
  for (const col of posColumns as any[]) {
    console.log(`  - ${col.Field}: ${col.Type}`);
  }
  
  await connection.end();
}

main().catch(console.error);
