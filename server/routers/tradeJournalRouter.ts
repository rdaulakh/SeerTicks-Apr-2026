import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getTradeJournalEntries,
  getTradeJournalEntryById,
  getJournalEntryByTradeId,
  createTradeJournalEntry,
  updateTradeJournalEntry,
  deleteTradeJournalEntry,
  getJournalEntriesByStrategy,
  getJournalStats,
} from "../db";

// Validation schemas
const marketConditionEnum = z.enum(["trending", "ranging", "volatile", "calm"]);
const emotionBeforeEnum = z.enum(["confident", "neutral", "anxious", "fearful", "greedy", "frustrated"]);
const emotionDuringEnum = z.enum(["confident", "neutral", "anxious", "fearful", "greedy", "frustrated"]);
const emotionAfterEnum = z.enum(["satisfied", "neutral", "disappointed", "frustrated", "relieved"]);

const journalEntryInput = z.object({
  tradeId: z.number().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  setup: z.string().nullable().optional(),
  strategy: z.string().max(100).nullable().optional(),
  timeframe: z.string().max(20).nullable().optional(),
  marketCondition: marketConditionEnum.nullable().optional(),
  entryReason: z.string().nullable().optional(),
  confluenceFactors: z.array(z.string()).nullable().optional(),
  exitReason: z.string().nullable().optional(),
  lessonsLearned: z.string().nullable().optional(),
  mistakes: z.string().nullable().optional(),
  improvements: z.string().nullable().optional(),
  emotionBefore: emotionBeforeEnum.nullable().optional(),
  emotionDuring: emotionDuringEnum.nullable().optional(),
  emotionAfter: emotionAfterEnum.nullable().optional(),
  executionRating: z.number().min(1).max(5).nullable().optional(),
  followedPlan: z.boolean().nullable().optional(),
  screenshots: z.array(z.string()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

export const tradeJournalRouter = router({
  // Get all journal entries for the user with pagination
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      
      const entries = await getTradeJournalEntries(ctx.user.id, limit, offset);
      return entries;
    }),

  // Get a single journal entry by ID
  getById: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const entry = await getTradeJournalEntryById(ctx.user.id, input.id);
      if (!entry) {
        throw new Error("Journal entry not found");
      }
      return entry;
    }),

  // Get journal entry linked to a specific trade
  getByTradeId: protectedProcedure
    .input(z.object({
      tradeId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const entry = await getJournalEntryByTradeId(ctx.user.id, input.tradeId);
      return entry || null;
    }),

  // Create a new journal entry
  create: protectedProcedure
    .input(journalEntryInput)
    .mutation(async ({ ctx, input }) => {
      await createTradeJournalEntry({
        userId: ctx.user.id,
        tradeId: input.tradeId,
        title: input.title,
        setup: input.setup,
        strategy: input.strategy,
        timeframe: input.timeframe,
        marketCondition: input.marketCondition,
        entryReason: input.entryReason,
        confluenceFactors: input.confluenceFactors,
        exitReason: input.exitReason,
        lessonsLearned: input.lessonsLearned,
        mistakes: input.mistakes,
        improvements: input.improvements,
        emotionBefore: input.emotionBefore,
        emotionDuring: input.emotionDuring,
        emotionAfter: input.emotionAfter,
        executionRating: input.executionRating,
        followedPlan: input.followedPlan,
        screenshots: input.screenshots,
        tags: input.tags,
      });
      
      return { success: true };
    }),

  // Update an existing journal entry
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      data: journalEntryInput,
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify entry exists and belongs to user
      const existing = await getTradeJournalEntryById(ctx.user.id, input.id);
      if (!existing) {
        throw new Error("Journal entry not found");
      }
      
      await updateTradeJournalEntry(ctx.user.id, input.id, input.data);
      return { success: true };
    }),

  // Delete a journal entry
  delete: protectedProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify entry exists and belongs to user
      const existing = await getTradeJournalEntryById(ctx.user.id, input.id);
      if (!existing) {
        throw new Error("Journal entry not found");
      }
      
      await deleteTradeJournalEntry(ctx.user.id, input.id);
      return { success: true };
    }),

  // Get entries filtered by strategy
  getByStrategy: protectedProcedure
    .input(z.object({
      strategy: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const entries = await getJournalEntriesByStrategy(ctx.user.id, input.strategy);
      return entries;
    }),

  // Get journal statistics
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const stats = await getJournalStats(ctx.user.id);
    return stats;
  }),

  // Get unique strategies used in journal entries
  getStrategies: protectedProcedure.query(async ({ ctx }) => {
    const entries = await getTradeJournalEntries(ctx.user.id, 1000, 0);
    const strategies = new Set<string>();
    
    entries.forEach(entry => {
      if (entry.strategy) {
        strategies.add(entry.strategy);
      }
    });
    
    return Array.from(strategies).sort();
  }),

  // Get unique tags used in journal entries
  getTags: protectedProcedure.query(async ({ ctx }) => {
    const entries = await getTradeJournalEntries(ctx.user.id, 1000, 0);
    const tags = new Set<string>();
    
    entries.forEach(entry => {
      if (entry.tags && Array.isArray(entry.tags)) {
        (entry.tags as string[]).forEach(tag => tags.add(tag));
      }
    });
    
    return Array.from(tags).sort();
  }),
});
