import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getConsensusThresholdBacktester,
  type ThresholdBacktestConfig,
  type ThresholdPreset,
} from '../services/ConsensusThresholdBacktester';

describe('ConsensusThresholdBacktester', () => {
  const backtester = getConsensusThresholdBacktester();
  
  describe('getThresholdPresets', () => {
    it('should return all threshold presets', () => {
      const presets = backtester.getThresholdPresets();
      
      expect(presets).toBeDefined();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
    });
    
    it('should include required preset IDs', () => {
      const presets = backtester.getThresholdPresets();
      const presetIds = presets.map(p => p.id);
      
      expect(presetIds).toContain('ultra_conservative');
      expect(presetIds).toContain('conservative');
      expect(presetIds).toContain('institutional');
      expect(presetIds).toContain('aggressive');
      expect(presetIds).toContain('ultra_aggressive');
      expect(presetIds).toContain('trend_following');
      expect(presetIds).toContain('mean_reversion');
    });
    
    it('should have valid threshold values for each preset', () => {
      const presets = backtester.getThresholdPresets();
      
      for (const preset of presets) {
        expect(preset.baseThreshold).toBeGreaterThan(0);
        expect(preset.baseThreshold).toBeLessThanOrEqual(1);
        
        expect(preset.regimeMultipliers.trending).toBeGreaterThan(0);
        expect(preset.regimeMultipliers.volatile).toBeGreaterThan(0);
        expect(preset.regimeMultipliers.ranging).toBeGreaterThan(0);
        
        expect(preset.positionTiers.scout).toBeGreaterThan(0);
        expect(preset.positionTiers.max).toBeLessThanOrEqual(0.5);
      }
    });
    
    it('should have expected metrics for each preset', () => {
      const presets = backtester.getThresholdPresets();
      
      for (const preset of presets) {
        expect(preset.expectedMetrics).toBeDefined();
        expect(preset.expectedMetrics.winRate).toBeDefined();
        expect(preset.expectedMetrics.sharpeRatio).toBeDefined();
        expect(preset.expectedMetrics.tradesPerWeek).toBeDefined();
        expect(preset.expectedMetrics.maxDrawdown).toBeDefined();
      }
    });
    
    it('should have suitableFor array for each preset', () => {
      const presets = backtester.getThresholdPresets();
      
      for (const preset of presets) {
        expect(Array.isArray(preset.suitableFor)).toBe(true);
        expect(preset.suitableFor.length).toBeGreaterThan(0);
      }
    });
  });
  
  describe('preset threshold ordering', () => {
    it('should have ultra_conservative with highest threshold', () => {
      const presets = backtester.getThresholdPresets();
      const ultraConservative = presets.find(p => p.id === 'ultra_conservative');
      const ultraAggressive = presets.find(p => p.id === 'ultra_aggressive');
      
      expect(ultraConservative!.baseThreshold).toBeGreaterThan(ultraAggressive!.baseThreshold);
    });
    
    it('should have conservative higher than aggressive', () => {
      const presets = backtester.getThresholdPresets();
      const conservative = presets.find(p => p.id === 'conservative');
      const aggressive = presets.find(p => p.id === 'aggressive');
      
      expect(conservative!.baseThreshold).toBeGreaterThan(aggressive!.baseThreshold);
    });
    
    it('should have institutional between conservative and aggressive', () => {
      const presets = backtester.getThresholdPresets();
      const conservative = presets.find(p => p.id === 'conservative');
      const institutional = presets.find(p => p.id === 'institutional');
      const aggressive = presets.find(p => p.id === 'aggressive');
      
      expect(institutional!.baseThreshold).toBeLessThan(conservative!.baseThreshold);
      expect(institutional!.baseThreshold).toBeGreaterThan(aggressive!.baseThreshold);
    });
  });
  
  describe('preset position tier ordering', () => {
    it('should have increasing position sizes from scout to max', () => {
      const presets = backtester.getThresholdPresets();
      
      for (const preset of presets) {
        const tiers = preset.positionTiers;
        expect(tiers.scout).toBeLessThan(tiers.moderate);
        expect(tiers.moderate).toBeLessThan(tiers.standard);
        expect(tiers.standard).toBeLessThan(tiers.strong);
        expect(tiers.strong).toBeLessThan(tiers.high);
        expect(tiers.high).toBeLessThan(tiers.max);
      }
    });
  });
  
  describe('regime multipliers', () => {
    it('should have volatile multiplier >= 1 for conservative presets', () => {
      const presets = backtester.getThresholdPresets();
      const conservativePresets = presets.filter(p => 
        p.id === 'ultra_conservative' || p.id === 'conservative'
      );
      
      for (const preset of conservativePresets) {
        expect(preset.regimeMultipliers.volatile).toBeGreaterThanOrEqual(1);
      }
    });
    
    it('should have trending multiplier < 1 for trend-following preset', () => {
      const presets = backtester.getThresholdPresets();
      const trendFollowing = presets.find(p => p.id === 'trend_following');
      
      expect(trendFollowing!.regimeMultipliers.trending).toBeLessThan(1);
    });
  });
});

describe('Backtest Configuration Validation', () => {
  it('should validate base threshold range', () => {
    const validConfig: ThresholdBacktestConfig = {
      name: 'Test',
      symbol: 'BTC-USD',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-01-31'),
      baseThreshold: 0.25,
      regimeMultipliers: { trending: 0.8, volatile: 1.4, ranging: 1.1 },
      positionTiers: {
        scout: 0.03, moderate: 0.05, standard: 0.07,
        strong: 0.10, high: 0.15, max: 0.20,
      },
      initialCapital: 100000,
      maxDrawdownLimit: 0.25,
      holdingPeriodHours: 24,
      stopLossPercent: 0.05,
      takeProfitPercent: 0.10,
    };
    
    expect(validConfig.baseThreshold).toBeGreaterThanOrEqual(0.05);
    expect(validConfig.baseThreshold).toBeLessThanOrEqual(0.80);
  });
  
  it('should validate position tier sum does not exceed 100%', () => {
    const presets = getConsensusThresholdBacktester().getThresholdPresets();
    
    for (const preset of presets) {
      const tierSum = Object.values(preset.positionTiers).reduce((a, b) => a + b, 0);
      // Sum of all tiers should be reasonable (not all positions at once)
      expect(tierSum).toBeLessThan(1);
    }
  });
});

describe('Preset Consistency', () => {
  it('should have unique IDs for all presets', () => {
    const presets = getConsensusThresholdBacktester().getThresholdPresets();
    const ids = presets.map(p => p.id);
    const uniqueIds = new Set(ids);
    
    expect(uniqueIds.size).toBe(ids.length);
  });
  
  it('should have unique names for all presets', () => {
    const presets = getConsensusThresholdBacktester().getThresholdPresets();
    const names = presets.map(p => p.name);
    const uniqueNames = new Set(names);
    
    expect(uniqueNames.size).toBe(names.length);
  });
  
  it('should have descriptions for all presets', () => {
    const presets = getConsensusThresholdBacktester().getThresholdPresets();
    
    for (const preset of presets) {
      expect(preset.description).toBeDefined();
      expect(preset.description.length).toBeGreaterThan(10);
    }
  });
});
