// Test the settingsRouter queries directly
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import { int, mysqlTable, varchar, boolean, timestamp, mysqlEnum } from 'drizzle-orm/mysql-core';

// Define tables inline for testing
const exchanges = mysqlTable("exchanges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  exchangeName: mysqlEnum("exchangeName", ["binance", "coinbase"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  connectionStatus: mysqlEnum("connectionStatus", ["connected", "disconnected", "error"]).default("disconnected").notNull(),
  lastConnected: timestamp("lastConnected"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

const tradingSymbols = mysqlTable("tradingSymbols", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  exchangeName: mysqlEnum("exchangeName", ["binance", "coinbase"]).notNull().default("coinbase"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull()
});

async function test() {
  const db = drizzle(process.env.DATABASE_URL);
  
  const userId = 272657;
  
  console.log('Testing getExchanges for userId:', userId);
  const exchangeResults = await db
    .select()
    .from(exchanges)
    .where(eq(exchanges.userId, userId));
  console.log('Exchanges found:', exchangeResults.length);
  console.log(JSON.stringify(exchangeResults, null, 2));
  
  console.log('\nTesting getSymbols for userId:', userId);
  const symbolResults = await db
    .select()
    .from(tradingSymbols)
    .where(eq(tradingSymbols.userId, userId));
  console.log('Symbols found:', symbolResults.length);
  console.log(JSON.stringify(symbolResults, null, 2));
  
  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
