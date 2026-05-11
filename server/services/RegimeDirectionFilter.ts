import { EventEmitter } from "events";
import { getActiveClock } from '../_core/clock';
import type { AgentSignal } from "../agents/AgentBase";

/**
 * RegimeDirectionFilter - A++ Grade Market Regime Alignment
 * 
 * Based on backtest findings:
 * - 67% of losing trades were LONG in a DOWNTREND
 * - 27% of losing trades were SHORT in an UPTREND
 * - 100% of winning trades were in TRENDING markets
 * 
 * This filter ensures trades are only taken in the direction of the prevailing trend.
 */

export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'choppy' | 'unknown';
export type AllowedActions = ('buy' | 'sell')[];

export interface RegimeState {
  regime: MarketRegime;
  confidence: number;
  allowedActions: AllowedActions;
  lastUpdated: number;
  source: string;
}

export interface RegimeFilterDecision {
  allowed: boolean;
  reason: string;
  regime: MarketRegime;
  requestedAction: 'buy' | 'sell';
}

// A++ Grade Regime-Action Mapping
// Based on institutional trading practices
const REGIME_ALLOWED_ACTIONS: Record<MarketRegime, AllowedActions> = {
  'trending_up': ['buy'],      // Only longs in uptrend
  'trending_down': ['sell'],   // Only shorts in downtrend
  'ranging': ['buy', 'sell'],  // Both allowed in range (mean reversion)
  'volatile': [],              // NO trading in volatile markets
  'choppy': [],                // NO trading in choppy markets
  'unknown': [],               // NO trading when regime unknown
};

export class RegimeDirectionFilter extends EventEmitter {
  private regimeState: RegimeState = {
    regime: 'unknown',
    confidence: 0,
    allowedActions: [],
    lastUpdated: 0,
    source: 'none',
  };

  // A++ Grade Configuration
  private readonly MIN_REGIME_CONFIDENCE = 0.60; // 60% confidence required
  private readonly REGIME_STALE_MS = 15 * 60 * 1000; // 15 minutes

  constructor() {
    super();
    console.log(`[RegimeDirectionFilter] Initialized - A++ Grade Regime Alignment`);
    console.log(`[RegimeDirectionFilter] Min Regime Confidence: ${(this.MIN_REGIME_CONFIDENCE * 100).toFixed(0)}%`);
  }

  /**
   * Update regime state from agent signals
   */
  updateRegime(signals: AgentSignal[]): void {
    // Try to get regime from MacroAnalyst first (most reliable)
    const macroSignal = signals.find(s => s.agentName === 'MacroAnalyst');
    if (macroSignal?.evidence?.regime) {
      this.setRegime(
        this.normalizeRegime(macroSignal.evidence.regime),
        macroSignal.confidence,
        'MacroAnalyst'
      );
      return;
    }

    // Fallback: Derive regime from consensus of agent signals
    const bullishCount = signals.filter(s => s.signal === 'bullish').length;
    const bearishCount = signals.filter(s => s.signal === 'bearish').length;
    const neutralCount = signals.filter(s => s.signal === 'neutral').length;
    const total = signals.length;

    if (total === 0) {
      this.setRegime('unknown', 0, 'no_signals');
      return;
    }

    const bullishRatio = bullishCount / total;
    const bearishRatio = bearishCount / total;
    const neutralRatio = neutralCount / total;

    // Strong bullish consensus = trending up
    if (bullishRatio >= 0.6) {
      this.setRegime('trending_up', bullishRatio, 'consensus');
      return;
    }

    // Strong bearish consensus = trending down
    if (bearishRatio >= 0.6) {
      this.setRegime('trending_down', bearishRatio, 'consensus');
      return;
    }

    // High neutral = ranging or choppy
    if (neutralRatio >= 0.5) {
      this.setRegime('ranging', neutralRatio, 'consensus');
      return;
    }

    // Mixed signals = volatile/choppy
    if (Math.abs(bullishRatio - bearishRatio) < 0.2) {
      this.setRegime('choppy', 0.5, 'consensus');
      return;
    }

    // Default to unknown
    this.setRegime('unknown', 0.3, 'consensus');
  }

  /**
   * Set regime state
   */
  private setRegime(regime: MarketRegime, confidence: number, source: string): void {
    this.regimeState = {
      regime,
      confidence,
      allowedActions: REGIME_ALLOWED_ACTIONS[regime],
      lastUpdated: getActiveClock().now(),
      source,
    };

    console.log(`[RegimeDirectionFilter] Regime updated: ${regime} (${(confidence * 100).toFixed(1)}% confidence)`);
    console.log(`[RegimeDirectionFilter] Allowed actions: ${this.regimeState.allowedActions.join(', ') || 'NONE'}`);
    
    this.emit('regime_updated', this.regimeState);
  }

  /**
   * Normalize regime string to standard format
   */
  private normalizeRegime(regime: string): MarketRegime {
    const normalized = regime.toLowerCase().replace(/[^a-z]/g, '_');
    
    if (normalized.includes('up') || normalized.includes('bull')) return 'trending_up';
    if (normalized.includes('down') || normalized.includes('bear')) return 'trending_down';
    if (normalized.includes('rang')) return 'ranging';
    if (normalized.includes('volat')) return 'volatile';
    if (normalized.includes('chop')) return 'choppy';
    if (normalized === 'risk_on' || normalized === 'riskon') return 'trending_up';
    if (normalized === 'risk_off' || normalized === 'riskoff') return 'trending_down';
    if (normalized === 'transitioning') return 'choppy';
    
    return 'unknown';
  }

  /**
   * Check if an action is allowed in current regime
   */
  checkActionAllowed(action: 'buy' | 'sell', symbol: string): RegimeFilterDecision {
    const now = getActiveClock().now();

    // Check 1: Is regime data fresh?
    if (now - this.regimeState.lastUpdated > this.REGIME_STALE_MS) {
      return {
        allowed: false,
        reason: `Regime data stale (${Math.round((now - this.regimeState.lastUpdated) / 60000)} min old). Waiting for fresh regime analysis.`,
        regime: this.regimeState.regime,
        requestedAction: action,
      };
    }

    // Check 2: Is regime confidence sufficient?
    if (this.regimeState.confidence < this.MIN_REGIME_CONFIDENCE) {
      return {
        allowed: false,
        reason: `Regime confidence too low: ${(this.regimeState.confidence * 100).toFixed(1)}% < ${(this.MIN_REGIME_CONFIDENCE * 100).toFixed(0)}% required`,
        regime: this.regimeState.regime,
        requestedAction: action,
      };
    }

    // Check 3: Is the action allowed in current regime?
    const allowedActions = this.regimeState.allowedActions;
    
    if (allowedActions.length === 0) {
      return {
        allowed: false,
        reason: `NO trading allowed in ${this.regimeState.regime.toUpperCase()} regime. ` +
                `Market conditions unfavorable for any directional trades.`,
        regime: this.regimeState.regime,
        requestedAction: action,
      };
    }

    if (!allowedActions.includes(action)) {
      const oppositeAction = action === 'buy' ? 'SELL' : 'BUY';
      return {
        allowed: false,
        reason: `${action.toUpperCase()} not allowed in ${this.regimeState.regime.toUpperCase()} regime. ` +
                `Backtest showed 67% of losses were counter-trend trades. ` +
                `Only ${allowedActions.map(a => a.toUpperCase()).join('/')} allowed.`,
        regime: this.regimeState.regime,
        requestedAction: action,
      };
    }

    // Action is allowed
    return {
      allowed: true,
      reason: `${action.toUpperCase()} allowed in ${this.regimeState.regime.toUpperCase()} regime (${(this.regimeState.confidence * 100).toFixed(1)}% confidence)`,
      regime: this.regimeState.regime,
      requestedAction: action,
    };
  }

  /**
   * Get current regime state
   */
  getRegimeState(): RegimeState {
    return { ...this.regimeState };
  }

  /**
   * Check if regime data is fresh
   */
  isRegimeDataFresh(): boolean {
    return (getActiveClock().now() - this.regimeState.lastUpdated) < this.REGIME_STALE_MS;
  }

  /**
   * Get allowed actions for current regime
   */
  getAllowedActions(): AllowedActions {
    return [...this.regimeState.allowedActions];
  }
}

// Singleton instance
let regimeDirectionFilter: RegimeDirectionFilter | null = null;

export function getRegimeDirectionFilter(): RegimeDirectionFilter {
  if (!regimeDirectionFilter) {
    regimeDirectionFilter = new RegimeDirectionFilter();
  }
  return regimeDirectionFilter;
}
