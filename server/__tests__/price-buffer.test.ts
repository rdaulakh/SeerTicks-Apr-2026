/**
 * PriceBuffer Unit Tests
 * 
 * Tests for the memory-optimized price buffer using Float64Array
 * Phase 4.2 - HFT-Grade Memory Optimization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PriceBuffer, PriceBufferManager, getPriceBufferManager } from '../utils/PriceBuffer';

describe('PriceBuffer', () => {
  let buffer: PriceBuffer;

  beforeEach(() => {
    buffer = new PriceBuffer('BTC-USD', 100);
  });

  describe('Basic Operations', () => {
    it('should create an empty buffer', () => {
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getCount()).toBe(0);
      expect(buffer.getCapacity()).toBe(100);
    });

    it('should push prices correctly', () => {
      buffer.push(50000, Date.now());
      expect(buffer.isEmpty()).toBe(false);
      expect(buffer.getCount()).toBe(1);
      expect(buffer.getLatestPrice()).toBe(50000);
    });

    it('should handle multiple pushes', () => {
      buffer.push(50000);
      buffer.push(50100);
      buffer.push(50200);
      
      expect(buffer.getCount()).toBe(3);
      expect(buffer.getLatestPrice()).toBe(50200);
    });

    it('should wrap around when full (circular buffer)', () => {
      const smallBuffer = new PriceBuffer('ETH-USD', 5);
      
      for (let i = 0; i < 10; i++) {
        smallBuffer.push(1000 + i);
      }
      
      expect(smallBuffer.getCount()).toBe(5);
      expect(smallBuffer.isFull()).toBe(true);
      expect(smallBuffer.getLatestPrice()).toBe(1009);
      // Oldest should be 1005 (positions 5-9 are stored)
      expect(smallBuffer.getPriceAt(0)).toBe(1005);
    });
  });

  describe('Statistical Calculations', () => {
    beforeEach(() => {
      // Push 10 prices: 100, 101, 102, ..., 109
      for (let i = 0; i < 10; i++) {
        buffer.push(100 + i);
      }
    });

    it('should calculate SMA correctly', () => {
      const sma = buffer.getSMA();
      // Average of 100-109 = (100+109)/2 = 104.5
      expect(sma).toBe(104.5);
    });

    it('should calculate SMA for specific period', () => {
      const sma5 = buffer.getSMAForPeriod(5);
      // Last 5 prices: 105, 106, 107, 108, 109 -> avg = 107
      expect(sma5).toBe(107);
    });

    it('should calculate high correctly', () => {
      expect(buffer.getHigh()).toBe(109);
    });

    it('should calculate low correctly', () => {
      expect(buffer.getLow()).toBe(100);
    });

    it('should calculate range correctly', () => {
      expect(buffer.getRange()).toBe(9);
    });

    it('should calculate price change correctly', () => {
      expect(buffer.getPriceChange()).toBe(9);
    });

    it('should calculate price change percent correctly', () => {
      const changePercent = buffer.getPriceChangePercent();
      expect(changePercent).toBeCloseTo(9, 1); // 9% change from 100 to 109
    });

    it('should calculate volatility (std dev)', () => {
      const volatility = buffer.getVolatility();
      // Standard deviation of 100-109
      expect(volatility).toBeGreaterThan(0);
      expect(volatility).toBeLessThan(5);
    });

    it('should calculate EMA correctly', () => {
      const ema = buffer.getEMA(5);
      expect(ema).toBeGreaterThan(105);
      expect(ema).toBeLessThan(110);
    });

    it('should calculate momentum correctly', () => {
      const momentum = buffer.getMomentum(5);
      // From 104 to 109 = 4.8% increase
      expect(momentum).toBeGreaterThan(0);
    });
  });

  describe('VWAP Calculation', () => {
    it('should calculate VWAP with volume data', () => {
      buffer.push(100, Date.now(), 10);  // $100 x 10 volume
      buffer.push(110, Date.now(), 20);  // $110 x 20 volume
      buffer.push(105, Date.now(), 15);  // $105 x 15 volume
      
      const vwap = buffer.getVWAP();
      // VWAP = (100*10 + 110*20 + 105*15) / (10+20+15)
      // = (1000 + 2200 + 1575) / 45 = 4775 / 45 = 106.11
      expect(vwap).toBeCloseTo(106.11, 1);
    });

    it('should return SMA when no volume data', () => {
      buffer.push(100);
      buffer.push(110);
      buffer.push(105);
      
      const vwap = buffer.getVWAP();
      const sma = buffer.getSMA();
      expect(vwap).toBe(sma);
    });
  });

  describe('Memory Efficiency', () => {
    it('should use ~16 bytes per tick', () => {
      const largeBuffer = new PriceBuffer('BTC-USD', 10000);
      const memoryUsage = largeBuffer.getMemoryUsage();
      
      // 10000 ticks * 8 bytes (Float64) * 3 arrays = 240,000 bytes
      expect(memoryUsage).toBe(240000);
    });

    it('should report fill percentage correctly', () => {
      const smallBuffer = new PriceBuffer('ETH-USD', 100);
      
      for (let i = 0; i < 50; i++) {
        smallBuffer.push(1000 + i);
      }
      
      expect(smallBuffer.getFillPercent()).toBe(50);
    });
  });

  describe('Performance', () => {
    it('should push 10,000 ticks in under 50ms', () => {
      const perfBuffer = new PriceBuffer('BTC-USD', 10000);
      const start = performance.now();
      
      for (let i = 0; i < 10000; i++) {
        perfBuffer.push(50000 + Math.random() * 1000, Date.now(), Math.random() * 100);
      }
      
      const duration = performance.now() - start;
      console.log(`[PriceBuffer] 10,000 pushes took ${duration.toFixed(2)}ms`);
      // Relaxed threshold for CI environment variability
      // In production, this typically runs in <10ms
      expect(duration).toBeLessThan(50);
    });

    it('should calculate statistics in under 1ms', () => {
      // Fill buffer
      for (let i = 0; i < 100; i++) {
        buffer.push(50000 + Math.random() * 1000);
      }
      
      const start = performance.now();
      
      buffer.getSMA();
      buffer.getVWAP();
      buffer.getVolatility();
      buffer.getHigh();
      buffer.getLow();
      
      const duration = performance.now() - start;
      console.log(`[PriceBuffer] Statistics calculation took ${duration.toFixed(3)}ms`);
      expect(duration).toBeLessThan(1);
    });
  });

  describe('Clear and Reset', () => {
    it('should clear all data', () => {
      buffer.push(100);
      buffer.push(200);
      buffer.push(300);
      
      buffer.clear();
      
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getCount()).toBe(0);
      expect(buffer.getLatestPrice()).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    it('should push batch of ticks', () => {
      const ticks = [
        { price: 100, timestamp: Date.now(), volume: 10 },
        { price: 101, timestamp: Date.now(), volume: 20 },
        { price: 102, timestamp: Date.now(), volume: 15 },
      ];
      
      buffer.pushBatch(ticks);
      
      expect(buffer.getCount()).toBe(3);
      expect(buffer.getLatestPrice()).toBe(102);
    });
  });

  describe('Get Last N Prices', () => {
    it('should return last N prices as array', () => {
      for (let i = 0; i < 10; i++) {
        buffer.push(100 + i);
      }
      
      const last5 = buffer.getLastNPrices(5);
      
      expect(last5).toHaveLength(5);
      expect(last5).toEqual([105, 106, 107, 108, 109]);
    });

    it('should handle request larger than buffer', () => {
      buffer.push(100);
      buffer.push(200);
      
      const last10 = buffer.getLastNPrices(10);
      
      expect(last10).toHaveLength(2);
      expect(last10).toEqual([100, 200]);
    });
  });
});

describe('PriceBufferManager', () => {
  let manager: PriceBufferManager;

  beforeEach(() => {
    manager = new PriceBufferManager(1000);
  });

  it('should create buffers on demand', () => {
    manager.push('BTC-USD', 50000);
    manager.push('ETH-USD', 3000);
    
    expect(manager.getSymbols()).toContain('BTC-USD');
    expect(manager.getSymbols()).toContain('ETH-USD');
  });

  it('should get latest price for symbol', () => {
    manager.push('BTC-USD', 50000);
    manager.push('BTC-USD', 50100);
    
    expect(manager.getLatestPrice('BTC-USD')).toBe(50100);
    expect(manager.getLatestPrice('UNKNOWN')).toBeNull();
  });

  it('should calculate VWAP per symbol', () => {
    manager.push('BTC-USD', 50000, Date.now(), 10);
    manager.push('BTC-USD', 50100, Date.now(), 20);
    
    const vwap = manager.getVWAP('BTC-USD');
    expect(vwap).toBeGreaterThan(50000);
    expect(vwap).toBeLessThan(50100);
  });

  it('should calculate volatility per symbol', () => {
    for (let i = 0; i < 100; i++) {
      manager.push('BTC-USD', 50000 + Math.random() * 1000);
    }
    
    const volatility = manager.getVolatility('BTC-USD');
    expect(volatility).toBeGreaterThan(0);
  });

  it('should track total memory usage', () => {
    manager.push('BTC-USD', 50000);
    manager.push('ETH-USD', 3000);
    
    const totalMemory = manager.getTotalMemoryUsage();
    // 2 buffers * 1000 capacity * 8 bytes * 3 arrays = 48,000 bytes
    expect(totalMemory).toBe(48000);
  });

  it('should get all stats', () => {
    manager.push('BTC-USD', 50000);
    manager.push('ETH-USD', 3000);
    
    const allStats = manager.getAllStats();
    
    expect(allStats['BTC-USD']).toBeDefined();
    expect(allStats['ETH-USD']).toBeDefined();
  });

  it('should remove buffer', () => {
    manager.push('BTC-USD', 50000);
    
    expect(manager.removeBuffer('BTC-USD')).toBe(true);
    expect(manager.getSymbols()).not.toContain('BTC-USD');
  });

  it('should clear all buffers', () => {
    manager.push('BTC-USD', 50000);
    manager.push('ETH-USD', 3000);
    
    manager.clearAll();
    
    expect(manager.getLatestPrice('BTC-USD')).toBeNull();
    expect(manager.getLatestPrice('ETH-USD')).toBeNull();
  });
});

describe('Singleton getPriceBufferManager', () => {
  it('should return same instance', () => {
    const manager1 = getPriceBufferManager();
    const manager2 = getPriceBufferManager();
    
    expect(manager1).toBe(manager2);
  });
});
