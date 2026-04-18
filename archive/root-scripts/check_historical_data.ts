import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

async function checkHistoricalData() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  
  console.log('\n=== Historical Candles Summary ===\n');
  
  const [rows] = await connection.query(`
    SELECT 
      \`symbol\`, 
      \`interval\`, 
      COUNT(*) as candle_count, 
      MIN(\`timestamp\`) as earliest, 
      MAX(\`timestamp\`) as latest,
      DATEDIFF(MAX(\`timestamp\`), MIN(\`timestamp\`)) as days_of_data
    FROM historicalCandles 
    GROUP BY \`symbol\`, \`interval\` 
    ORDER BY \`symbol\`, \`interval\`
  `);
  
  console.table(rows);
  
  // Check if we have BTC data
  const btcData = (rows as any[]).filter((row: any) => row.symbol === 'BTCUSDT');
  console.log(`\n✅ BTCUSDT data available: ${btcData.length > 0 ? 'YES' : 'NO'}`);
  
  if (btcData.length > 0) {
    console.log('\nBTCUSDT intervals:', btcData.map((r: any) => r.interval).join(', '));
    console.log('Total BTC candles:', btcData.reduce((sum: number, r: any) => sum + Number(r.candle_count), 0));
  }
  
  await connection.end();
}

checkHistoricalData().catch(console.error).finally(() => process.exit(0));
