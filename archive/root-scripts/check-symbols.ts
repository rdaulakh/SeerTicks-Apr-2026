import { getAllActiveTradingSymbols } from './server/exchangeDb';

async function checkSymbols() {
  const userId = 1; // Assuming default user
  const symbols = await getAllActiveTradingSymbols(userId);
  
  console.log('\n=== ACTIVE TRADING SYMBOLS ===');
  console.log(`Total: ${symbols.length}\n`);
  
  for (const sym of symbols) {
    console.log(`${sym.exchangeName}: ${sym.symbol} (${sym.enabled ? 'ENABLED' : 'DISABLED'})`);
  }
  
  console.log('\n=== END ===\n');
}

checkSymbols().catch(console.error);
