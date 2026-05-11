/**
 * AgentPnlAttributor — Phase 82
 *
 * Computes signed dollar P&L contribution per agent per closed trade.
 *
 * Boolean win/loss accuracy (agentAccuracy table) tells us *how often* an
 * agent is right. This service tells us *how much money* each agent's
 * voice has earned or cost us — the dollar bottom-line view the operator
 * needs to identify true P&L bottlenecks vs noise.
 *
 * Attribution formula (per agent, per trade):
 *
 *   alignment  = +1 if agent voted with the trade direction
 *                -1 if agent voted against the trade direction
 *                 0 if agent voted neutral
 *
 *   contribution = alignment × confidence × pnlAfterCosts
 *
 * Interpretation:
 *   - High-conf agent that voted WITH a winning trade  → large +$
 *   - High-conf agent that voted WITH a losing trade   → large –$
 *   - High-conf agent that voted AGAINST a winning trade → large –$
 *     (penalises agents who would have steered us into the wrong direction)
 *   - High-conf agent that voted AGAINST a losing trade → large +$
 *     (rewards agents who flagged the bad trade we ignored)
 *   - Neutral votes → 0 contribution (the agent sat out)
 *
 * Rolled up over many trades, the per-agent sum approximates each agent's
 * marginal dollar impact on the book. The UI surfaces top contributors
 * (most $ earned) and bottlenecks (most $ lost).
 */

import { getDb } from '../db';
import { agentPnlAttribution } from '../../drizzle/schema';
import { agentLogger as logger } from '../utils/logger';

export interface AgentVoteAtEntry {
  agentName: string;
  /**
   * Direction as recorded by DecisionEvaluator at entry:
   *   'bullish' | 'bearish' | 'neutral' | 'long' | 'short' | numeric (signed)
   */
  signal: string | number;
  confidence: number;
}

export interface AttributeArgs {
  userId: number;
  tradeId: number;
  symbol: string;
  tradeSide: 'long' | 'short';
  agentSignals: AgentVoteAtEntry[];
  pnl: number;
  exitReason: string;
  tradeQualityScore?: string;
  tradingMode?: 'paper' | 'live';
  closedAt: Date;
}

function normaliseAgentDirection(signal: string | number): 'bullish' | 'bearish' | 'neutral' {
  if (typeof signal === 'number') {
    if (signal > 0.01) return 'bullish';
    if (signal < -0.01) return 'bearish';
    return 'neutral';
  }
  const s = signal.toString().toLowerCase();
  if (s === 'bullish' || s === 'long' || s === 'buy' || s === 'up') return 'bullish';
  if (s === 'bearish' || s === 'short' || s === 'sell' || s === 'down') return 'bearish';
  return 'neutral';
}

/**
 * Convert agent direction + trade side into alignment scalar (+1 / -1 / 0).
 */
function computeAlignment(
  agentDir: 'bullish' | 'bearish' | 'neutral',
  tradeSide: 'long' | 'short',
): -1 | 0 | 1 {
  if (agentDir === 'neutral') return 0;
  const tradeIsBullish = tradeSide === 'long';
  const agentIsBullish = agentDir === 'bullish';
  return tradeIsBullish === agentIsBullish ? 1 : -1;
}

/**
 * Whether the agent's vote was directionally correct given the realised P&L.
 *  - aligned + winning trade   → correct
 *  - opposed + losing  trade   → correct (would have saved us money)
 *  - aligned + losing  trade   → incorrect
 *  - opposed + winning trade   → incorrect (would have made us miss the win)
 *  - neutral                   → considered incorrect (no contribution)
 */
function wasDirectionallyCorrect(alignment: -1 | 0 | 1, pnl: number): boolean {
  if (alignment === 0) return false;
  const tradeWon = pnl > 0;
  const agentBettedOnWin = alignment === 1;
  return tradeWon === agentBettedOnWin;
}

class AgentPnlAttributor {
  /**
   * Compute + persist one attribution row per agent for the closed trade.
   * Returns the number of rows written. Errors are caught and logged —
   * attribution failure must NEVER break the trade-close pipeline.
   */
  async attribute(args: AttributeArgs): Promise<number> {
    if (!Array.isArray(args.agentSignals) || args.agentSignals.length === 0) {
      logger.warn('[AgentPnlAttributor] no agent signals on closed trade — skipping', {
        tradeId: args.tradeId,
        symbol: args.symbol,
      });
      return 0;
    }

    const db = await getDb();
    if (!db) {
      logger.warn('[AgentPnlAttributor] DB unavailable — attribution dropped');
      return 0;
    }

    const rows = args.agentSignals.map(v => {
      const dir = normaliseAgentDirection(v.signal);
      const alignment = computeAlignment(dir, args.tradeSide);
      const conf = Number.isFinite(v.confidence) ? Math.abs(v.confidence) : 0;
      const contribution = alignment * conf * args.pnl;
      return {
        userId: args.userId,
        tradeId: args.tradeId,
        agentName: v.agentName,
        symbol: args.symbol,
        tradeSide: args.tradeSide,
        agentDirection: dir,
        agentConfidence: conf.toFixed(4),
        pnlContribution: contribution.toFixed(6),
        tradePnl: args.pnl.toFixed(6),
        wasCorrect: wasDirectionallyCorrect(alignment, args.pnl),
        tradeQualityScore: args.tradeQualityScore?.slice(0, 2) ?? null,
        exitReason: args.exitReason?.slice(0, 64) ?? null,
        tradingMode: args.tradingMode ?? null,
        closedAt: args.closedAt,
      };
    });

    try {
      await db.insert(agentPnlAttribution).values(rows);
      logger.info('[AgentPnlAttributor] attribution persisted', {
        tradeId: args.tradeId,
        agents: rows.length,
        pnl: args.pnl.toFixed(2),
        side: args.tradeSide,
      });
      return rows.length;
    } catch (err) {
      logger.error('[AgentPnlAttributor] DB insert failed', {
        error: (err as Error)?.message,
        tradeId: args.tradeId,
      });
      return 0;
    }
  }
}

let _attributor: AgentPnlAttributor | null = null;
export function getAgentPnlAttributor(): AgentPnlAttributor {
  if (!_attributor) _attributor = new AgentPnlAttributor();
  return _attributor;
}

// Exported for backfill scripts + tests
export const __agentPnlAttribution_internals__ = {
  normaliseAgentDirection,
  computeAlignment,
  wasDirectionallyCorrect,
};
