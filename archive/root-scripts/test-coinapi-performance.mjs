/**
 * CoinAPI WebSocket Performance Test
 * Measures trade update frequency and latency
 */

import WebSocket from 'ws';

const apiKey = process.env.COINAPI_KEY;
console.log('Testing CoinAPI WebSocket update frequency...');
console.log('API Key:', apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET');

if (!apiKey) {
  console.log('ERROR: COINAPI_KEY not set');
  process.exit(1);
}

const ws = new WebSocket('wss://ws.coinapi.io/v1/', {
  headers: { 'X-CoinAPI-Key': apiKey }
});

let messageCount = 0;
let tradeCount = 0;
let startTime = Date.now();
let lastTradeTime = 0;
let tradeIntervals = [];

ws.on('open', () => {
  console.log('✅ Connected to CoinAPI');
  ws.send(JSON.stringify({
    type: 'hello',
    apikey: apiKey,
    heartbeat: true,
    subscribe_data_type: ['trade'],
    subscribe_filter_symbol_id: ['COINBASE_SPOT_BTC_USD', 'COINBASE_SPOT_ETH_USD']
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  messageCount++;
  
  if (msg.type === 'trade') {
    tradeCount++;
    const now = Date.now();
    if (lastTradeTime > 0) {
      tradeIntervals.push(now - lastTradeTime);
    }
    lastTradeTime = now;
    console.log(`Trade #${tradeCount}: ${msg.symbol_id} @ $${msg.price.toFixed(2)} (interval: ${tradeIntervals.length > 0 ? tradeIntervals[tradeIntervals.length-1] : 0}ms)`);
  }
});

ws.on('error', (err) => {
  console.log('❌ Error:', err.message);
});

// Run for 15 seconds
setTimeout(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  const avgInterval = tradeIntervals.length > 0 ? (tradeIntervals.reduce((a,b) => a+b, 0) / tradeIntervals.length).toFixed(0) : 'N/A';
  const minInterval = tradeIntervals.length > 0 ? Math.min(...tradeIntervals) : 'N/A';
  const maxInterval = tradeIntervals.length > 0 ? Math.max(...tradeIntervals) : 'N/A';
  
  console.log('\n=== CoinAPI Performance Summary ===');
  console.log(`Duration: ${elapsed.toFixed(1)}s`);
  console.log(`Total messages: ${messageCount}`);
  console.log(`Trade messages: ${tradeCount}`);
  console.log(`Trades per second: ${(tradeCount / elapsed).toFixed(2)}`);
  console.log(`Avg interval between trades: ${avgInterval}ms`);
  console.log(`Min interval: ${minInterval}ms`);
  console.log(`Max interval: ${maxInterval}ms`);
  
  ws.close();
  process.exit(0);
}, 15000);
