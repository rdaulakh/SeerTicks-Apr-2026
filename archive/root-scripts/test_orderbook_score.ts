import { OrderFlowAnalyst } from './server/agents/OrderFlowAnalyst';

async function test() {
  const agent = new OrderFlowAnalyst();
  await agent.start();
  
  const orderBook = {
    symbol: 'BTCUSDT',
    bids: [] as [number, number][],
    asks: [] as [number, number][],
    timestamp: Date.now(),
  };
  
  // Create bullish order book (60% bid, 40% ask)
  const midPrice = 98000;
  for (let i = 0; i < 20; i++) {
    orderBook.bids.push([midPrice - i * 10, 30]); // 600 total
    orderBook.asks.push([midPrice + i * 10, 20]); // 400 total
  }
  
  // Add large buy order
  orderBook.bids.push([97900, 50]);
  orderBook.bids.sort((a, b) => b[0] - a[0]);
  
  (agent as any).updateOrderBook('BTCUSDT', orderBook);
  (agent as any).setCurrentPrice(98000);
  
  const signal = await agent.analyze('BTCUSDT');
  
  console.log('Signal:', signal.signal);
  console.log('Confidence:', (signal.confidence * 100).toFixed(1) + '%');
  console.log('Evidence:', JSON.stringify(signal.evidence, null, 2));
  
  await agent.stop();
}

test();
