/**
 * One-shot script: mint a JWT for user 99999 and call the tRPC
 * `seerMulti.closePosition` endpoint to manually close a position.
 *
 * Why we need this: there's no auth-bypass admin endpoint, and the
 * close-position lifecycle has to flow through the running engine
 * (UserSessionManager → UserTradingSession → PaperTradingEngine) so
 * that listeners fire and DB rows are written correctly. Calling SQL
 * directly would skip that chain.
 *
 * Usage: npx tsx server/scripts/close-position.ts <db-position-id>
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { paperPositions } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

const COOKIE_NAME = 'app_session_id';
const SERVER_URL = 'http://localhost:3001';
const USER_ID = 99999;

async function main() {
  const dbId = parseInt(process.argv[2] ?? '', 10);
  if (!dbId) {
    console.error('Usage: close-position.ts <db-position-id>');
    process.exit(1);
  }

  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  // Look up the position to confirm and get the engine-side ID.
  // The engine's in-memory ID is `pos_<createdAtMs>_<random>`. We reconstruct
  // by matching createdAt timestamp; the closePosition handler in EngineAdapter
  // already ignores exchangeId+symbol and uses positionId only. The tRPC
  // input requires both though, so we fetch them.
  const rows = await db
    .select()
    .from(paperPositions)
    .where(and(eq(paperPositions.userId, USER_ID), eq(paperPositions.id, dbId)));
  if (rows.length === 0) {
    console.error(`No position id=${dbId} for user ${USER_ID}`);
    process.exit(1);
  }
  const pos = rows[0];
  if (pos.status !== 'open') {
    console.error(`Position id=${dbId} is already ${pos.status}`);
    process.exit(1);
  }

  // The in-memory engine ID was logged at trade open like
  //   `pos_1777272985766_ttsxaf9lr` — first part is createdAt in ms.
  // We construct the prefix and look it up in the running server log.
  const createdAtMs = new Date(pos.createdAt).getTime();
  console.log(`[close] paperPositions row: id=${dbId} symbol=${pos.symbol} side=${pos.side} createdAtMs=${createdAtMs}`);
  // After a server restart, PaperTradingEngine reloads open positions from
  // the DB and assigns engineId = dbPos.id.toString() (engine line 298).
  // Newly-opened positions while the engine is running get
  // `pos_<ms>_<rand>`. So try the DB-id form first; fall back to log
  // scraping for live-session positions.
  let enginePositionId: string = String(dbId);
  const logPath = '/Users/rdaulakh/Desktop/Seerticks/data/server-logs/seer.log';
  const fs = await import('fs');
  const log = fs.readFileSync(logPath, 'utf-8');
  const secStart = Math.floor(createdAtMs / 1000) * 1000;
  const secEnd = secStart + 1000;
  const ids = Array.from(log.matchAll(/pos_(\d+)_([a-z0-9]+)/g));
  const liveMatch = ids.find((m) => {
    const ms = parseInt(m[1], 10);
    return ms >= secStart && ms < secEnd;
  });
  if (liveMatch) enginePositionId = liveMatch[0];
  console.log(`[close] engine id: ${enginePositionId}`);

  // Mint a JWT.
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const token = jwt.sign({ userId: USER_ID, email: 'rd@seerticks.com' }, secret, { expiresIn: '1h' });

  // Call tRPC. The endpoint takes exchangeId + symbol but ignores them in
  // EngineAdapter.closePosition (prefixed with _). Pass dummies.
  const url = `${SERVER_URL}/api/trpc/seerMulti.closePosition`;
  const body = {
    exchangeId: 0,
    symbol: pos.symbol,
    positionId: enginePositionId,
    // ProfitLockGuard accepts reasons matching CATASTROPHIC_REASON_PATTERNS
    // (incl. 'manual_override_'). This is the legitimate admin-bypass channel.
    reason: 'manual_override_lifecycle_test',
  };
  console.log(`[close] POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ json: body }),
  });
  const text = await res.text();
  console.log(`[close] response ${res.status}:\n${text}`);
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[close] failed:', e);
  process.exit(1);
});
