import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
const db = drizzle(process.env.DATABASE_URL!);

async function main() {
  const exits = await db.execute(sql`
    SELECT 
      CASE 
        WHEN exitReason LIKE 'Confidence decay%' THEN 'CONFIDENCE_DECAY'
        WHEN exitReason LIKE 'Breakeven exit%' THEN 'BREAKEVEN_EXIT'
        WHEN exitReason LIKE 'Partial profit%' THEN 'PARTIAL_PROFIT'
        WHEN exitReason LIKE '%STOP_LOSS%' OR exitReason LIKE '%stop_loss%' THEN 'STOP_LOSS'
        WHEN exitReason LIKE '%TAKE_PROFIT%' OR exitReason LIKE '%take_profit%' THEN 'TAKE_PROFIT'
        WHEN exitReason LIKE '%PROFIT_TARGET%' THEN 'PROFIT_TARGET'
        WHEN exitReason LIKE 'Trailing stop%' THEN 'TRAILING_STOP'
        WHEN exitReason LIKE '%regime%' OR exitReason LIKE '%Regime%' THEN 'REGIME_EXIT'
        WHEN exitReason LIKE 'Signal reversal%' THEN 'SIGNAL_REVERSAL'
        WHEN exitReason LIKE 'Time-based%' THEN 'TIME_EXIT'
        ELSE COALESCE(LEFT(exitReason, 50), 'NULL')
      END as exit_type,
      COUNT(*) as cnt,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 2) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 2) as avgPnl,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) < 0 THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) = 0 THEN 1 ELSE 0 END) as breakeven
    FROM paperPositions WHERE status = 'closed'
    GROUP BY exit_type ORDER BY cnt DESC
  `);
  console.log('=== EXIT REASON ANALYSIS (GROUPED) ===');
  console.table(exits[0]);

  const sltp = await db.execute(sql`
    SELECT 
      symbol, side,
      ROUND(AVG(ABS(CAST(stopLoss AS DECIMAL(20,4)) - CAST(entryPrice AS DECIMAL(20,4))) / CAST(entryPrice AS DECIMAL(20,4)) * 100), 3) as avgSlPct,
      ROUND(AVG(ABS(CAST(takeProfit AS DECIMAL(20,4)) - CAST(entryPrice AS DECIMAL(20,4))) / CAST(entryPrice AS DECIMAL(20,4)) * 100), 3) as avgTpPct,
      COUNT(*) as cnt
    FROM paperPositions 
    WHERE status = 'closed' AND stopLoss IS NOT NULL AND takeProfit IS NOT NULL
      AND CAST(stopLoss AS DECIMAL(20,4)) > 0 AND CAST(takeProfit AS DECIMAL(20,4)) > 0
    GROUP BY symbol, side
  `);
  console.log('\n=== SL/TP DISTANCE ANALYSIS ===');
  console.table(sltp[0]);

  const holdTime = await db.execute(sql`
    SELECT 
      CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 'WIN' ELSE 'LOSS' END as result,
      COUNT(*) as cnt,
      ROUND(AVG(TIMESTAMPDIFF(MINUTE, createdAt, exitTime)), 1) as avgMinutes,
      ROUND(MIN(TIMESTAMPDIFF(MINUTE, createdAt, exitTime)), 1) as minMinutes,
      ROUND(MAX(TIMESTAMPDIFF(MINUTE, createdAt, exitTime)), 1) as maxMinutes
    FROM paperPositions 
    WHERE status = 'closed' AND exitTime IS NOT NULL AND realizedPnl IS NOT NULL
      AND CAST(realizedPnl AS DECIMAL(20,6)) != 0
    GROUP BY result
  `);
  console.log('\n=== HOLD TIME: WINNERS vs LOSERS ===');
  console.table(holdTime[0]);

  const open = await db.execute(sql`
    SELECT id, symbol, side, 
      ROUND(CAST(entryPrice AS DECIMAL(20,4)), 2) as entry,
      ROUND(CAST(currentPrice AS DECIMAL(20,4)), 2) as current_p,
      ROUND(CAST(quantity AS DECIMAL(20,8)), 6) as qty,
      ROUND(CAST(unrealizedPnL AS DECIMAL(20,6)), 4) as unrealPnl,
      ROUND(CAST(stopLoss AS DECIMAL(20,4)), 2) as sl,
      ROUND(CAST(takeProfit AS DECIMAL(20,4)), 2) as tp,
      createdAt
    FROM paperPositions WHERE status = 'open' ORDER BY createdAt DESC
  `);
  console.log('\n=== OPEN POSITIONS ===');
  console.table(open[0]);

  const tradeLogs = await db.execute(sql`
    SELECT id, symbol, side as dir, action, status, 
      ROUND(CAST(signalConfidence AS DECIMAL(10,4)), 4) as confidence,
      ROUND(CAST(consensusScore AS DECIMAL(10,4)), 4) as consensus,
      LEFT(rejectionReason, 60) as rejReason,
      createdAt
    FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 15
  `);
  console.log('\n=== RECENT AUTOMATED TRADE LOG ===');
  console.table(tradeLogs[0]);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
