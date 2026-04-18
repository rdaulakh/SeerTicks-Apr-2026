import { drizzle } from 'drizzle-orm/mysql2';
import { tradingSymbols } from './drizzle/schema.ts';

const db = drizzle(process.env.DATABASE_URL);

const symbols = await db.select().from(tradingSymbols);

console.log('\n=== TRADING SYMBOLS IN DATABASE ===');
console.log(`Total: ${symbols.length}\n`);

for (const sym of symbols) {
  console.log(`ID: ${sym.id} | User: ${sym.userId} | Exchange: ${sym.exchangeName} | Symbol: ${sym.symbol} | Enabled: ${sym.enabled}`);
}

console.log('\n=== END ===\n');
