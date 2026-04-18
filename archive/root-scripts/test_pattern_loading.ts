import { getValidatedPatterns } from './server/db/patternQueries';

async function testPatternLoading() {
  console.log('=== TESTING PATTERN LOADING ===\n');
  
  // Test 1: Load patterns with 50% threshold
  console.log('Test 1: Loading patterns with winRate >= 0.50');
  const patterns50 = await getValidatedPatterns(0.50);
  console.log(`Found ${patterns50.length} patterns`);
  
  if (patterns50.length > 0) {
    console.log('\nSample patterns:');
    patterns50.slice(0, 5).forEach(p => {
      console.log(`  - ${p.patternName} (${p.symbol}, ${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, PF=${p.profitFactor.toFixed(2)}`);
    });
  }
  
  // Test 2: Load patterns with 55% threshold
  console.log('\n\nTest 2: Loading patterns with winRate >= 0.55');
  const patterns55 = await getValidatedPatterns(0.55);
  console.log(`Found ${patterns55.length} patterns`);
  
  if (patterns55.length > 0) {
    console.log('\nSample patterns:');
    patterns55.slice(0, 5).forEach(p => {
      console.log(`  - ${p.patternName} (${p.symbol}, ${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%, PF=${p.profitFactor.toFixed(2)}`);
    });
  }
  
  // Test 3: Check specific pattern
  console.log('\n\nTest 3: Looking for "Double Bottom" pattern on any symbol');
  const doubleBottoms = patterns50.filter(p => p.patternName === 'Double Bottom');
  console.log(`Found ${doubleBottoms.length} Double Bottom patterns`);
  doubleBottoms.forEach(p => {
    console.log(`  - ${p.patternName} (${p.symbol}, ${p.timeframe}): WR=${(p.winRate * 100).toFixed(1)}%`);
  });
  
  console.log('\n=== TEST COMPLETE ===');
  process.exit(0);
}

testPatternLoading();
