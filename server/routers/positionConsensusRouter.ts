/**
 * Position Consensus Router
 * 
 * Provides real-time consensus visualization data for positions
 * and emergency manual override capability.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getEngineAdapter } from '../services/EngineAdapter';
import { getDb } from '../db';
import { positions, paperPositions, agentSignals, paperOrders, bayesianConsensusLog } from '../../drizzle/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

// Types for position consensus data
interface AgentVote {
  agentName: string;
  signal: 'exit' | 'hold' | 'add';
  confidence: number;
  reasoning?: string;
  timestamp: number;
}

interface PositionConsensusData {
  positionId: number;
  symbol: string;

  // Consensus breakdown
  exitPercentage: number;
  holdPercentage: number;
  addPercentage: number;

  // Overall consensus
  consensusAction: 'exit' | 'hold' | 'add' | 'neutral';
  consensusStrength: number;
  confidenceScore: number;

  // Agent breakdown
  agentVotes: AgentVote[];
  totalAgents: number;
  agentsVotingExit: number;
  agentsVotingHold: number;
  agentsVotingAdd: number;

  // Thresholds
  exitThreshold: number;

  // Phase 78 — Bayesian uncertainty surfacing.
  // posteriorMean: calibrated belief (vs naive consensusStrength)
  // posteriorStd:  uncertainty around the mean — high = noisy/correlated signal
  // effectiveN:    information-theoretic agent count (<= rawN)
  // The UI uses these to show a "confidence interval" band on the agreement
  // bar, so operators see "85% strength but ±27% uncertainty" instead of
  // mistaking high mean for high confidence.
  posteriorMean?: number;
  posteriorStd?: number;
  effectiveN?: number;
  avgCorrelation?: number;

  // Last update
  lastUpdated: number;
}

export const positionConsensusRouter = router({
  /**
   * Get consensus data for a specific position
   */
  getPositionConsensus: protectedProcedure
    .input(z.object({
      positionId: z.number(),
    }))
    .query(async ({ ctx, input }): Promise<PositionConsensusData | null> => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Phase 75: Query paperPositions — the table the engine actually
      // writes to. The legacy `positions` table is empty in current
      // architecture, which is why this endpoint was returning null and
      // the UI showed "0 agents voting" for every position.
      const [position] = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.id, input.positionId),
          eq(paperPositions.userId, ctx.user.id)
        ))
        .limit(1);

      if (!position) {
        return null;
      }
      
      // Get recent agent signals for this symbol (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentSignals = await db
        .select()
        .from(agentSignals)
        .where(and(
          eq(agentSignals.userId, ctx.user.id),
          gte(agentSignals.timestamp, fiveMinutesAgo)
        ))
        .orderBy(desc(agentSignals.timestamp))
        .limit(100);
      
      // Filter signals for this position's symbol
      const symbolSignals = recentSignals.filter(s => {
        const data = s.signalData as any;
        return data?.symbol === position.symbol;
      });
      
      // Group by agent and get latest signal per agent
      const agentLatestSignals = new Map<string, typeof symbolSignals[0]>();
      for (const signal of symbolSignals) {
        if (!agentLatestSignals.has(signal.agentName)) {
          agentLatestSignals.set(signal.agentName, signal);
        }
      }
      
      // Analyze signals to determine exit/hold/add votes
      const agentVotes: AgentVote[] = [];
      let exitVotes = 0;
      let holdVotes = 0;
      let addVotes = 0;
      
      for (const [agentName, signal] of agentLatestSignals) {
        const data = signal.signalData as any;
        const signalType = data?.signal || signal.signalType;
        const confidence = parseFloat(signal.confidence?.toString() || '0.5');
        
        // Determine vote based on signal and position direction
        let vote: 'exit' | 'hold' | 'add' = 'hold';
        
        if (position.side === 'long') {
          // For long positions: bearish = exit, bullish = add/hold
          if (signalType === 'bearish' || signalType === 'sell' || signalType === 'exit') {
            vote = 'exit';
            exitVotes++;
          } else if (signalType === 'bullish' || signalType === 'buy') {
            if (confidence > 0.7) {
              vote = 'add';
              addVotes++;
            } else {
              vote = 'hold';
              holdVotes++;
            }
          } else {
            vote = 'hold';
            holdVotes++;
          }
        } else {
          // For short positions: bullish = exit, bearish = add/hold
          if (signalType === 'bullish' || signalType === 'buy' || signalType === 'exit') {
            vote = 'exit';
            exitVotes++;
          } else if (signalType === 'bearish' || signalType === 'sell') {
            if (confidence > 0.7) {
              vote = 'add';
              addVotes++;
            } else {
              vote = 'hold';
              holdVotes++;
            }
          } else {
            vote = 'hold';
            holdVotes++;
          }
        }
        
        agentVotes.push({
          agentName,
          signal: vote,
          confidence: confidence * 100,
          reasoning: data?.reasoning || signal.signalType,
          timestamp: new Date(signal.timestamp).getTime(),
        });
      }
      
      const totalAgents = agentVotes.length || 1; // Avoid division by zero
      
      // Calculate percentages
      const exitPercentage = Math.round((exitVotes / totalAgents) * 100);
      const holdPercentage = Math.round((holdVotes / totalAgents) * 100);
      const addPercentage = Math.round((addVotes / totalAgents) * 100);
      
      // Determine consensus action
      let consensusAction: 'exit' | 'hold' | 'add' | 'neutral' = 'neutral';
      let consensusStrength = 0;
      
      if (exitPercentage >= 60) {
        consensusAction = 'exit';
        consensusStrength = exitPercentage;
      } else if (holdPercentage >= 50) {
        consensusAction = 'hold';
        consensusStrength = holdPercentage;
      } else if (addPercentage >= 70) {
        consensusAction = 'add';
        consensusStrength = addPercentage;
      } else {
        consensusAction = 'neutral';
        consensusStrength = Math.max(exitPercentage, holdPercentage, addPercentage);
      }
      
      // Calculate overall confidence
      const avgConfidence = agentVotes.length > 0
        ? agentVotes.reduce((sum, v) => sum + v.confidence, 0) / agentVotes.length
        : 50;

      // Phase 78 — pull the latest Bayesian consensus snapshot for this symbol
      // so the UI panel can render uncertainty bands ("85% ±27%").
      let bayesianFields: {
        posteriorMean?: number;
        posteriorStd?: number;
        effectiveN?: number;
        avgCorrelation?: number;
      } = {};
      try {
        const [latestBayes] = await db
          .select()
          .from(bayesianConsensusLog)
          .where(eq(bayesianConsensusLog.symbol, position.symbol))
          .orderBy(desc(bayesianConsensusLog.timestamp))
          .limit(1);
        if (latestBayes) {
          bayesianFields = {
            posteriorMean: parseFloat(latestBayes.posteriorMean),
            posteriorStd: parseFloat(latestBayes.posteriorStd),
            effectiveN: parseFloat(latestBayes.effectiveN),
            avgCorrelation: latestBayes.avgCorrelation ? parseFloat(latestBayes.avgCorrelation) : 0,
          };
        }
      } catch {/* best-effort; UI will just skip the badge */}

      return {
        positionId: position.id,
        symbol: position.symbol,
        exitPercentage,
        holdPercentage,
        addPercentage,
        consensusAction,
        consensusStrength,
        confidenceScore: Math.round(avgConfidence),
        agentVotes: agentVotes.sort((a, b) => b.confidence - a.confidence),
        totalAgents,
        agentsVotingExit: exitVotes,
        agentsVotingHold: holdVotes,
        agentsVotingAdd: addVotes,
        exitThreshold: 60,
        ...bayesianFields,
        lastUpdated: Date.now(),
      };
    }),

  /**
   * Get consensus data for all positions
   */
  getAllPositionsConsensus: protectedProcedure
    .query(async ({ ctx }): Promise<PositionConsensusData[]> => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Phase 75: Use paperPositions (legacy positions table is empty)
      const userPositions = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.userId, ctx.user.id),
          eq(paperPositions.status, 'open')
        ));
      
      if (userPositions.length === 0) {
        return [];
      }
      
      // Get recent agent signals (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentSignals = await db
        .select()
        .from(agentSignals)
        .where(and(
          eq(agentSignals.userId, ctx.user.id),
          gte(agentSignals.timestamp, fiveMinutesAgo)
        ))
        .orderBy(desc(agentSignals.timestamp))
        .limit(500);
      
      // Process each position
      const results: PositionConsensusData[] = [];
      
      for (const position of userPositions) {
        // Filter signals for this position's symbol
        const symbolSignals = recentSignals.filter(s => {
          const data = s.signalData as any;
          return data?.symbol === position.symbol;
        });
        
        // Group by agent and get latest signal per agent
        const agentLatestSignals = new Map<string, typeof symbolSignals[0]>();
        for (const signal of symbolSignals) {
          if (!agentLatestSignals.has(signal.agentName)) {
            agentLatestSignals.set(signal.agentName, signal);
          }
        }
        
        // Analyze signals
        const agentVotes: AgentVote[] = [];
        let exitVotes = 0;
        let holdVotes = 0;
        let addVotes = 0;
        
        for (const [agentName, signal] of agentLatestSignals) {
          const data = signal.signalData as any;
          const signalType = data?.signal || signal.signalType;
          const confidence = parseFloat(signal.confidence?.toString() || '0.5');
          
          let vote: 'exit' | 'hold' | 'add' = 'hold';
          
          if (position.side === 'long') {
            if (signalType === 'bearish' || signalType === 'sell' || signalType === 'exit') {
              vote = 'exit';
              exitVotes++;
            } else if (signalType === 'bullish' || signalType === 'buy') {
              if (confidence > 0.7) {
                vote = 'add';
                addVotes++;
              } else {
                vote = 'hold';
                holdVotes++;
              }
            } else {
              vote = 'hold';
              holdVotes++;
            }
          } else {
            if (signalType === 'bullish' || signalType === 'buy' || signalType === 'exit') {
              vote = 'exit';
              exitVotes++;
            } else if (signalType === 'bearish' || signalType === 'sell') {
              if (confidence > 0.7) {
                vote = 'add';
                addVotes++;
              } else {
                vote = 'hold';
                holdVotes++;
              }
            } else {
              vote = 'hold';
              holdVotes++;
            }
          }
          
          agentVotes.push({
            agentName,
            signal: vote,
            confidence: confidence * 100,
            reasoning: data?.reasoning || signal.signalType,
            timestamp: new Date(signal.timestamp).getTime(),
          });
        }
        
        const totalAgents = agentVotes.length || 1;
        const exitPercentage = Math.round((exitVotes / totalAgents) * 100);
        const holdPercentage = Math.round((holdVotes / totalAgents) * 100);
        const addPercentage = Math.round((addVotes / totalAgents) * 100);
        
        let consensusAction: 'exit' | 'hold' | 'add' | 'neutral' = 'neutral';
        let consensusStrength = 0;
        
        if (exitPercentage >= 60) {
          consensusAction = 'exit';
          consensusStrength = exitPercentage;
        } else if (holdPercentage >= 50) {
          consensusAction = 'hold';
          consensusStrength = holdPercentage;
        } else if (addPercentage >= 70) {
          consensusAction = 'add';
          consensusStrength = addPercentage;
        } else {
          consensusAction = 'neutral';
          consensusStrength = Math.max(exitPercentage, holdPercentage, addPercentage);
        }
        
        const avgConfidence = agentVotes.length > 0
          ? agentVotes.reduce((sum, v) => sum + v.confidence, 0) / agentVotes.length
          : 50;
        
        results.push({
          positionId: position.id,
          symbol: position.symbol,
          exitPercentage,
          holdPercentage,
          addPercentage,
          consensusAction,
          consensusStrength,
          confidenceScore: Math.round(avgConfidence),
          agentVotes: agentVotes.sort((a, b) => b.confidence - a.confidence),
          totalAgents,
          agentsVotingExit: exitVotes,
          agentsVotingHold: holdVotes,
          agentsVotingAdd: addVotes,
          exitThreshold: 60,
          lastUpdated: Date.now(),
        });
      }
      
      return results;
    }),

  /**
   * Emergency manual exit - bypasses agent consensus
   * This is for edge cases where user wants to override the system
   */
  emergencyManualExit: protectedProcedure
    .input(z.object({
      positionId: z.number(),
      reason: z.string().min(1).max(500),
      confirmOverride: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.confirmOverride) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You must confirm the override to proceed with manual exit',
        });
      }
      
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Try paperPositions first (paper trading), then fall back to positions (live trading)
      let position: any = null;
      let isPaperPosition = false;
      
      // Check paperPositions table first (most common case)
      const [paperPosition] = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.id, input.positionId),
          eq(paperPositions.userId, ctx.user.id),
          eq(paperPositions.status, 'open')
        ))
        .limit(1);
      
      if (paperPosition) {
        position = paperPosition;
        isPaperPosition = true;
      } else {
        // Fall back to live positions table
        const [livePosition] = await db
          .select()
          .from(positions)
          .where(and(
            eq(positions.id, input.positionId),
            eq(positions.userId, ctx.user.id),
            eq(positions.status, 'open')
          ))
          .limit(1);
        
        if (livePosition) {
          position = livePosition;
          isPaperPosition = false;
        }
      }
      
      if (!position) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Position not found or already closed',
        });
      }
      
      // Log the manual override for audit trail
      console.log(`[MANUAL OVERRIDE] User ${ctx.user.id} initiated emergency exit for position ${input.positionId}`);
      console.log(`[MANUAL OVERRIDE] Reason: ${input.reason}`);
      console.log(`[MANUAL OVERRIDE] Position: ${position.symbol} ${position.side} @ ${position.entryPrice}`);
      
      // Phase 23: Get current price for exit — REJECT if no real market price
      const adapter = await getEngineAdapter(ctx.user.id);
      const positionsWithPrices = await adapter.getPositionsWithLivePrices();
      const posWithPrice = positionsWithPrices.find(p => p.id === input.positionId);
      const exitPrice = posWithPrice?.currentPrice || parseFloat(position.currentPrice?.toString() || '0');
      
      if (!exitPrice || exitPrice <= 0 || isNaN(exitPrice)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cannot close position: no real market price available. Price feed may be disconnected. Try again in a moment.',
        });
      }
      
      // Calculate final P&L
      const entryPrice = parseFloat(position.entryPrice.toString());
      const quantity = parseFloat(position.quantity.toString());
      let realizedPnl: number;
      let realizedPnlPercent: number;
      
      if (position.side === 'long') {
        realizedPnl = (exitPrice - entryPrice) * quantity;
        realizedPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      } else {
        realizedPnl = (entryPrice - exitPrice) * quantity;
        realizedPnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
      }
      
      // Close the position in the correct table
      if (isPaperPosition) {
        await db
          .update(paperPositions)
          .set({
            status: 'closed',
            currentPrice: exitPrice.toString(),
            exitPrice: exitPrice.toString(),
            exitTime: new Date(),
            realizedPnl: realizedPnl.toString(),
            exitReason: 'manual',
            updatedAt: new Date(),
          })
          .where(eq(paperPositions.id, input.positionId));
      } else {
        // Live positions table — write full exit data
        await db
          .update(positions)
          .set({
            status: 'closed',
            exitPrice: exitPrice.toString(),
            currentPrice: exitPrice.toString(),
            exitTime: new Date(),
            realizedPnl: realizedPnl.toString(),
            exitReason: 'manual',
            thesisValid: false,
            updatedAt: new Date(),
          })
          .where(eq(positions.id, input.positionId));
      }
      
      // Create an order record for the manual exit in paper orders
      try {
        const orderId = `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await db.insert(paperOrders).values({
          userId: ctx.user.id,
          orderId,
          symbol: position.symbol,
          exchange: 'coinbase', // Default to coinbase for paper trading
          side: position.side === 'long' ? 'sell' : 'buy',
          type: 'market',
          quantity: quantity.toString(),
          price: exitPrice.toString(),
          status: 'filled',
          filledQuantity: quantity.toString(),
          filledPrice: exitPrice.toString(),
          strategy: 'manual_override',
          createdAt: new Date(),
          filledAt: new Date(),
        });
      } catch (orderError) {
        console.warn('[MANUAL OVERRIDE] Failed to create order record:', orderError);
        // Continue anyway - position is closed
      }
      
      // Log completion
      console.log(`[MANUAL OVERRIDE] Position ${input.positionId} closed successfully`);
      console.log(`[MANUAL OVERRIDE] Exit price: ${exitPrice}, P&L: ${realizedPnl.toFixed(2)} (${realizedPnlPercent.toFixed(2)}%)`);
      
      return {
        success: true,
        positionId: input.positionId,
        symbol: position.symbol,
        exitPrice,
        realizedPnl,
        realizedPnlPercent,
        message: `Position closed via manual override. P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} (${realizedPnlPercent >= 0 ? '+' : ''}${realizedPnlPercent.toFixed(2)}%)`,
        auditLog: {
          userId: ctx.user.id,
          positionId: input.positionId,
          reason: input.reason,
          timestamp: new Date().toISOString(),
          exitPrice,
          realizedPnl,
          realizedPnlPercent,
        },
      };
    }),

  /**
   * Get manual override history for audit purposes
   */
  getManualOverrideHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      
      // Phase 75: Use paperPositions (engine writes to this table)
      const overridePositions = await db
        .select()
        .from(paperPositions)
        .where(and(
          eq(paperPositions.userId, ctx.user.id),
          eq(paperPositions.status, 'closed')
        ))
        .orderBy(desc(paperPositions.exitTime))
        .limit(input.limit);
      
      // Filter for manual overrides (check exitReason field)
      const manualOverrides = overridePositions.filter(p => 
        p.exitReason === 'manual'
      );
      
      return manualOverrides.map(p => ({
        positionId: p.id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: parseFloat(p.entryPrice.toString()),
        exitPrice: parseFloat(p.currentPrice?.toString() || p.entryPrice.toString()),
        quantity: parseFloat(p.quantity.toString()),
        realizedPnl: parseFloat(p.realizedPnl?.toString() || '0'),
        realizedPnlPercent: 0, // Calculate if needed
        reason: 'Manual Override',
        exitTime: p.exitTime?.toISOString(),
      }));
    }),
});
