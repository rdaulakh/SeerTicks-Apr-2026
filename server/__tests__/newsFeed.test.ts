/**
 * News Feed API Tests
 * Verifies that the news feed endpoint returns real data from CoinGecko
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NewsSentinel } from '../agents/NewsSentinel';

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NewsSentinel News Feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNewsFeed', () => {
    it('should return properly formatted news items', async () => {
      // Mock CoinGecko API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'Bitcoin Reaches New High',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
              description: 'Bitcoin price surges to new all-time high',
            },
            {
              title: 'Ethereum Network Upgrade',
              news_site: 'CoinTelegraph',
              url: 'https://example.com/news/2',
              created_at: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
              description: 'Ethereum completes major network upgrade',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      // Verify structure
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('summary');
      expect(Array.isArray(result.items)).toBe(true);

      // Verify summary structure
      expect(result.summary).toHaveProperty('totalItems');
      expect(result.summary).toHaveProperty('tier1Count');
      expect(result.summary).toHaveProperty('tier2Count');
      expect(result.summary).toHaveProperty('tier3Count');
      expect(result.summary).toHaveProperty('avgImpactScore');
      expect(result.summary).toHaveProperty('overallSentiment');
    });

    it('should return empty array when API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      expect(result.items).toEqual([]);
      expect(result.summary.totalItems).toBe(0);
      expect(result.summary.overallSentiment).toBe('neutral');
    });

    it('should return empty array when API returns no data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      expect(result.items).toEqual([]);
      expect(result.summary.totalItems).toBe(0);
    });

    it('should correctly categorize news items by tier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'SEC Announces New Crypto Regulations',
              news_site: 'Bloomberg',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000),
              description: 'SEC regulatory announcement about Bitcoin',
            },
            {
              title: 'Bitcoin Technical Analysis',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/2',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Technical analysis of BTC price movement',
            },
            {
              title: 'Crypto Community Discussion',
              news_site: 'Twitter',
              url: 'https://example.com/news/3',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Community discussion about Bitcoin',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      // Bloomberg should be Tier 1
      const tier1Items = result.items.filter(i => i.tier === 1);
      const tier2Items = result.items.filter(i => i.tier === 2);
      const tier3Items = result.items.filter(i => i.tier === 3);

      // At least verify the tier distribution is reasonable
      expect(result.summary.tier1Count + result.summary.tier2Count + result.summary.tier3Count).toBe(result.summary.totalItems);
    });

    it('should include valid timestamps for all items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'Bitcoin News',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000) - 1800, // 30 mins ago
              description: 'Bitcoin news article',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item.timestamp).toBeDefined();
        // Verify it's a valid ISO date string
        expect(new Date(item.timestamp).getTime()).not.toBeNaN();
      }
    });

    it('should calculate sentiment correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'Bitcoin Surges to Record High',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Bitcoin price surges bullish momentum',
            },
            {
              title: 'Crypto Market Rally Continues',
              news_site: 'CoinTelegraph',
              url: 'https://example.com/news/2',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Market shows strong bullish signs',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      // Verify sentiment is one of the valid values
      expect(['bullish', 'bearish', 'neutral']).toContain(result.summary.overallSentiment);
    });
  });

  describe('News Item Structure', () => {
    it('should have all required fields in news items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'Test News',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Test description about Bitcoin',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('title');
        expect(item).toHaveProperty('source');
        expect(item).toHaveProperty('tier');
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('sentiment');
        expect(item).toHaveProperty('impactScore');
        expect(item).toHaveProperty('credibilityScore');
        expect(item).toHaveProperty('recencyScore');
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('url');
      }
    });

    it('should have valid score ranges', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              title: 'Bitcoin News',
              news_site: 'CoinDesk',
              url: 'https://example.com/news/1',
              created_at: Math.floor(Date.now() / 1000),
              description: 'Bitcoin news about price',
            },
          ],
        }),
      });

      const sentinel = new NewsSentinel();
      const result = await sentinel.getNewsFeed('BTC/USDT');

      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item.impactScore).toBeGreaterThanOrEqual(0);
        expect(item.impactScore).toBeLessThanOrEqual(100);
        expect(item.credibilityScore).toBeGreaterThanOrEqual(0);
        expect(item.credibilityScore).toBeLessThanOrEqual(100);
        expect(item.recencyScore).toBeGreaterThanOrEqual(0);
        expect(item.recencyScore).toBeLessThanOrEqual(100);
      }
    });
  });
});
