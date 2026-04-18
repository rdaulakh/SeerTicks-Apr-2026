import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check tradeExecutionLog
  try {
    const cols = await db.execute(sql.raw(`SHOW COLUMNS FROM tradeExecutionLog`));
    const colRows = (cols as any)[0] || [];
    console.log('tradeExecutionLog columns:', colRows.map((r: any) => r.Field).join(', '));
    
    const data = await db.execute(sql.raw(`SELECT * FROM tradeExecutionLog ORDER BY createdAt DESC LIMIT 10`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== TRADE EXECUTION LOG (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.side || r.action} | Price: ${r.price || r.entryPrice} | Status: ${r.status || r.result} | ${r.error || ''} | ${r.createdAt}`);
    }
  } catch (e) {
    console.log('tradeExecutionLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check ALL paperPositions created after restart (21:11)
  try {
    const data = await db.execute(sql.raw(`
      SELECT id, symbol, side, status, entryPrice, currentPrice, exitPrice, exitReason, realizedPnl, createdAt, updatedAt
      FROM paperPositions 
      WHERE createdAt > '2026-03-09 21:10:00'
      ORDER BY createdAt DESC LIMIT 20
    `));
    const rows = (data as any)[0] || [];
    console.log(`\n=== PAPER POSITIONS AFTER RESTART (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.id}: ${r.symbol} ${r.side} ${r.status} | Entry: $${r.entryPrice} | Exit: $${r.exitPrice || 'N/A'} | P&L: $${r.realizedPnl || '0'} | ${r.exitReason || 'OPEN'} | Created: ${r.createdAt}`);
    }
  } catch (e) {
    console.log('paperPositions error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check preTradeValidations
  try {
    const data = await db.execute(sql.raw(`SELECT * FROM preTradeValidations ORDER BY createdAt DESC LIMIT 5`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== PRE-TRADE VALIDATIONS (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${JSON.stringify(r).substring(0, 250)}`);
    }
  } catch (e) {
    console.log('preTradeValidations error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check automatedTradeLog
  try {
    const data = await db.execute(sql.raw(`SELECT * FROM automatedTradeLog ORDER BY createdAt DESC LIMIT 10`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== AUTOMATED TRADE LOG (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol} ${r.action || r.side} | Status: ${r.status} | ${r.reason || r.error || ''} | ${r.createdAt}`);
    }
  } catch (e) {
    console.log('automatedTradeLog error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
