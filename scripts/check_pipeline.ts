import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check agentSignalLog for recent signals
  try {
    const cols = await db.execute(sql.raw(`SHOW COLUMNS FROM agentSignalLog`));
    const colRows = (cols as any)[0] || [];
    console.log('agentSignalLog columns:', colRows.map((r: any) => r.Field).join(', '));
    
    const data = await db.execute(sql.raw(`SELECT * FROM agentSignalLog ORDER BY createdAt DESC LIMIT 20`));
    const rows = (data as any)[0] || [];
    console.log(`\n=== AGENT SIGNAL LOG (${rows.length}) ===`);
    for (const r of rows) {
      const conf = parseFloat(r.confidence || '0');
      console.log(`  ${r.symbol} ${r.agentName}: ${r.signal} (${(conf * 100).toFixed(1)}%) | Quality: ${r.qualityScore || 'N/A'} | Exec: ${r.executionScore || 'N/A'} | ${r.createdAt}`);
    }
  } catch (e) {
    console.log('agentSignalLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check pipeline events table
  try {
    const tables = await db.execute(sql.raw(`SHOW TABLES LIKE '%pipeline%'`));
    const tableRows = (tables as any)[0] || [];
    console.log('\nPipeline tables:', tableRows.map((r: any) => Object.values(r)[0]));
    
    for (const t of tableRows) {
      const tableName = Object.values(t)[0] as string;
      try {
        const data = await db.execute(sql.raw(`SELECT * FROM \`${tableName}\` ORDER BY createdAt DESC LIMIT 10`));
        const rows = (data as any)[0] || [];
        console.log(`\n  ${tableName} (${rows.length}):`);
        for (const r of rows) {
          console.log(`    ${JSON.stringify(r).substring(0, 200)}`);
        }
      } catch {}
    }
  } catch (e) {
    console.log('Pipeline tables error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check trade decision tables
  try {
    const tables = await db.execute(sql.raw(`SHOW TABLES LIKE '%trade%'`));
    const tableRows = (tables as any)[0] || [];
    console.log('\nTrade tables:', tableRows.map((r: any) => Object.values(r)[0]));
    
    for (const t of tableRows) {
      const tableName = Object.values(t)[0] as string;
      if (tableName.includes('paper') || tableName.includes('Paper')) continue; // skip paperPositions
      try {
        const cols = await db.execute(sql.raw(`SHOW COLUMNS FROM \`${tableName}\``));
        const colRows = (cols as any)[0] || [];
        const hasCreatedAt = colRows.some((c: any) => c.Field === 'createdAt');
        const orderCol = hasCreatedAt ? 'createdAt' : 'id';
        const data = await db.execute(sql.raw(`SELECT * FROM \`${tableName}\` ORDER BY ${orderCol} DESC LIMIT 5`));
        const rows = (data as any)[0] || [];
        if (rows.length > 0) {
          console.log(`\n  ${tableName} (${rows.length}):`, Object.keys(rows[0]).join(', '));
          for (const r of rows) {
            console.log(`    ${JSON.stringify(r).substring(0, 250)}`);
          }
        }
      } catch {}
    }
  } catch (e) {
    console.log('Trade tables error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
