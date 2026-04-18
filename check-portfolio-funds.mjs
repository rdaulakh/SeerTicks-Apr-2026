import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const db = drizzle(connection);
  
  const [rows] = await connection.execute("SELECT userId, mode, portfolioFunds FROM tradingModeConfig");
  console.log("tradingModeConfig data:");
  console.log(JSON.stringify(rows, null, 2));
  
  await connection.end();
}

main().catch(console.error);
