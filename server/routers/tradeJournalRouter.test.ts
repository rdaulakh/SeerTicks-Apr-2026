import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database functions
vi.mock('../db', () => ({
  getTradeJournalEntries: vi.fn(),
  getTradeJournalEntryById: vi.fn(),
  getJournalEntryByTradeId: vi.fn(),
  createTradeJournalEntry: vi.fn(),
  updateTradeJournalEntry: vi.fn(),
  deleteTradeJournalEntry: vi.fn(),
  getJournalEntriesByStrategy: vi.fn(),
  getJournalStats: vi.fn(),
}));

import {
  getTradeJournalEntries,
  getTradeJournalEntryById,
  getJournalEntryByTradeId,
  createTradeJournalEntry,
  updateTradeJournalEntry,
  deleteTradeJournalEntry,
  getJournalEntriesByStrategy,
  getJournalStats,
} from '../db';

// Import the router after mocking
import { tradeJournalRouter } from './tradeJournalRouter';

// Helper to create a mock context
const createMockContext = (userId: number = 1) => ({
  user: { id: userId, openId: 'test-open-id', email: 'test@example.com', role: 'user' as const },
  req: {} as any,
  res: {} as any,
});

// Sample journal entry data
const sampleJournalEntry = {
  id: 1,
  userId: 1,
  tradeId: 100,
  title: 'BTC Long Trade Analysis',
  setup: 'Breakout above resistance',
  strategy: 'Breakout Trading',
  timeframe: '4H',
  marketCondition: 'trending' as const,
  entryReason: 'Strong momentum with volume confirmation',
  confluenceFactors: ['RSI oversold bounce', 'Support level', 'Volume spike'],
  exitReason: 'Target reached',
  lessonsLearned: 'Wait for confirmation before entry',
  mistakes: 'Entered too early',
  improvements: 'Use limit orders for better entry',
  emotionBefore: 'confident' as const,
  emotionDuring: 'neutral' as const,
  emotionAfter: 'satisfied' as const,
  executionRating: 4,
  followedPlan: true,
  screenshots: ['https://example.com/chart1.png'],
  tags: ['btc', 'breakout', 'profitable'],
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
};

describe('Trade Journal Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('should return journal entries for the user', async () => {
      const mockEntries = [sampleJournalEntry];
      (getTradeJournalEntries as any).mockResolvedValue(mockEntries);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.list({ limit: 50, offset: 0 });

      expect(getTradeJournalEntries).toHaveBeenCalledWith(1, 50, 0);
      expect(result).toEqual(mockEntries);
    });

    it('should use default pagination values', async () => {
      const mockEntries: any[] = [];
      (getTradeJournalEntries as any).mockResolvedValue(mockEntries);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await caller.list();

      expect(getTradeJournalEntries).toHaveBeenCalledWith(1, 50, 0);
    });
  });

  describe('getById', () => {
    it('should return a journal entry by ID', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(sampleJournalEntry);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getById({ id: 1 });

      expect(getTradeJournalEntryById).toHaveBeenCalledWith(1, 1);
      expect(result).toEqual(sampleJournalEntry);
    });

    it('should throw error if entry not found', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await expect(caller.getById({ id: 999 })).rejects.toThrow('Journal entry not found');
    });
  });

  describe('getByTradeId', () => {
    it('should return journal entry linked to a trade', async () => {
      (getJournalEntryByTradeId as any).mockResolvedValue(sampleJournalEntry);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getByTradeId({ tradeId: 100 });

      expect(getJournalEntryByTradeId).toHaveBeenCalledWith(1, 100);
      expect(result).toEqual(sampleJournalEntry);
    });

    it('should return null if no entry linked to trade', async () => {
      (getJournalEntryByTradeId as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getByTradeId({ tradeId: 999 });

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new journal entry', async () => {
      (createTradeJournalEntry as any).mockResolvedValue({ insertId: 1 });

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const input = {
        tradeId: 100,
        title: 'New Trade Analysis',
        strategy: 'Scalping',
        emotionBefore: 'confident' as const,
        executionRating: 5,
        followedPlan: true,
        tags: ['test', 'scalp'],
      };

      const result = await caller.create(input);

      expect(createTradeJournalEntry).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1,
        tradeId: 100,
        title: 'New Trade Analysis',
        strategy: 'Scalping',
      }));
      expect(result).toEqual({ success: true });
    });

    it('should create entry without trade link (standalone)', async () => {
      (createTradeJournalEntry as any).mockResolvedValue({ insertId: 2 });

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const input = {
        title: 'Market Analysis Notes',
        lessonsLearned: 'Important market insight',
      };

      const result = await caller.create(input);

      expect(createTradeJournalEntry).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1,
        title: 'Market Analysis Notes',
      }));
      expect(result).toEqual({ success: true });
    });
  });

  describe('update', () => {
    it('should update an existing journal entry', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(sampleJournalEntry);
      (updateTradeJournalEntry as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.update({
        id: 1,
        data: {
          title: 'Updated Title',
          executionRating: 5,
        },
      });

      expect(getTradeJournalEntryById).toHaveBeenCalledWith(1, 1);
      expect(updateTradeJournalEntry).toHaveBeenCalledWith(1, 1, {
        title: 'Updated Title',
        executionRating: 5,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw error if entry not found for update', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await expect(caller.update({
        id: 999,
        data: { title: 'New Title' },
      })).rejects.toThrow('Journal entry not found');
    });
  });

  describe('delete', () => {
    it('should delete a journal entry', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(sampleJournalEntry);
      (deleteTradeJournalEntry as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.delete({ id: 1 });

      expect(getTradeJournalEntryById).toHaveBeenCalledWith(1, 1);
      expect(deleteTradeJournalEntry).toHaveBeenCalledWith(1, 1);
      expect(result).toEqual({ success: true });
    });

    it('should throw error if entry not found for delete', async () => {
      (getTradeJournalEntryById as any).mockResolvedValue(undefined);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await expect(caller.delete({ id: 999 })).rejects.toThrow('Journal entry not found');
    });
  });

  describe('getByStrategy', () => {
    it('should return entries filtered by strategy', async () => {
      const mockEntries = [sampleJournalEntry];
      (getJournalEntriesByStrategy as any).mockResolvedValue(mockEntries);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getByStrategy({ strategy: 'Breakout Trading' });

      expect(getJournalEntriesByStrategy).toHaveBeenCalledWith(1, 'Breakout Trading');
      expect(result).toEqual(mockEntries);
    });
  });

  describe('getStats', () => {
    it('should return journal statistics', async () => {
      const mockStats = {
        totalEntries: 25,
        followedPlanCount: 20,
        averageExecutionRating: 3.8,
      };
      (getJournalStats as any).mockResolvedValue(mockStats);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getStats();

      expect(getJournalStats).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockStats);
    });
  });

  describe('getStrategies', () => {
    it('should return unique strategies', async () => {
      const mockEntries = [
        { ...sampleJournalEntry, strategy: 'Scalping' },
        { ...sampleJournalEntry, strategy: 'Breakout Trading' },
        { ...sampleJournalEntry, strategy: 'Scalping' }, // Duplicate
        { ...sampleJournalEntry, strategy: null },
      ];
      (getTradeJournalEntries as any).mockResolvedValue(mockEntries);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getStrategies();

      expect(result).toEqual(['Breakout Trading', 'Scalping']);
    });
  });

  describe('getTags', () => {
    it('should return unique tags', async () => {
      const mockEntries = [
        { ...sampleJournalEntry, tags: ['btc', 'profitable'] },
        { ...sampleJournalEntry, tags: ['eth', 'profitable'] },
        { ...sampleJournalEntry, tags: null },
      ];
      (getTradeJournalEntries as any).mockResolvedValue(mockEntries);

      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      const result = await caller.getTags();

      expect(result).toEqual(['btc', 'eth', 'profitable']);
    });
  });

  describe('input validation', () => {
    it('should validate execution rating range', async () => {
      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      // Rating too high
      await expect(caller.create({
        title: 'Test',
        executionRating: 10,
      })).rejects.toThrow();

      // Rating too low
      await expect(caller.create({
        title: 'Test',
        executionRating: 0,
      })).rejects.toThrow();
    });

    it('should validate market condition enum', async () => {
      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await expect(caller.create({
        title: 'Test',
        marketCondition: 'invalid' as any,
      })).rejects.toThrow();
    });

    it('should validate emotion enums', async () => {
      const ctx = createMockContext();
      const caller = tradeJournalRouter.createCaller(ctx);
      
      await expect(caller.create({
        title: 'Test',
        emotionBefore: 'invalid' as any,
      })).rejects.toThrow();
    });
  });
});
