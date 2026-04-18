import { EventEmitter } from "events";
import type { AgentSignal } from "../agents/AgentBase";
import type { ProcessedSignal, Consensus } from "./AutomatedSignalProcessor";

/**
 * MacroVetoEnforcer - A++ Grade Institutional Trading Filter
 * 
 * This service enforces the critical finding from the backtest audit:
 * 93% of losing trades went AGAINST the MacroAnalyst signal.
 * 
 * The MacroVetoEnforcer acts as a MANDATORY gate before any trade execution:
 * 1. Extracts macro trend direction from MacroAnalyst signal
 * 2. Blocks trades that go against the macro trend
 * 3. Requires minimum confidence from MacroAnalyst
 * 4. Provides detailed rejection reasons for audit trail
 * 
 * This is the single most impactful fix identified in the comprehensive audit.
 * Implementing this alone would have prevented 93% of losses.
 */

export interface MacroTrendState {
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  regime: string;
  vetoActive: boolean;
  vetoReason: string;
  lastUpdated: number;
}

export interface VetoDecision {
  allowed: boolean;
  reason: string;
  macroTrend: MacroTrendState;
  requestedAction: 'buy' | 'sell';
  trendAlignment: 'aligned' | 'against' | 'neutral';
}

export class MacroVetoEnforcer extends EventEmitter {
  private macroTrendState: MacroTrendState = {
    direction: 'neutral',
    confidence: 0,
    regime: 'unknown',
    vetoActive: false,
    vetoReason: '',
    lastUpdated: 0,
  };

  // A++ Grade Configuration
  private readonly MIN_MACRO_CONFIDENCE = 0.50; // Minimum 50% confidence to trust macro signal
  private readonly TREND_STALE_MS = 30 * 60 * 1000; // 30 minutes - macro data considered stale
  private readonly ALLOW_NEUTRAL_TRADES = false; // Don't trade when macro is neutral

  constructor() {
    super();
    console.log(`[MacroVetoEnforcer] Initialized - A++ Grade Trend Alignment Filter`);
    console.log(`[MacroVetoEnforcer] Min Macro Confidence: ${(this.MIN_MACRO_CONFIDENCE * 100).toFixed(0)}%`);
    console.log(`[MacroVetoEnforcer] Trend Stale Threshold: ${this.TREND_STALE_MS / 60000} minutes`);
  }

  /**
   * Update macro trend state from MacroAnalyst signal
   * Called whenever new signals are received
   */
  updateMacroTrend(signals: AgentSignal[]): void {
    const macroSignal = signals.find(s => s.agentName === 'MacroAnalyst');
    
    if (!macroSignal) {
      console.warn(`[MacroVetoEnforcer] No MacroAnalyst signal found in batch`);
      return;
    }

    const evidence = macroSignal.evidence || {};
    
    this.macroTrendState = {
      direction: macroSignal.signal as 'bullish' | 'bearish' | 'neutral',
      confidence: macroSignal.confidence,
      regime: evidence.regime || 'unknown',
      vetoActive: evidence.vetoActive || false,
      vetoReason: evidence.vetoReason || '',
      lastUpdated: Date.now(),
    };

    console.log(`[MacroVetoEnforcer] Macro trend updated: ${this.macroTrendState.direction} (${(this.macroTrendState.confidence * 100).toFixed(1)}%)`);
    console.log(`[MacroVetoEnforcer] Regime: ${this.macroTrendState.regime}, Veto: ${this.macroTrendState.vetoActive}`);
    
    this.emit('macro_trend_updated', this.macroTrendState);
  }

  /**
   * Check if a trade is allowed based on macro trend alignment
   * This is the CRITICAL gate that prevents 93% of losses
   */
  checkTradeAllowed(action: 'buy' | 'sell', symbol: string): VetoDecision {
    const now = Date.now();
    
    // Check 1: Is macro data fresh?
    if (now - this.macroTrendState.lastUpdated > this.TREND_STALE_MS) {
      return {
        allowed: false,
        reason: `Macro data stale (${Math.round((now - this.macroTrendState.lastUpdated) / 60000)} min old). Waiting for fresh macro analysis.`,
        macroTrend: this.macroTrendState,
        requestedAction: action,
        trendAlignment: 'neutral',
      };
    }

    // Check 2: Is there an active veto from MacroAnalyst?
    if (this.macroTrendState.vetoActive) {
      return {
        allowed: false,
        reason: `MacroAnalyst VETO active: ${this.macroTrendState.vetoReason}`,
        macroTrend: this.macroTrendState,
        requestedAction: action,
        trendAlignment: 'against',
      };
    }

    // Check 3: Is macro confidence sufficient?
    if (this.macroTrendState.confidence < this.MIN_MACRO_CONFIDENCE) {
      return {
        allowed: false,
        reason: `Macro confidence too low: ${(this.macroTrendState.confidence * 100).toFixed(1)}% < ${(this.MIN_MACRO_CONFIDENCE * 100).toFixed(0)}% required`,
        macroTrend: this.macroTrendState,
        requestedAction: action,
        trendAlignment: 'neutral',
      };
    }

    // Check 4: Is macro trend neutral?
    if (this.macroTrendState.direction === 'neutral' && !this.ALLOW_NEUTRAL_TRADES) {
      return {
        allowed: false,
        reason: `Macro trend is NEUTRAL. No directional trades allowed until clear trend emerges.`,
        macroTrend: this.macroTrendState,
        requestedAction: action,
        trendAlignment: 'neutral',
      };
    }

    // Check 5: THE CRITICAL CHECK - Is trade aligned with macro trend?
    // This is what would have prevented 93% of losses
    const isAligned = this.checkTrendAlignment(action, this.macroTrendState.direction);
    
    if (!isAligned) {
      return {
        allowed: false,
        reason: `TRADE BLOCKED: ${action.toUpperCase()} is AGAINST macro trend (${this.macroTrendState.direction.toUpperCase()}). ` +
                `Backtest showed 93% of losses came from counter-trend trades. ` +
                `Only ${action === 'buy' ? 'SELL' : 'BUY'} trades allowed in current ${this.macroTrendState.direction} macro environment.`,
        macroTrend: this.macroTrendState,
        requestedAction: action,
        trendAlignment: 'against',
      };
    }

    // Trade is allowed - aligned with macro trend
    return {
      allowed: true,
      reason: `Trade ALLOWED: ${action.toUpperCase()} aligned with ${this.macroTrendState.direction.toUpperCase()} macro trend (${(this.macroTrendState.confidence * 100).toFixed(1)}% confidence)`,
      macroTrend: this.macroTrendState,
      requestedAction: action,
      trendAlignment: 'aligned',
    };
  }

  /**
   * Check if action is aligned with macro trend direction
   */
  private checkTrendAlignment(action: 'buy' | 'sell', macroDirection: 'bullish' | 'bearish' | 'neutral'): boolean {
    if (macroDirection === 'neutral') {
      return this.ALLOW_NEUTRAL_TRADES;
    }

    // BUY only allowed in BULLISH macro
    // SELL only allowed in BEARISH macro
    if (action === 'buy' && macroDirection === 'bullish') return true;
    if (action === 'sell' && macroDirection === 'bearish') return true;

    return false;
  }

  /**
   * Filter processed signals through macro veto
   * Returns modified ProcessedSignal with veto applied if needed
   */
  filterSignal(signal: ProcessedSignal): ProcessedSignal {
    if (!signal.approved || !signal.recommendation) {
      return signal;
    }

    const vetoDecision = this.checkTradeAllowed(
      signal.recommendation.action,
      signal.symbol
    );

    if (!vetoDecision.allowed) {
      console.log(`[MacroVetoEnforcer] 🚫 BLOCKED ${signal.symbol} ${signal.recommendation.action.toUpperCase()}`);
      console.log(`[MacroVetoEnforcer] Reason: ${vetoDecision.reason}`);
      
      this.emit('trade_blocked', {
        symbol: signal.symbol,
        action: signal.recommendation.action,
        reason: vetoDecision.reason,
        macroTrend: vetoDecision.macroTrend,
      });

      return {
        ...signal,
        approved: false,
        reason: `MACRO VETO: ${vetoDecision.reason}`,
      };
    }

    console.log(`[MacroVetoEnforcer] ✅ ALLOWED ${signal.symbol} ${signal.recommendation.action.toUpperCase()}`);
    console.log(`[MacroVetoEnforcer] Aligned with ${vetoDecision.macroTrend.direction} trend`);
    
    this.emit('trade_allowed', {
      symbol: signal.symbol,
      action: signal.recommendation.action,
      macroTrend: vetoDecision.macroTrend,
    });

    return signal;
  }

  /**
   * Get current macro trend state
   */
  getMacroTrendState(): MacroTrendState {
    return { ...this.macroTrendState };
  }

  /**
   * Check if macro data is fresh
   */
  isMacroDataFresh(): boolean {
    return (Date.now() - this.macroTrendState.lastUpdated) < this.TREND_STALE_MS;
  }

  /**
   * Get statistics on blocked vs allowed trades
   */
  getStats(): { blocked: number; allowed: number; blockRate: number } {
    // This would be tracked over time - placeholder for now
    return {
      blocked: 0,
      allowed: 0,
      blockRate: 0,
    };
  }
}

// Singleton instance
let macroVetoEnforcer: MacroVetoEnforcer | null = null;

export function getMacroVetoEnforcer(): MacroVetoEnforcer {
  if (!macroVetoEnforcer) {
    macroVetoEnforcer = new MacroVetoEnforcer();
  }
  return macroVetoEnforcer;
}
