import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OnChainFlowAnalyst } from '../OnChainFlowAnalyst';
import { VolumeProfileAnalyzer } from '../VolumeProfileAnalyzer';

/**
 * Integration flag: set INTEGRATION_TEST=1 to run tests that require external APIs.
 * In unit test mode, OnChainFlowAnalyst tests are skipped because agent.start()
 * connects to blockchain APIs that may be unreachable in CI/sandbox environments.
 */
const isIntegration = process.env.INTEGRATION_TEST === '1';

describe.skipIf(!isIntegration)('OnChainFlowAnalyst (integration)', () => {
  let agent: OnChainFlowAnalyst;

  beforeAll(async () => {
    agent = new OnChainFlowAnalyst();
    await agent.start();
  }, 60000);

  afterAll(async () => {
    await agent.stop();
  });

  it('should initialize correctly', () => {
    expect(agent).toBeDefined();
    const health = agent.getHealth();
    expect(health.agentName).toBe('OnChainFlowAnalyst');
    expect(health.status).toBe('healthy');
  });

  it('should generate signal for BTC', async () => {
    const signal = await agent.generateSignal('BTCUSDT');
    
    expect(signal).toBeDefined();
    expect(signal.agentName).toBe('OnChainFlowAnalyst');
    expect(signal.symbol).toBe('BTCUSDT');
    expect(['bullish', 'bearish', 'neutral']).toContain(signal.signal);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.executionScore).toBeGreaterThanOrEqual(0);
    expect(signal.executionScore).toBeLessThanOrEqual(100);
    expect(signal.reasoning).toBeTruthy();
  });

  it('should include flow analysis in evidence', async () => {
    const signal = await agent.generateSignal('ETHUSDT');
    
    expect(signal.evidence).toBeDefined();
    expect(['inflow', 'outflow', 'balanced']).toContain(signal.evidence.flowDirection);
    expect(['extreme', 'large', 'moderate', 'small']).toContain(signal.evidence.flowMagnitude);
    expect(['accumulation', 'distribution', 'neutral']).toContain(signal.evidence.trend);
  });

  it('should use deterministic fallback when no price data', async () => {
    const signal = await agent.generateSignal('UNKNOWNUSDT');
    
    expect(signal).toBeDefined();
    expect(signal.signal).toBeDefined();
    expect(['bullish', 'bearish', 'neutral']).toContain(signal.signal);
  });

  it('should update price and use it in analysis', async () => {
    agent.setCurrentPrice(95000);
    const signal = await agent.generateSignal('BTCUSDT');
    
    expect(signal).toBeDefined();
    expect(signal.processingTime).toBeGreaterThanOrEqual(0);
  });
});

describe('OnChainFlowAnalyst (unit)', () => {
  it('should instantiate without errors', () => {
    const agent = new OnChainFlowAnalyst();
    expect(agent).toBeDefined();
  });

  it('should have correct agent name', () => {
    const agent = new OnChainFlowAnalyst();
    const health = agent.getHealth();
    expect(health.agentName).toBe('OnChainFlowAnalyst');
  });
});

describe('VolumeProfileAnalyzer', () => {
  let agent: VolumeProfileAnalyzer;

  beforeAll(async () => {
    agent = new VolumeProfileAnalyzer();
    await agent.start();
  });

  afterAll(async () => {
    await agent.stop();
  });

  it('should initialize correctly', () => {
    expect(agent).toBeDefined();
    const health = agent.getHealth();
    expect(health.agentName).toBe('VolumeProfileAnalyzer');
    expect(health.status).toBe('healthy');
  });

  it('should return valid signal without exchange data', async () => {
    // Without exchange set, agent may use LLM fallback which can return any direction
    const signal = await agent.generateSignal('BTCUSDT');
    
    expect(signal).toBeDefined();
    expect(signal.agentName).toBe('VolumeProfileAnalyzer');
    expect(['bullish', 'bearish', 'neutral']).toContain(signal.signal);
  }, 30000);

  it('should calculate VWAP proximity score', () => {
    const score1 = agent.getVWAPProximityScore(100, 100, 5); // At VWAP
    expect(score1).toBe(100);

    const score2 = agent.getVWAPProximityScore(105, 100, 5); // 1 std dev away
    expect(score2).toBeGreaterThanOrEqual(60);

    const score3 = agent.getVWAPProximityScore(110, 100, 5); // 2 std dev away
    expect(score3).toBeLessThanOrEqual(40);

    const score4 = agent.getVWAPProximityScore(115, 100, 5); // 3 std dev away
    expect(score4).toBeLessThanOrEqual(20);
  });

  it('should handle zero std dev gracefully', () => {
    const score = agent.getVWAPProximityScore(100, 100, 0);
    expect(score).toBe(50);
  });
});

describe('Agent Integration', () => {
  it('should export agents from index', async () => {
    const { 
      OnChainFlowAnalyst, 
      onChainFlowAnalyst,
      VolumeProfileAnalyzer,
      volumeProfileAnalyzer 
    } = await import('../index');
    
    expect(OnChainFlowAnalyst).toBeDefined();
    expect(onChainFlowAnalyst).toBeDefined();
    expect(VolumeProfileAnalyzer).toBeDefined();
    expect(volumeProfileAnalyzer).toBeDefined();
  });

  it('should have all Phase 2 agents exported', async () => {
    const { 
      WhaleTracker,
      FundingRateAnalyst,
      LiquidationHeatmap,
      OnChainFlowAnalyst,
      VolumeProfileAnalyzer
    } = await import('../index');
    
    expect(WhaleTracker).toBeDefined();
    expect(FundingRateAnalyst).toBeDefined();
    expect(LiquidationHeatmap).toBeDefined();
    expect(OnChainFlowAnalyst).toBeDefined();
    expect(VolumeProfileAnalyzer).toBeDefined();
  });
});
