/**
 * BGeometrics Data Parsing Tests
 * 
 * Validates that the BGeometricsService correctly handles the API's
 * string-encoded numeric values (e.g., "1.1732" instead of 1.1732).
 * 
 * Root cause: BGeometrics API returns ALL numeric values as strings.
 * TypeScript `as number` cast doesn't convert at runtime, causing
 * `.toFixed()` to crash with "toFixed is not a function".
 * 
 * Fix: All API response values are now parsed with `parseFloat(String(value)) || 0`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BGeometrics Data Parsing - String to Number Conversion', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  describe('API Response Format Handling', () => {
    it('should handle MVRV returned as string from API', async () => {
      // This is the ACTUAL format returned by https://bitcoin-data.com/v1/mvrv/last
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', mvrv: '1.1732' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getMVRV();

      expect(typeof result.mvrv).toBe('number');
      expect(result.mvrv).toBeCloseTo(1.1732, 4);
      // This is the critical test - toFixed should work on the parsed number
      expect(() => result.mvrv.toFixed(2)).not.toThrow();
      expect(result.mvrv.toFixed(2)).toBe('1.17');
    });

    it('should handle NUPL returned as string from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', nupl: '0.242171611972931' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getNUPL();

      expect(typeof result.nupl).toBe('number');
      expect(result.nupl).toBeCloseTo(0.2422, 3);
      expect(() => result.nupl.toFixed(3)).not.toThrow();
      expect(result.nupl.toFixed(3)).toBe('0.242');
    });

    it('should handle SOPR returned as string from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', sopr: '0.9625100108390842' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getSOPR();

      expect(typeof result.sopr).toBe('number');
      expect(result.sopr).toBeCloseTo(0.9625, 4);
      expect(() => result.sopr.toFixed(4)).not.toThrow();
      expect(result.sopr.toFixed(4)).toBe('0.9625');
    });

    it('should handle unixTs returned as string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', mvrv: '2.5' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getMVRV();

      expect(result.date instanceof Date).toBe(true);
      expect(result.mvrv).toBe(2.5);
    });
  });

  describe('Edge Cases - Missing or Invalid Values', () => {
    it('should default to 0 when MVRV value is undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600' }), // no mvrv field
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getMVRV();

      expect(result.mvrv).toBe(0); // NaN from parseFloat("undefined") → fallback to 0
      expect(() => result.mvrv.toFixed(2)).not.toThrow();
    });

    it('should default to 0 when NUPL fields are missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', nupl: '0.5' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getNUPL();

      expect(result.nupl).toBe(0.5);
      expect(result.nup).toBe(0); // Missing field defaults to 0
      expect(result.nul).toBe(0); // Missing field defaults to 0
    });

    it('should handle empty string values gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', sopr: '' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getSOPR();

      expect(result.sopr).toBe(0); // parseFloat('') is NaN → fallback to 0
      expect(() => result.sopr.toFixed(4)).not.toThrow();
    });

    it('should handle numeric values (backward compatibility)', async () => {
      // In case API ever returns actual numbers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: 1770249600, mvrv: 1.5 }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const result = await service.getMVRV();

      expect(result.mvrv).toBe(1.5);
      expect(() => result.mvrv.toFixed(2)).not.toThrow();
    });
  });

  describe('OnChain Signal Interpretation', () => {
    it('should correctly interpret MVRV signals from string-parsed values', async () => {
      // MVRV < 1 = BULLISH
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', mvrv: '0.85' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      
      // Access private method via prototype
      const mvrv = await service.getMVRV();
      const signal = (service as any).interpretMVRV(mvrv.mvrv);

      expect(signal.signal).toBe('BULLISH');
      expect(signal.metric).toBe('MVRV');
      expect(typeof signal.value).toBe('number');
      expect(signal.value).toBeCloseTo(0.85, 2);
    });

    it('should correctly interpret SOPR signals from string-parsed values', async () => {
      // SOPR < 0.95 = BULLISH (capitulation)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', sopr: '0.92' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      
      const sopr = await service.getSOPR();
      const signal = (service as any).interpretSOPR(sopr.sopr);

      expect(signal.signal).toBe('BULLISH');
      expect(signal.metric).toBe('SOPR');
      expect(typeof signal.value).toBe('number');
    });

    it('should correctly interpret NUPL signals from string-parsed values', async () => {
      // NUPL > 0.75 = BEARISH (euphoria)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ d: '2026-02-05', unixTs: '1770249600', nupl: '0.82' }),
      });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      
      const nupl = await service.getNUPL();
      const signal = (service as any).interpretNUPL(nupl.nupl);

      expect(signal.signal).toBe('BEARISH');
      expect(signal.metric).toBe('NUPL');
      expect(typeof signal.value).toBe('number');
    });
  });

  describe('Combined OnChain Signals Pipeline', () => {
    it('should produce valid signals when all API responses are strings', async () => {
      // Mock 3 sequential API calls (MVRV, NUPL, SOPR)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ d: '2026-02-05', unixTs: '1770249600', mvrv: '1.1732' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ d: '2026-02-05', unixTs: '1770249600', nupl: '0.242' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ d: '2026-02-05', unixTs: '1770249600', sopr: '0.9625' }),
        });

      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const signals = await service.getOnChainSignals();

      expect(signals.length).toBe(3);
      
      for (const signal of signals) {
        expect(typeof signal.value).toBe('number');
        expect(['BULLISH', 'BEARISH', 'NEUTRAL']).toContain(signal.signal);
        expect(typeof signal.strength).toBe('number');
        expect(signal.strength).toBeGreaterThanOrEqual(0);
        expect(signal.strength).toBeLessThanOrEqual(100);
        // Critical: toFixed must work on all values
        expect(() => signal.value.toFixed(4)).not.toThrow();
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should track rate limits correctly', async () => {
      const { BGeometricsService } = await import('../services/BGeometricsService');
      const service = new BGeometricsService();
      const status = service.getStatus();

      expect(status.dailyRequestsRemaining).toBe(15);
      expect(status.hourlyRequestsRemaining).toBe(8);
    });
  });
});
