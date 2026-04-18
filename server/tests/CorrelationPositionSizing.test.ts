import { describe, it, expect } from 'vitest';
import { adjustPositionSizeForCorrelation } from '../utils/InstitutionalTrading';

describe('Correlation-Based Position Sizing', () => {
  it('should not reduce position size when no correlated positions exist', () => {
    const baseSize = 5.0; // 5% of account
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'AAPL', positionSize: 3.0 },
      { symbol: 'TSLA', positionSize: 2.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['AAPL', 0.2],
        ['TSLA', 0.1],
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.adjustedSize).toBe(baseSize);
    expect(result.correlations).toHaveLength(0);
    expect(result.reasoning).toContain('No correlated positions');
  });

  it('should reduce position size by 30% for weak correlation (0.7)', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'ETH-USD', positionSize: 4.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['ETH-USD', 0.7],
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.adjustedSize).toBeCloseTo(3.5, 1); // 5.0 * 0.7 = 3.5
    expect(result.correlations).toHaveLength(1);
    expect(result.correlations[0].symbol).toBe('ETH-USD');
    expect(result.correlations[0].correlation).toBe(0.7);
    expect(result.reasoning).toContain('Reduced by 30%');
    expect(result.reasoning).toContain('ETH-USD (70%)');
  });

  it('should reduce position size by 50% for moderate correlation (0.8)', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'ETH-USD', positionSize: 4.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['ETH-USD', 0.8],
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.adjustedSize).toBeCloseTo(2.5, 1); // 5.0 * 0.5 = 2.5
    expect(result.reasoning).toContain('Reduced by 50%');
  });

  it('should reduce position size by 70% for strong correlation (0.9+)', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'ETH-USD', positionSize: 4.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['ETH-USD', 0.95],
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.adjustedSize).toBeCloseTo(1.5, 1); // 5.0 * 0.3 = 1.5
    expect(result.reasoning).toContain('Reduced by 70%');
  });

  it('should handle multiple correlated positions', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'ETH-USD', positionSize: 4.0 },
      { symbol: 'LTC-USD', positionSize: 2.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['ETH-USD', 0.85],
        ['LTC-USD', 0.75],
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.correlations).toHaveLength(2);
    expect(result.reasoning).toContain('2 correlated positions');
    expect(result.reasoning).toContain('ETH-USD');
    expect(result.reasoning).toContain('LTC-USD');
    expect(result.reasoning).toContain('Total correlated exposure: 6.0%');
  });

  it('should respect correlation threshold', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'ETH-USD', positionSize: 4.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['ETH-USD', 0.65], // Below 0.7 threshold
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    expect(result.adjustedSize).toBe(baseSize);
    expect(result.correlations).toHaveLength(0);
  });

  it('should handle negative correlations', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'GOLD', positionSize: 3.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map([
        ['GOLD', -0.8], // Strong negative correlation
      ])],
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    // Negative correlation should also trigger reduction
    expect(result.adjustedSize).toBeLessThan(baseSize);
    expect(result.correlations).toHaveLength(1);
    expect(result.correlations[0].correlation).toBe(-0.8);
  });

  it('should handle missing correlation data gracefully', () => {
    const baseSize = 5.0;
    const symbol = 'BTC-USD';
    const existingPositions = [
      { symbol: 'UNKNOWN-ASSET', positionSize: 2.0 },
    ];
    const correlationMatrix = new Map([
      ['BTC-USD', new Map()], // No correlation data for UNKNOWN-ASSET
    ]);

    const result = adjustPositionSizeForCorrelation(
      baseSize,
      symbol,
      existingPositions,
      correlationMatrix,
      0.7
    );

    // Should default to 0 correlation and not reduce
    expect(result.adjustedSize).toBe(baseSize);
    expect(result.correlations).toHaveLength(0);
  });
});
