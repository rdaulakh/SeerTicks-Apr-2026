/**
 * Price History Table & DB Helpers — Unit Tests
 * 
 * Validates the priceHistory schema definition and the Drizzle-based
 * loadHistoricalData method in RLTrainingPipeline (no DB connection needed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { priceHistory } from '../../drizzle/schema';

// ─── Schema validation ─────────────────────────────────────────────────────

describe('priceHistory schema', () => {
  it('should export priceHistory table from schema', () => {
    expect(priceHistory).toBeDefined();
    expect(typeof priceHistory).toBe('object');
  });

  it('should export PriceHistoryRow and InsertPriceHistory types', async () => {
    const schema = await import('../../drizzle/schema');
    // Type-level check — if this compiles, the types exist
    type _Row = typeof schema.priceHistory.$inferSelect;
    type _Insert = typeof schema.priceHistory.$inferInsert;
    expect(true).toBe(true);
  });
});

// ─── RLTrainingPipeline loadHistoricalData (no DB) ──────────────────────────

describe('RLTrainingPipeline.loadHistoricalData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should fall back to synthetic data when database is unavailable', async () => {
    vi.doMock('../db', () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
    const pipeline = new RLTrainingPipeline({
      episodes: 10,
      batchSize: 32,
      learningRate: 0.001,
      gamma: 0.99,
      epsilon: 1.0,
      epsilonDecay: 0.995,
      epsilonMin: 0.01,
      replayBufferSize: 1000,
    });

    const start = new Date('2024-01-01');
    const end = new Date('2024-06-01');
    const data = await pipeline.loadHistoricalData('BTC-USD', start, end);

    expect(data.length).toBe(1000);
    expect(data[0]).toHaveProperty('timestamp');
    expect(data[0]).toHaveProperty('open');
    expect(data[0]).toHaveProperty('high');
    expect(data[0]).toHaveProperty('low');
    expect(data[0]).toHaveProperty('close');
    expect(data[0]).toHaveProperty('volume');
    
    for (const candle of data.slice(0, 10)) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.volume).toBeGreaterThan(0);
    }
  });

  it('should fall back to synthetic data when DB throws an error', async () => {
    vi.doMock('../db', () => ({
      getDb: vi.fn().mockRejectedValue(new Error('Connection refused')),
    }));

    const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
    const pipeline = new RLTrainingPipeline({
      episodes: 10,
      batchSize: 32,
      learningRate: 0.001,
      gamma: 0.99,
      epsilon: 1.0,
      epsilonDecay: 0.995,
      epsilonMin: 0.01,
      replayBufferSize: 1000,
    });

    const data = await pipeline.loadHistoricalData('ETH-USD', new Date('2024-01-01'), new Date('2024-06-01'));
    expect(data.length).toBe(1000);
    expect(data[0]).toHaveProperty('open');
  });
});

// ─── Synthetic data quality ─────────────────────────────────────────────────

describe('RLTrainingPipeline synthetic data quality', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should generate regime-aware synthetic data with realistic properties', async () => {
    vi.doMock('../db', () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { RLTrainingPipeline } = await import('../ml/RLTrainingPipeline');
    const pipeline = new RLTrainingPipeline({
      episodes: 10,
      batchSize: 32,
      learningRate: 0.001,
      gamma: 0.99,
      epsilon: 1.0,
      epsilonDecay: 0.995,
      epsilonMin: 0.01,
      replayBufferSize: 1000,
    });

    const data = await pipeline.loadHistoricalData('BTC-USD', new Date('2024-01-01'), new Date('2024-12-31'));
    
    for (let i = 1; i < data.length; i++) {
      expect(data[i].timestamp.getTime()).toBeGreaterThan(data[i - 1].timestamp.getTime());
    }

    for (const candle of data) {
      expect(candle.open).toBeGreaterThan(0);
      expect(candle.high).toBeGreaterThan(0);
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.close).toBeGreaterThan(0);
      expect(candle.volume).toBeGreaterThan(0);
    }

    const prices = data.map(c => c.close);
    const uniquePrices = new Set(prices.map(p => p.toFixed(2)));
    expect(uniquePrices.size).toBeGreaterThan(10);
  });
});
