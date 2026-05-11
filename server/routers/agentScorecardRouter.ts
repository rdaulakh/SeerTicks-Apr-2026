/**
 * agentScorecardRouter — Phase 82
 *
 * The "team review" surface. Lets the operator (and future UI) see:
 *   - Per-agent accuracy, Brier score, recent win-rate
 *   - Per-agent signal volume (is this agent actually contributing?)
 *   - Watchdog/manager health (heartbeat pulses, halt state, queue depth)
 *   - Suggested weight adjustments based on stored accuracy
 *
 * One tRPC namespace gives a unified view of every team member's
 * performance so we can identify profit/loss bottlenecks.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { getDb } from '../db';
import { agentSignals, agentAccuracy, agentPnlAttribution } from '../../drizzle/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

const WINDOW_HOURS = z.number().int().min(1).max(168).default(24);

export const agentScorecardRouter = router({
  /**
   * Per-agent scorecard over a rolling window.
   * Joins live signal activity with stored accuracy records.
   */
  getAgentScorecard: protectedProcedure
    .input(z.object({ windowHours: WINDOW_HOURS }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date(Date.now() - input.windowHours * 60 * 60 * 1000);

      // 1. Signal volume per agent
      const signalCounts = await db
        .select({
          agentName: agentSignals.agentName,
          totalSignals: sql<number>`count(*)`,
          bullishCount: sql<number>`sum(case when signalType like '%bull%' or signalType = 'buy' then 1 else 0 end)`,
          bearishCount: sql<number>`sum(case when signalType like '%bear%' or signalType = 'sell' then 1 else 0 end)`,
          neutralCount: sql<number>`sum(case when signalType = 'neutral' then 1 else 0 end)`,
          avgConfidence: sql<number>`avg(cast(confidence as decimal(8,4)))`,
          lastSeen: sql<Date>`max(timestamp)`,
        })
        .from(agentSignals)
        .where(and(
          eq(agentSignals.userId, ctx.user.id),
          gte(agentSignals.timestamp, since),
        ))
        .groupBy(agentSignals.agentName);

      // 2. Stored accuracy per agent (aggregate across symbols)
      const accRows = await db
        .select()
        .from(agentAccuracy)
        .where(eq(agentAccuracy.userId, ctx.user.id));

      const accByAgent = new Map<string, {
        accuracy: number;
        totalTrades: number;
        correctTrades: number;
        symbols: string[];
      }>();
      for (const r of accRows) {
        const existing = accByAgent.get(r.agentName);
        const acc = parseFloat(r.accuracy);
        const tt = r.totalTrades;
        const ct = r.correctTrades;
        if (!existing) {
          accByAgent.set(r.agentName, {
            accuracy: acc,
            totalTrades: tt,
            correctTrades: ct,
            symbols: [r.symbol],
          });
        } else {
          // Weighted average across symbols
          const newTotal = existing.totalTrades + tt;
          existing.accuracy = newTotal > 0
            ? (existing.accuracy * existing.totalTrades + acc * tt) / newTotal
            : 0;
          existing.totalTrades = newTotal;
          existing.correctTrades = existing.correctTrades + ct;
          existing.symbols.push(r.symbol);
        }
      }

      // 3. Get live in-memory Brier scores from AgentWeightManager
      let brierByAgent: Record<string, number> = {};
      let weightByAgent: Record<string, number> = {};
      try {
        const { getAgentWeightManager } = await import('../services/AgentWeightManager');
        const wm = getAgentWeightManager();
        // Try to expose Brier + current weight per agent
        const agentNames = signalCounts.map((s: any) => s.agentName);
        for (const name of agentNames) {
          try {
            const brier = (wm as any).calculateBrierScore?.(name);
            if (brier !== undefined) brierByAgent[name] = brier;
            const weight = (wm as any).getAgentWeight?.(name) ?? (wm as any).getWeight?.(name);
            if (weight !== undefined) weightByAgent[name] = weight;
          } catch { /* skip */ }
        }
      } catch { /* AgentWeightManager not initialized — ignore */ }

      // 4. Build scorecard
      const scorecard = signalCounts.map((s: any) => {
        const acc = accByAgent.get(s.agentName);
        const brier = brierByAgent[s.agentName];
        const weight = weightByAgent[s.agentName];
        const conf = parseFloat(s.avgConfidence ?? '0');

        // Health classification
        let health: 'excellent' | 'good' | 'fair' | 'poor' | 'no_data' = 'no_data';
        if (acc && acc.totalTrades >= 10) {
          if (acc.accuracy >= 0.60) health = 'excellent';
          else if (acc.accuracy >= 0.55) health = 'good';
          else if (acc.accuracy >= 0.50) health = 'fair';
          else health = 'poor';
        }

        return {
          agentName: s.agentName,
          signalsInWindow: Number(s.totalSignals),
          signalBreakdown: {
            bullish: Number(s.bullishCount ?? 0),
            bearish: Number(s.bearishCount ?? 0),
            neutral: Number(s.neutralCount ?? 0),
          },
          avgConfidence: conf,
          lastSignalAt: s.lastSeen,
          accuracy: acc?.accuracy ?? null,
          totalTrades: acc?.totalTrades ?? 0,
          correctTrades: acc?.correctTrades ?? 0,
          brierScore: brier ?? null,
          currentWeight: weight ?? null,
          symbols: acc?.symbols ?? [],
          health,
        };
      });

      // 5. Add zero-signal agents (silent agents that should be firing)
      for (const [agentName, acc] of accByAgent) {
        if (!scorecard.find(s => s.agentName === agentName)) {
          scorecard.push({
            agentName,
            signalsInWindow: 0,
            signalBreakdown: { bullish: 0, bearish: 0, neutral: 0 },
            avgConfidence: 0,
            lastSignalAt: null,
            accuracy: acc.accuracy,
            totalTrades: acc.totalTrades,
            correctTrades: acc.correctTrades,
            brierScore: brierByAgent[agentName] ?? null,
            currentWeight: weightByAgent[agentName] ?? null,
            symbols: acc.symbols,
            health: 'no_data',
          });
        }
      }

      // Sort: best performers first (by accuracy * trade count)
      scorecard.sort((a, b) => {
        const aScore = (a.accuracy ?? 0) * Math.log(1 + a.totalTrades);
        const bScore = (b.accuracy ?? 0) * Math.log(1 + b.totalTrades);
        return bScore - aScore;
      });

      return scorecard;
    }),

  /**
   * Team-wide summary (the operator's bird's-eye view).
   */
  getTeamSummary: protectedProcedure
    .input(z.object({ windowHours: WINDOW_HOURS }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const since = new Date(Date.now() - input.windowHours * 60 * 60 * 1000);

      // Total signals + distinct agents firing in window
      const [signalAgg] = await db
        .select({
          total: sql<number>`count(*)`,
          distinctAgents: sql<number>`count(distinct agentName)`,
        })
        .from(agentSignals)
        .where(and(
          eq(agentSignals.userId, ctx.user.id),
          gte(agentSignals.timestamp, since),
        ));

      // Total agents with accuracy records
      const [accAgg] = await db
        .select({
          agentsWithRecords: sql<number>`count(distinct agentName)`,
          totalTrades: sql<number>`sum(totalTrades)`,
          weightedAccuracy: sql<number>`sum(cast(accuracy as decimal(8,4)) * totalTrades) / sum(totalTrades)`,
        })
        .from(agentAccuracy)
        .where(eq(agentAccuracy.userId, ctx.user.id));

      // Watchdog/heartbeat status
      let heartbeatStatus: any = null;
      try {
        const { getEngineHeartbeat } = await import('../services/EngineHeartbeat');
        heartbeatStatus = getEngineHeartbeat().status();
      } catch { /* not initialized */ }

      return {
        windowHours: input.windowHours,
        signals: {
          total: Number(signalAgg?.total ?? 0),
          distinctAgents: Number(signalAgg?.distinctAgents ?? 0),
        },
        accuracy: {
          agentsWithRecords: Number(accAgg?.agentsWithRecords ?? 0),
          totalTrades: Number(accAgg?.totalTrades ?? 0),
          weightedAccuracy: accAgg?.weightedAccuracy ? parseFloat(accAgg.weightedAccuracy as any) : null,
        },
        watchdog: heartbeatStatus,
      };
    }),

  /**
   * Watchdog + manager team status — every "decision-maker" service.
   * Heartbeats, halt state, recent activity for the operator review.
   */
  getTeamHealthStatus: protectedProcedure
    .query(async () => {
      const members: Array<{
        name: string;
        role: string;
        status: 'active' | 'halted' | 'idle' | 'unknown';
        details: Record<string, any>;
      }> = [];

      // EngineHeartbeat — the master watchdog
      try {
        const { getEngineHeartbeat } = await import('../services/EngineHeartbeat');
        const hb = getEngineHeartbeat();
        const s = hb.status();
        members.push({
          name: 'EngineHeartbeat',
          role: 'master watchdog (signal/decision/fill/price pulses + daily-PnL halt)',
          status: s.haltActive ? 'halted' : (s.healthy ? 'active' : 'idle'),
          details: {
            haltActive: s.haltActive,
            haltReason: s.haltReason,
            signalIdleSec: s.signalIdleSec,
            decisionIdleSec: s.decisionIdleSec,
            fillIdleSec: s.fillIdleSec,
            priceTickIdleSec: s.priceTickIdleSec,
            dailyPnlPercent: s.dailyPnlPercent,
            reasons: s.reasons,
          },
        });
      } catch (e) {
        members.push({ name: 'EngineHeartbeat', role: 'master watchdog', status: 'unknown', details: { error: (e as Error).message } });
      }

      // PositionGuardian — "positions must never be unmonitored"
      try {
        const { getPositionGuardian } = await import('../services/PositionGuardian');
        const pg = getPositionGuardian();
        const s = (pg as any).getStatus?.() ?? {};
        members.push({
          name: 'PositionGuardian',
          role: 'positions-must-never-be-unmonitored watchdog',
          status: s.engineStaleness !== undefined && s.engineStaleness < 120 ? 'active' : 'idle',
          details: s,
        });
      } catch (e) {
        members.push({ name: 'PositionGuardian', role: 'position monitor', status: 'unknown', details: { error: (e as Error).message } });
      }

      // CircuitBreakerManager
      try {
        const { circuitBreakerManager } = await import('../services/CircuitBreakerManager');
        const stats = (circuitBreakerManager as any).getStats?.() ?? {};
        const allHealthy = !Object.values(stats).some((s: any) => s?.state === 'open');
        members.push({
          name: 'CircuitBreakerManager',
          role: 'per-service circuit breakers (LLM, exchange, on-chain)',
          status: allHealthy ? 'active' : 'halted',
          details: { breakers: stats },
        });
      } catch (e) {
        members.push({ name: 'CircuitBreakerManager', role: 'circuit breakers', status: 'unknown', details: { error: (e as Error).message } });
      }

      // ProfitLockGuard — uses config not instance state, so check config presence
      try {
        const { getTradingConfig } = await import('../config/TradingConfig');
        const cfg = getTradingConfig();
        members.push({
          name: 'ProfitLockGuard',
          role: '"only exit profit" — blocks non-catastrophic exits when net-PnL is negative',
          status: cfg.profitLock?.enabled === false ? 'idle' : 'active',
          details: {
            enabled: cfg.profitLock?.enabled,
            catastrophicStopPercent: cfg.profitLock?.catastrophicStopPercent,
            minNetProfitPercentToClose: cfg.profitLock?.minNetProfitPercentToClose,
            absoluteMaxHoldHours: cfg.profitLock?.absoluteMaxHoldHours,
          },
        });
      } catch (e) {
        members.push({ name: 'ProfitLockGuard', role: 'profit lock', status: 'unknown', details: { error: (e as Error).message } });
      }

      // AgentCorrelationTracker — Phase 70
      try {
        const fs = await import('fs/promises');
        // Can't easily get instance state — surface schedule + cache hits indirectly
        const { getDb } = await import('../db');
        const { agentCorrelations } = await import('../../drizzle/schema');
        const db = await getDb();
        if (db) {
          const rows = await db.select({ count: sql<number>`count(*)` }).from(agentCorrelations);
          const count = Number(rows[0]?.count ?? 0);
          members.push({
            name: 'AgentCorrelationTracker',
            role: 'pairwise agent correlation matrix (powers Bayesian effective-N)',
            status: count > 0 ? 'active' : 'idle',
            details: { correlationPairs: count, recomputeCadenceHours: 6 },
          });
        }
      } catch (e) {
        members.push({ name: 'AgentCorrelationTracker', role: 'correlation matrix', status: 'unknown', details: { error: (e as Error).message } });
      }

      // BayesianAggregator — surface recent gate distribution
      try {
        const { getDb } = await import('../db');
        const { bayesianConsensusLog } = await import('../../drizzle/schema');
        const db = await getDb();
        if (db) {
          const since = new Date(Date.now() - 60 * 60 * 1000);
          const rows = await db
            .select({ gateDecision: bayesianConsensusLog.gateDecision, cnt: sql<number>`count(*)` })
            .from(bayesianConsensusLog)
            .where(gte(bayesianConsensusLog.timestamp, since))
            .groupBy(bayesianConsensusLog.gateDecision);
          const dist: Record<string, number> = {};
          let total = 0;
          for (const r of rows) {
            dist[r.gateDecision] = Number(r.cnt);
            total += Number(r.cnt);
          }
          const approveRate = total > 0 ? (dist['approved'] ?? 0) / total : 0;
          members.push({
            name: 'BayesianAggregator',
            role: 'Phase 70 calibrated consensus (rejects false-confidence)',
            status: total > 0 ? 'active' : 'idle',
            details: { lastHourGateDistribution: dist, approveRate, totalSignals: total },
          });
        }
      } catch (e) {
        members.push({ name: 'BayesianAggregator', role: 'Bayesian gate', status: 'unknown', details: { error: (e as Error).message } });
      }

      return members;
    }),

  /**
   * Top profit contributors + biggest loss bottlenecks.
   * Reads from agentAccuracy joined with the in-memory Brier scores.
   */
  getProfitLossAttribution: protectedProcedure
    .input(z.object({ minTrades: z.number().int().min(1).default(5) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { topContributors: [], bottlenecks: [] };

      const rows = await db
        .select()
        .from(agentAccuracy)
        .where(eq(agentAccuracy.userId, ctx.user.id));

      // Aggregate per agent across symbols
      const byAgent = new Map<string, { accuracy: number; trades: number }>();
      for (const r of rows) {
        const existing = byAgent.get(r.agentName);
        const acc = parseFloat(r.accuracy);
        if (!existing) {
          byAgent.set(r.agentName, { accuracy: acc, trades: r.totalTrades });
        } else {
          const newTrades = existing.trades + r.totalTrades;
          existing.accuracy = (existing.accuracy * existing.trades + acc * r.totalTrades) / newTrades;
          existing.trades = newTrades;
        }
      }

      const records = Array.from(byAgent.entries())
        .filter(([_, v]) => v.trades >= input.minTrades)
        .map(([agentName, v]) => ({
          agentName,
          accuracy: v.accuracy,
          trades: v.trades,
          // Score = accuracy weighted by sample size confidence
          score: v.accuracy * Math.log(1 + v.trades) - 0.5 * Math.log(1 + v.trades),
        }));

      records.sort((a, b) => b.score - a.score);

      return {
        topContributors: records.slice(0, 10),
        bottlenecks: records.slice(-10).reverse(),
      };
    }),

  /**
   * Phase 82 — signed-$ P&L contribution per agent over a window.
   *
   * Sums pnlContribution from the agentPnlAttribution table (one row per
   * closed trade per agent). Tells the operator, in dollars, which agents
   * earned vs cost the book — the truest "who matters" view.
   *
   *   contribution per trade = alignment × confidence × pnlAfterCosts
   *   sum across trades       = the agent's marginal $-impact on the book
   */
  getSignedPnlByAgent: protectedProcedure
    .input(z.object({
      windowHours: WINDOW_HOURS,
      minTrades: z.number().int().min(1).default(1),
      tradingMode: z.enum(['paper', 'live']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { topContributors: [], bottlenecks: [], totalTrades: 0, agents: [] };
      const since = new Date(Date.now() - input.windowHours * 60 * 60 * 1000);

      const whereClauses = [
        eq(agentPnlAttribution.userId, ctx.user.id),
        gte(agentPnlAttribution.closedAt, since),
      ];
      if (input.tradingMode) {
        whereClauses.push(eq(agentPnlAttribution.tradingMode, input.tradingMode));
      }

      const rows = await db
        .select({
          agentName: agentPnlAttribution.agentName,
          totalContribution: sql<string>`sum(cast(pnlContribution as decimal(18,6)))`,
          tradeCount: sql<number>`count(*)`,
          correctCount: sql<number>`sum(case when wasCorrect = true then 1 else 0 end)`,
          avgConfidence: sql<string>`avg(cast(agentConfidence as decimal(8,4)))`,
          maxGain: sql<string>`max(cast(pnlContribution as decimal(18,6)))`,
          maxLoss: sql<string>`min(cast(pnlContribution as decimal(18,6)))`,
        })
        .from(agentPnlAttribution)
        .where(and(...whereClauses))
        .groupBy(agentPnlAttribution.agentName);

      const distinctTrades = await db
        .select({ count: sql<number>`count(distinct tradeId)` })
        .from(agentPnlAttribution)
        .where(and(...whereClauses));

      const agents = rows
        .map((r: any) => ({
          agentName: r.agentName,
          netContribution: parseFloat(r.totalContribution ?? '0'),
          tradeCount: Number(r.tradeCount ?? 0),
          correctCount: Number(r.correctCount ?? 0),
          accuracy: Number(r.tradeCount) > 0 ? Number(r.correctCount) / Number(r.tradeCount) : 0,
          avgConfidence: parseFloat(r.avgConfidence ?? '0'),
          maxGain: parseFloat(r.maxGain ?? '0'),
          maxLoss: parseFloat(r.maxLoss ?? '0'),
        }))
        .filter(a => a.tradeCount >= input.minTrades);

      agents.sort((a, b) => b.netContribution - a.netContribution);

      return {
        windowHours: input.windowHours,
        tradingMode: input.tradingMode ?? 'all',
        totalTrades: Number(distinctTrades[0]?.count ?? 0),
        agents,
        topContributors: agents.slice(0, 10),
        bottlenecks: [...agents].reverse().slice(0, 10),
      };
    }),

  /**
   * Phase 82 — per-trade signed attribution.
   * Given a tradeId, returns each agent's vote + signed contribution.
   * Used by the trade-detail UI to show "who voted what, how much it earned".
   */
  getAttributionForTrade: protectedProcedure
    .input(z.object({ tradeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(agentPnlAttribution)
        .where(and(
          eq(agentPnlAttribution.userId, ctx.user.id),
          eq(agentPnlAttribution.tradeId, input.tradeId),
        ));
      return rows.map((r: any) => ({
        agentName: r.agentName,
        agentDirection: r.agentDirection,
        agentConfidence: parseFloat(r.agentConfidence ?? '0'),
        pnlContribution: parseFloat(r.pnlContribution ?? '0'),
        wasCorrect: !!r.wasCorrect,
        tradePnl: parseFloat(r.tradePnl ?? '0'),
        tradeSide: r.tradeSide,
        symbol: r.symbol,
        exitReason: r.exitReason,
        closedAt: r.closedAt,
      })).sort((a: any, b: any) => Math.abs(b.pnlContribution) - Math.abs(a.pnlContribution));
    }),
});
