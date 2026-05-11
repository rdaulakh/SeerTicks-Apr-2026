import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getActiveClock } from '../../_core/clock';
import { OrderFlowAnalyst } from '../OrderFlowAnalyst';
import { CoinbaseAdapter } from '../../exchanges/CoinbaseAdapter';
import { ENV } from '../../_core/env';

/**
 * Integration flag: set INTEGRATION_TEST=1 to run tests that require Coinbase API credentials.
 */
const hasCredentials = !!(process.env.COINBASE_API_KEY || ENV.coinbaseApiKey);
const isIntegration = process.env.INTEGRATION_TEST === '1' && hasCredentials;

describe.skipIf(!isIntegration)('OrderFlowAnalyst Signal Generation (integration)', () => {
  let agent: OrderFlowAnalyst;
  let exchange: CoinbaseAdapter;

  beforeAll(async () => {
    agent = new OrderFlowAnalyst();
    
    const apiKey = process.env.COINBASE_API_KEY || ENV.coinbaseApiKey;
    const apiSecret = process.env.COINBASE_API_SECRET || ENV.coinbaseApiSecret;
    
    exchange = new CoinbaseAdapter(apiKey!, apiSecret!);
    agent.setExchange(exchange);
    await agent.start();
  });

  afterAll(async () => {
    await agent.stop();
  });

  it('should generate signals with order book data', async () => {
    const symbol = 'BTC-USD';
    agent.setCurrentPrice(95000);
    
    const signal = await agent.generateSignal(symbol);
    
    expect(signal).toBeDefined();
    expect(signal.agentName).toBe('OrderFlowAnalyst');
    expect(signal.symbol).toBe(symbol);
    expect(['buy', 'sell', 'neutral']).toContain(signal.signal);
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.reasoning).toBeTruthy();
    
    expect(signal.evidence).toBeDefined();
    expect(signal.evidence.bidVolume).toBeGreaterThan(0);
    expect(signal.evidence.askVolume).toBeGreaterThan(0);
  }, 30000);

  it('should generate signals quickly (< 500ms)', async () => {
    const symbol = 'BTC-USD';
    agent.setCurrentPrice(95000);
    
    const startTime = getActiveClock().now();
    const signal = await agent.generateSignal(symbol);
    const duration = getActiveClock().now() - startTime;
    
    expect(duration).toBeLessThan(500);
    expect(signal.reasoning).not.toBe('No order book data available');
  }, 30000);

  it('should detect order book imbalance', async () => {
    const symbol = 'BTC-USD';
    agent.setCurrentPrice(95000);
    
    const signal = await agent.generateSignal(symbol);
    
    expect(signal.evidence).toBeDefined();
    expect(signal.evidence.orderBookScore).toBeDefined();
    expect(typeof signal.evidence.orderBookScore).toBe('number');
    expect(signal.evidence.orderBookScore).toBeGreaterThanOrEqual(-100);
    expect(signal.evidence.orderBookScore).toBeLessThanOrEqual(100);
  }, 30000);
});

describe('OrderFlowAnalyst (unit)', () => {
  it('should instantiate without errors', () => {
    const agent = new OrderFlowAnalyst();
    expect(agent).toBeDefined();
  });

  it('should have correct agent name', () => {
    const agent = new OrderFlowAnalyst();
    const health = agent.getHealth();
    expect(health.agentName).toBe('OrderFlowAnalyst');
  });

  it('should accept price updates', () => {
    const agent = new OrderFlowAnalyst();
    agent.setCurrentPrice(95000);
    // Should not throw
    expect(true).toBe(true);
  });

  it('should generate fallback signal without exchange', async () => {
    const agent = new OrderFlowAnalyst();
    await agent.start();
    
    const signal = await agent.generateSignal('BTC-USD');
    
    expect(signal).toBeDefined();
    expect(signal.agentName).toBe('OrderFlowAnalyst');
    expect(['bullish', 'bearish', 'neutral', 'buy', 'sell']).toContain(signal.signal);
    
    await agent.stop();
  }, 10000);
});
