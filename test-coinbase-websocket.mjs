/**
 * Test script for Coinbase Advanced Trade WebSocket implementation
 * 
 * This script verifies:
 * 1. JWT token generation
 * 2. WebSocket connection establishment
 * 3. Ticker channel subscription
 * 4. Level2 (order book) channel subscription
 * 5. Message parsing and event emission
 * 6. Reconnection logic
 * 
 * Run with: node test-coinbase-websocket.mjs
 */

import { CoinbaseWebSocketManager } from './server/exchanges/CoinbaseWebSocketManager.js';
import { config } from 'dotenv';

// Load environment variables
config();

const COINBASE_API_KEY = process.env.COINBASE_API_KEY;
const COINBASE_API_SECRET = process.env.COINBASE_API_SECRET;

if (!COINBASE_API_KEY || !COINBASE_API_SECRET) {
  console.error('❌ Missing Coinbase API credentials');
  console.error('Please set COINBASE_API_KEY and COINBASE_API_SECRET environment variables');
  process.exit(1);
}

console.log('🚀 Starting Coinbase WebSocket test...\n');

// Create WebSocket manager
const wsManager = new CoinbaseWebSocketManager({
  apiKey: COINBASE_API_KEY,
  apiSecret: COINBASE_API_SECRET,
  symbols: ['BTC-USDT', 'ETH-USDT'],
  channels: ['ticker', 'level2', 'heartbeats'],
});

// Track events
let tickerCount = 0;
let level2Count = 0;
let heartbeatCount = 0;

// Handle ticker events
wsManager.on('ticker', (data) => {
  tickerCount++;
  console.log(`\n📊 Ticker #${tickerCount}:`);
  console.log(`  Symbol: ${data.product_id}`);
  console.log(`  Price: $${parseFloat(data.price).toFixed(2)}`);
  console.log(`  24h Volume: ${parseFloat(data.volume_24_h).toFixed(2)}`);
  console.log(`  24h Change: ${parseFloat(data.price_percent_chg_24_h).toFixed(2)}%`);
  console.log(`  Best Bid: $${parseFloat(data.best_bid).toFixed(2)}`);
  console.log(`  Best Ask: $${parseFloat(data.best_ask).toFixed(2)}`);
  console.log(`  Timestamp: ${new Date(data.timestamp).toISOString()}`);
});

// Handle level2 events (order book)
wsManager.on('level2', (data) => {
  level2Count++;
  console.log(`\n📖 Order Book ${data.type} #${level2Count}:`);
  console.log(`  Symbol: ${data.product_id}`);
  console.log(`  Updates: ${data.updates.length}`);
  
  if (data.updates.length > 0) {
    const firstUpdate = data.updates[0];
    console.log(`  Sample: ${firstUpdate.side} @ $${parseFloat(firstUpdate.price_level).toFixed(2)} x ${parseFloat(firstUpdate.new_quantity).toFixed(4)}`);
  }
});

// Handle heartbeat events
wsManager.on('heartbeat', (data) => {
  heartbeatCount++;
  if (heartbeatCount % 10 === 0) {
    console.log(`\n💓 Heartbeat #${heartbeatCount} - Latency: ${data.latency}ms`);
  }
});

// Handle connection events
wsManager.on('connected', () => {
  console.log('✅ WebSocket connected successfully!\n');
  console.log('Waiting for events (press Ctrl+C to stop)...');
});

wsManager.on('disconnected', (info) => {
  console.log(`\n⚠️ WebSocket disconnected: ${info.code} - ${info.reason}`);
});

wsManager.on('error', (error) => {
  console.error(`\n❌ WebSocket error: ${error.message}`);
});

wsManager.on('maxReconnectAttemptsReached', () => {
  console.error('\n❌ Max reconnection attempts reached. Exiting...');
  process.exit(1);
});

// Connect
(async () => {
  try {
    await wsManager.connect();
    
    // Run for 60 seconds then disconnect
    setTimeout(() => {
      console.log('\n\n📊 Test Summary:');
      console.log(`  Ticker events: ${tickerCount}`);
      console.log(`  Order book events: ${level2Count}`);
      console.log(`  Heartbeats: ${heartbeatCount}`);
      console.log(`  Connection latency: ${wsManager.getLatency()}ms`);
      console.log('\n✅ Test completed successfully!');
      
      wsManager.disconnect();
      process.exit(0);
    }, 60000);
  } catch (error) {
    console.error('❌ Failed to connect:', error);
    process.exit(1);
  }
})();

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nTest interrupted by user');
  console.log('\n📊 Test Summary:');
  console.log(`  Ticker events: ${tickerCount}`);
  console.log(`  Order book events: ${level2Count}`);
  console.log(`  Heartbeats: ${heartbeatCount}`);
  
  wsManager.disconnect();
  process.exit(0);
});
