import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const db = drizzle(process.env.DATABASE_URL!);

async function audit() {
  console.log("=== POSITIONS SUMMARY ===");
  const summary = await db.execute(sql`
    SELECT status, COUNT(*) as cnt, 
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 4) as avgPnl,
      ROUND(MIN(CAST(realizedPnl AS DECIMAL(20,6))), 4) as worstPnl,
      ROUND(MAX(CAST(realizedPnl AS DECIMAL(20,6))), 4) as bestPnl
    FROM paperPositions GROUP BY status
  `);
  console.table(summary[0]);

  console.log("\n=== WIN/LOSS BREAKDOWN ===");
  const winloss = await db.execute(sql`
    SELECT 
      CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 'WIN' 
           WHEN CAST(realizedPnl AS DECIMAL(20,6)) < 0 THEN 'LOSS' 
           ELSE 'BREAKEVEN' END as result,
      COUNT(*) as cnt,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 4) as avgPnl
    FROM paperPositions WHERE status = 'closed' GROUP BY result
  `);
  console.table(winloss[0]);

  console.log("\n=== LAST 30 CLOSED POSITIONS ===");
  const closed = await db.execute(sql`
    SELECT id, symbol, side, 
      ROUND(CAST(entryPrice AS DECIMAL(20,4)), 2) as entry,
      ROUND(CAST(exitPrice AS DECIMAL(20,4)), 2) as exit_p,
      ROUND(CAST(quantity AS DECIMAL(20,8)), 6) as qty,
      ROUND(CAST(realizedPnl AS DECIMAL(20,6)), 4) as pnl,
      ROUND(CAST(stopLoss AS DECIMAL(20,4)), 2) as sl,
      ROUND(CAST(takeProfit AS DECIMAL(20,4)), 2) as tp,
      exitReason,
      createdAt, exitTime
    FROM paperPositions WHERE status = 'closed' 
    ORDER BY exitTime DESC LIMIT 30
  `);
  console.table(closed[0]);

  console.log("\n=== OPEN POSITIONS ===");
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
  console.table(open[0]);

  console.log("\n=== EXIT REASON ANALYSIS ===");
  const exits = await db.execute(sql`
    SELECT exitReason, COUNT(*) as cnt,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 4) as avgPnl,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) < 0 THEN 1 ELSE 0 END) as losses
    FROM paperPositions WHERE status = 'closed' GROUP BY exitReason ORDER BY cnt DESC
  `);
  console.table(exits[0]);

  console.log("\n=== DIRECTION BIAS ===");
  const bias = await db.execute(sql`
    SELECT side, COUNT(*) as total,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) < 0 THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 4) as avgPnl
    FROM paperPositions WHERE status = 'closed' GROUP BY side
  `);
  console.table(bias[0]);

  console.log("\n=== SYMBOL BREAKDOWN ===");
  const symbols = await db.execute(sql`
    SELECT symbol, COUNT(*) as total,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN CAST(realizedPnl AS DECIMAL(20,6)) < 0 THEN 1 ELSE 0 END) as losses,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl,
      ROUND(AVG(CAST(realizedPnl AS DECIMAL(20,6))), 4) as avgPnl
    FROM paperPositions WHERE status = 'closed' GROUP BY symbol
  `);
  console.table(symbols[0]);

  console.log("\n=== PORTFOLIO BALANCE ===");
  const portfolio = await db.execute(sql`
    SELECT * FROM paperPortfolio ORDER BY updatedAt DESC LIMIT 3
  `);
  console.table(portfolio[0]);

  console.log("\n=== HOLD TIME: WINNERS vs LOSERS ===");
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
  console.table(holdTime[0]);

  console.log("\n=== RECENT AUTOMATED TRADE LOG (last 20) ===");
  const tradeLogs = await db.execute(sql`
    SELECT id, symbol, side as dir, action, status, 
      ROUND(CAST(signalConfidence AS DECIMAL(10,4)), 4) as confidence,
      ROUND(CAST(consensusScore AS DECIMAL(10,4)), 4) as consensus,
      rejectionReason,
      createdAt
    FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 20
  `);
  console.table(tradeLogs[0]);

  console.log("\n=== SL/TP DISTANCE ANALYSIS ===");
  const sltp = await db.execute(sql`
    SELECT 
      symbol, side,
      ROUND(AVG(ABS(CAST(stopLoss AS DECIMAL(20,4)) - CAST(entryPrice AS DECIMAL(20,4))) / CAST(entryPrice AS DECIMAL(20,4)) * 100), 3) as avgSlPct,
      ROUND(AVG(ABS(CAST(takeProfit AS DECIMAL(20,4)) - CAST(entryPrice AS DECIMAL(20,4))) / CAST(entryPrice AS DECIMAL(20,4)) * 100), 3) as avgTpPct,
      COUNT(*) as cnt
    FROM paperPositions 
    WHERE status = 'closed' AND stopLoss IS NOT NULL AND takeProfit IS NOT NULL
    GROUP BY symbol, side
  `);
  console.table(sltp[0]);

  // 12. Check if TP was ever hit vs SL
  console.log("\n=== TP HIT vs SL HIT (closed positions) ===");
  const tpsl = await db.execute(sql`
    SELECT 
      CASE 
        WHEN exitReason LIKE '%take_profit%' OR exitReason LIKE '%tp%' OR exitReason LIKE '%TP%' THEN 'TP_HIT'
        WHEN exitReason LIKE '%stop_loss%' OR exitReason LIKE '%sl%' OR exitReason LIKE '%SL%' THEN 'SL_HIT'
        ELSE exitReason
      END as exit_type,
      COUNT(*) as cnt,
      ROUND(SUM(CAST(realizedPnl AS DECIMAL(20,6))), 4) as totalPnl
    FROM paperPositions WHERE status = 'closed'
    GROUP BY exit_type ORDER BY cnt DESC
  `);
  console.table(tpsl[0]);

  process.exit(0);
}

audit().catch(e => { console.error(e); process.exit(1); });
