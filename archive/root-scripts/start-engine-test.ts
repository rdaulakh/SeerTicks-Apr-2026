import { getSEERMultiEngine } from './server/seerMainMulti';

async function startEngine() {
  console.log('\n=== STARTING SEER ENGINE ===\n');
  
  const userId = 1; // Default user
  const engine = await getSEERMultiEngine(userId);
  
  console.log('Engine instance created, starting...');
  await engine.start();
  
  console.log('\n✅ Engine started successfully!');
  console.log('Waiting 15 seconds for candle cache to populate...\n');
  
  // Wait for cache to populate
  await new Promise(resolve => setTimeout(resolve, 15000));
  
  console.log('\n=== ENGINE START COMPLETE ===\n');
  process.exit(0);
}

startEngine().catch(err => {
  console.error('❌ Failed to start engine:', err);
  process.exit(1);
});
