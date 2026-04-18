import { describe, it, expect } from 'vitest';

describe('MEMORY_LIMIT_MB Environment Variable', () => {
  it('should be set to 1024', () => {
    const memLimit = process.env.MEMORY_LIMIT_MB;
    expect(memLimit).toBeDefined();
    expect(parseInt(memLimit!, 10)).toBe(1024);
  });

  it('should produce correct 80% and 90% alert thresholds', () => {
    const limitMB = parseInt(process.env.MEMORY_LIMIT_MB!, 10);
    const warningThreshold = Math.floor(limitMB * 0.8);
    const criticalThreshold = Math.floor(limitMB * 0.9);
    expect(warningThreshold).toBe(819);
    expect(criticalThreshold).toBe(921);
  });
});
