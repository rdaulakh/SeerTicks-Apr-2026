import { getSEERMultiEngine } from '../server/seerMainMulti';

async function startEngine() {
  console.log('Starting SEER Trading Engine for user 1...');
  
  try {
    const engine = await getSEERMultiEngine(1);
    console.log('Engine instance obtained');
    
    await engine.start();
    console.log('Engine started successfully!');
    
    const status = engine.getStatus();
    console.log('Engine status:', JSON.stringify(status, null, 2));
    
    // Keep the process running to monitor
    console.log('\nEngine is now running. Monitoring for 60 seconds...');
    
    // Listen for events
    engine.on('recommendation', (rec: any) => {
      console.log('\n📊 RECOMMENDATION:', JSON.stringify(rec, null, 2));
    });
    
    engine.on('position', (pos: any) => {
      console.log('\n💰 POSITION:', JSON.stringify(pos, null, 2));
    });
    
    engine.on('agent_signals', (signals: any) => {
      console.log('\n🤖 AGENT SIGNALS:', signals.symbol, '- Agents:', signals.signals?.length || 0);
    });
    
    engine.on('tick', (tick: any) => {
      console.log('\n⏱️ TICK:', tick.tickCount);
    });
    
    // Wait 60 seconds then show final status
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    const finalStatus = engine.getStatus();
    console.log('\n\n=== FINAL STATUS AFTER 60 SECONDS ===');
    console.log(JSON.stringify(finalStatus, null, 2));
    
  } catch (error) {
    console.error('Error starting engine:', error);
  }
}

startEngine();
