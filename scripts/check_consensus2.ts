import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Check consensusHistory
  try {
    const cols = await db.execute(sql`SHOW COLUMNS FROM consensusHistory`);
    const colRows = (cols as any)[0] || [];
    console.log('consensusHistory columns:', colRows.map((r: any) => r.Field).join(', '));
    
    const data = await db.execute(sql`
      SELECT * FROM consensusHistory 
      ORDER BY createdAt DESC LIMIT 20
    `);
    const rows = (data as any)[0] || [];
    console.log(`\n=== CONSENSUS HISTORY (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol || 'N/A'} | Dir: ${r.netDirection || r.direction || 'N/A'} | Conf: ${r.consensusConfidence || r.confidence || 'N/A'} | Meets: ${r.meetsThreshold || 'N/A'} | Created: ${r.createdAt}`);
    }
  } catch (e) {
    console.log('consensusHistory error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check consensusLog
  try {
    const cols = await db.execute(sql`SHOW COLUMNS FROM consensusLog`);
    const colRows = (cols as any)[0] || [];
    console.log('\nconsensusLog columns:', colRows.map((r: any) => r.Field).join(', '));
    
    const data = await db.execute(sql`
      SELECT * FROM consensusLog 
      ORDER BY createdAt DESC LIMIT 20
    `);
    const rows = (data as any)[0] || [];
    console.log(`\n=== CONSENSUS LOG (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.symbol || 'N/A'} | Dir: ${r.netDirection || r.direction || 'N/A'} | Conf: ${r.consensusConfidence || r.confidence || 'N/A'} | Meets: ${r.meetsThreshold || 'N/A'} | Created: ${r.createdAt}`);
    }
  } catch (e) {
    console.log('consensusLog error:', (e as Error).message?.substring(0, 200));
  }
  
  // Check agent_signals or similar
  try {
    const tables = await db.execute(sql`SHOW TABLES LIKE '%signal%'`);
    const tableRows = (tables as any)[0] || [];
    console.log('\nSignal tables:', tableRows.map((r: any) => Object.values(r)[0]));
    
    for (const t of tableRows) {
      const tableName = Object.values(t)[0] as string;
      try {
        const data = await db.execute(sql.raw(`SELECT * FROM \`${tableName}\` ORDER BY createdAt DESC LIMIT 5`));
        const rows = (data as any)[0] || [];
        if (rows.length > 0) {
          console.log(`\n  ${tableName} (${rows.length} recent):`, Object.keys(rows[0]).join(', '));
          for (const r of rows) {
            const conf = r.confidence || r.consensusConfidence || 'N/A';
            console.log(`    ${r.symbol || 'N/A'} ${r.signal || r.direction || 'N/A'} | Conf: ${conf} | ${r.agentName || ''}`);
          }
        }
      } catch {}
    }
  } catch (e) {
    console.log('Signal tables error:', (e as Error).message?.substring(0, 200));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
