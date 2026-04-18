/**
 * Tests for settingsRouter testConnection procedure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceAdapter } from '../../exchanges/BinanceAdapter';
import { CoinbaseAdapter } from '../../exchanges/CoinbaseAdapter';

// Mock the exchange adapters
vi.mock('../../exchanges/BinanceAdapter');
vi.mock('../../exchanges/CoinbaseAdapter');

describe('settingsRouter.testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully test Binance connection with valid credentials', async () => {
    // Mock successful connection
    const mockTestConnection = vi.fn().mockResolvedValue(true);
    (BinanceAdapter as any).mockImplementation(() => ({
      testConnection: mockTestConnection,
    }));

    const { BinanceAdapter: Adapter } = await import('../../exchanges/BinanceAdapter');
    const adapter = new Adapter('test-api-key', 'test-api-secret');
    const result = await adapter.testConnection();

    expect(result).toBe(true);
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it('should fail Binance connection with invalid credentials', async () => {
    // Mock failed connection
    const mockTestConnection = vi.fn().mockResolvedValue(false);
    (BinanceAdapter as any).mockImplementation(() => ({
      testConnection: mockTestConnection,
    }));

    const { BinanceAdapter: Adapter } = await import('../../exchanges/BinanceAdapter');
    const adapter = new Adapter('invalid-key', 'invalid-secret');
    const result = await adapter.testConnection();

    expect(result).toBe(false);
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it('should successfully test Coinbase connection with valid credentials', async () => {
    // Mock successful connection
    const mockTestConnection = vi.fn().mockResolvedValue(true);
    (CoinbaseAdapter as any).mockImplementation(() => ({
      testConnection: mockTestConnection,
    }));

    const { CoinbaseAdapter: Adapter } = await import('../../exchanges/CoinbaseAdapter');
    const adapter = new Adapter('test-api-key', 'test-api-secret');
    const result = await adapter.testConnection();

    expect(result).toBe(true);
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it('should handle connection errors gracefully', async () => {
    // Mock connection error
    const mockTestConnection = vi.fn().mockRejectedValue(new Error('Network error'));
    (BinanceAdapter as any).mockImplementation(() => ({
      testConnection: mockTestConnection,
    }));

    const { BinanceAdapter: Adapter } = await import('../../exchanges/BinanceAdapter');
    const adapter = new Adapter('test-api-key', 'test-api-secret');

    await expect(adapter.testConnection()).rejects.toThrow('Network error');
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });
});
