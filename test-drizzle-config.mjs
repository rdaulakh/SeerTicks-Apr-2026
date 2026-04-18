import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

async function testDrizzleConfig() {
  console.log('Testing drizzle config parsing...');
  const connection = await mysql.createConnection({ uri: DATABASE_URL });
  const db = drizzle(connection);
  
  // Import schema
  const { engineState } = await import('./drizzle/schema.ts');
  
  const result = await db
    .select()
    .from(engineState)
    .where(eq(engineState.userId, 272657))
    .limit(1);
  
  console.log('Result:', result);
  console.log('Config type:', typeof result[0]?.config);
  console.log('Config value:', result[0]?.config);
  
  // Check if it's parsed
  const config = result[0]?.config;
  console.log('enableAutoTrading:', config?.enableAutoTrading);
  
  await connection.end();
}

testDrizzleConfig().catch(console.error);
