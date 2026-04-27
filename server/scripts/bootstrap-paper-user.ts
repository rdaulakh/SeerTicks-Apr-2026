/**
 * One-shot bootstrap to create a paper-trading user and start their
 * autoTrading session. Idempotent — safe to re-run.
 *
 * Creates:
 *   - users         row (email rd@seerticks.com, no password — local only)
 *   - tradingModeConfig with mode='paper', autoTradeEnabled=true, $10K
 *   - tradingSymbols rows: BTC-USD, ETH-USD, SOL-USD active
 *   - settings  default row
 *
 * Why id=99999: matches the prior agent-performance.json baseline.
 *
 * Run: npx tsx server/scripts/bootstrap-paper-user.ts
 */
import 'dotenv/config';
import { getDb } from '../db';
import { users, tradingModeConfig, tradingSymbols, settings } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

const USER_ID = 99999;
const EMAIL = 'rd@seerticks.com';
const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

async function main() {
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  // 1) users
  const existing = await db.select().from(users).where(eq(users.id, USER_ID));
  if (existing.length === 0) {
    await db.insert(users).values({
      id: USER_ID,
      email: EMAIL,
      name: 'RD (paper)',
      role: 'admin',
      loginMethod: 'local',
      emailVerified: true,
    });
    console.log(`[bootstrap] users: created id=${USER_ID} email=${EMAIL}`);
  } else {
    console.log(`[bootstrap] users: id=${USER_ID} already exists`);
  }

  // 2) tradingModeConfig
  const tmc = await db.select().from(tradingModeConfig).where(eq(tradingModeConfig.userId, USER_ID));
  if (tmc.length === 0) {
    await db.insert(tradingModeConfig).values({
      userId: USER_ID,
      mode: 'paper',
      autoTradeEnabled: true,
      portfolioFunds: '10000.00',
      enableSlippage: true,
      enableCommission: true,
      enableMarketImpact: true,
      enableLatency: true,
    });
    console.log(`[bootstrap] tradingModeConfig: created paper, $10K, autoTrade ON`);
  } else {
    await db
      .update(tradingModeConfig)
      .set({ mode: 'paper', autoTradeEnabled: true })
      .where(eq(tradingModeConfig.userId, USER_ID));
    console.log(`[bootstrap] tradingModeConfig: updated paper + autoTrade ON`);
  }

  // 3) tradingSymbols (per-user subscription)
  for (const sym of SYMBOLS) {
    const sub = await db
      .select()
      .from(tradingSymbols)
      .where(eq(tradingSymbols.userId, USER_ID));
    const has = sub.find((s) => s.symbol === sym);
    if (!has) {
      await db.insert(tradingSymbols).values({
        userId: USER_ID,
        symbol: sym,
        isActive: true,
      });
      console.log(`[bootstrap] tradingSymbols: subscribed ${sym}`);
    } else if (!has.isActive) {
      await db
        .update(tradingSymbols)
        .set({ isActive: true })
        .where(eq(tradingSymbols.userId, USER_ID));
      console.log(`[bootstrap] tradingSymbols: re-activated ${sym}`);
    } else {
      console.log(`[bootstrap] tradingSymbols: ${sym} already active`);
    }
  }

  // 4) settings — minimal row, schema defaults handle the rest
  const cur = await db.select().from(settings).where(eq(settings.userId, USER_ID));
  if (cur.length === 0) {
    await db.insert(settings).values({ userId: USER_ID });
    console.log(`[bootstrap] settings: created default row`);
  } else {
    console.log(`[bootstrap] settings: already exists`);
  }

  console.log('\n[bootstrap] DONE — user 99999 ready to paper-trade.');
  console.log('  Tail the log: tail -f data/server-logs/seer.log');
  console.log('  Watch trades: docker exec seer-mysql mysql -u root -pseerlocal seer -e "SELECT id, symbol, side, entryPrice, status FROM paperPositions ORDER BY id DESC LIMIT 10;"');
  process.exit(0);
}

main().catch((e) => {
  console.error('[bootstrap] FAILED', e);
  process.exit(1);
});
