/**
 * Phase 20 — one-shot DB seeder to register SOL-USD as a global symbol.
 *
 * GlobalMarketEngine reads `globalSymbols WHERE isActive = true` to decide
 * which symbols get a per-symbol analyzer (with all 13 agents). Only BTC-USD
 * and ETH-USD were seeded; SOL-USD was missing despite being in
 * tradingSymbols and the price-feed subscription. Result: SOL had price
 * ticks but no agents → no signals → no trades, ever.
 *
 * This script idempotently INSERTs SOL-USD with isActive=true. Safe to
 * run multiple times — duplicate key errors are caught and logged.
 */

import 'dotenv/config';
import { getDb } from '../db';
import { globalSymbols } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) {
    console.error('[seed-sol] no db');
    process.exit(1);
  }

  const existing = await db
    .select()
    .from(globalSymbols)
    .where(eq(globalSymbols.symbol, 'SOL-USD'));

  if (existing.length > 0) {
    const row = existing[0];
    if (row.isActive) {
      console.log(`[seed-sol] SOL-USD already active (id=${row.id}). No-op.`);
      process.exit(0);
    }
    console.log(`[seed-sol] SOL-USD exists but inactive (id=${row.id}). Activating...`);
    await db
      .update(globalSymbols)
      .set({ isActive: true })
      .where(eq(globalSymbols.id, row.id));
    console.log('[seed-sol] activated.');
    process.exit(0);
  }

  console.log('[seed-sol] inserting SOL-USD into globalSymbols...');
  await db.insert(globalSymbols).values({
    symbol: 'SOL-USD',
    exchange: 'coinbase',
    isActive: true,
  });
  console.log('[seed-sol] globalSymbols inserted.');

  // Phase 20 — also seed PER-USER subscription so the trade pipeline
  // (UserTradingSession) actually consumes SOL signals. globalSymbols
  // controls who runs analyzers; tradingSymbols controls which analyzer
  // outputs each user's session listens to. Both must agree or SOL
  // ticks but produces no trades — the exact bug we just chased.
  const { tradingSymbols } = await import('../../drizzle/schema');
  const { and } = await import('drizzle-orm');
  // Find every user that already has BTC-USD or ETH-USD active and
  // doesn't yet have SOL-USD; add SOL-USD active for them.
  const existingSubs = await db
    .select()
    .from(tradingSymbols)
    .where(eq(tradingSymbols.symbol, 'SOL-USD'));
  const existingSubsByUser = new Set(existingSubs.map((r) => r.userId));

  const allBtc = await db
    .select()
    .from(tradingSymbols)
    .where(
      and(
        eq(tradingSymbols.symbol, 'BTC-USD'),
        eq(tradingSymbols.isActive, true),
      ),
    );
  let added = 0;
  for (const row of allBtc) {
    if (existingSubsByUser.has(row.userId)) continue;
    try {
      await db.insert(tradingSymbols).values({
        userId: row.userId,
        symbol: 'SOL-USD',
        isActive: true,
      });
      added++;
    } catch {
      /* duplicate keys / FK errors — skip */
    }
  }
  console.log(
    `[seed-sol] tradingSymbols: added SOL-USD for ${added} users (existing: ${existingSubsByUser.size}).`,
  );
  console.log('[seed-sol] Restart pm2 to pick up the new symbol.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
