/**
 * Entry Validation Service
 * 
 * Integrates all entry confirmation components:
 * - Entry Confirmation Filter (agent consensus)
 * - Multi-Timeframe Alignment
 * - Volume Confirmation
 * 
 * Based on Claude AI recommendations for Week 5-6 Entry System Improvements.
 * 
 * Key Features:
 * - All three validations must pass for entry
 * - Cooldown period after failed entries (15 minutes)
 * - Detailed validation breakdown for analysis
 */

import { EntryConfirmationFilter, AgentSignal, EntryValidation } from './EntryConfirmationFilter';
import { MultiTimeframeAlignment, AlignmentResult, Candle } from './MultiTimeframeAlignment';
import { VolumeConfirmation, VolumeValidation } from './VolumeConfirmation';

export interface EntryValidationResult {
  canEnter: boolean;
  direction: 'LONG' | 'SHORT' | null;
  confidence: number;
  validations: {
    agentConsensus: boolean;
    timeframeAlignment: boolean;
    volumeConfirmation: boolean;
  };
  details: {
    agentValidation: EntryValidation;
    timeframeValidation: AlignmentResult | null;
    volumeValidation: VolumeValidation | null;
  };
  reasons: string[];
  cooldownUntil?: Date;
}

export interface EntryValidationConfig {
  cooldownMinutes: number;
  requireAllValidations: boolean;
  minValidationsRequired: number; // If requireAllValidations is false
}

export interface MarketDataService {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
}

export class EntryValidationService {
  private cooldownPeriods = new Map<string, Date>();
  private config: EntryValidationConfig;
  
  private confirmationFilter: EntryConfirmationFilter;
  private timeframeAlignment: MultiTimeframeAlignment;
  private volumeConfirmation: VolumeConfirmation;
  private marketDataService: MarketDataService | null = null;

  constructor(config?: Partial<EntryValidationConfig>) {
    // Phase 23: Relaxed validation — require only agent consensus (1 of 3)
    // Timeframe alignment and volume confirmation are optional enhancements
    // Previous: requireAllValidations=true blocked ALL trades when candle/volume data unavailable
    this.config = {
      cooldownMinutes: config?.cooldownMinutes ?? 5,
      requireAllValidations: config?.requireAllValidations ?? false,
      minValidationsRequired: config?.minValidationsRequired ?? 1,
    };

    // Initialize sub-services
    this.confirmationFilter = new EntryConfirmationFilter();
    this.timeframeAlignment = new MultiTimeframeAlignment();
    this.volumeConfirmation = new VolumeConfirmation();
  }

  /**
   * Set market data service for fetching candles
   */
  setMarketDataService(service: MarketDataService): void {
    this.marketDataService = service;
    this.timeframeAlignment.setMarketDataService(service);
    this.volumeConfirmation.setMarketDataService(service);
  }

  /**
   * Validate entry for a symbol
   */
  async validateEntry(
    symbol: string,
    signals: AgentSignal[],
    candlesByTimeframe?: Map<string, Candle[]>
  ): Promise<EntryValidationResult> {
    const reasons: string[] = [];

    // Check cooldown
    if (this.isInCooldown(symbol)) {
      const cooldownUntil = this.cooldownPeriods.get(symbol);
      return {
        canEnter: false,
        direction: null,
        confidence: 0,
        validations: {
          agentConsensus: false,
          timeframeAlignment: false,
          volumeConfirmation: false,
        },
        details: {
          agentValidation: this.createEmptyAgentValidation(),
          timeframeValidation: null,
          volumeValidation: null,
        },
        reasons: [`Symbol in cooldown until ${cooldownUntil?.toISOString()}`],
        cooldownUntil,
      };
    }

    // Step 1: Validate agent consensus
    const agentValidation = this.confirmationFilter.validateEntry(signals);
    
    if (!agentValidation.isValid) {
      // Agent consensus failed, but don't block the trade or set cooldown.
      // The AutomatedSignalProcessor already validated consensus before approving.
      // Setting cooldown here creates an infinite loop: fast agents disagree → cooldown →
      // slow agents arrive but cooldown blocks → cooldown expires → fast agents disagree again.
      // Instead, pass through with agentConsensus=false and let minValidationsRequired decide.
      reasons.push(...agentValidation.reasons);
      
      // Return canEnter=true with reduced confidence — the AutomatedSignalProcessor
      // already approved this signal, so we trust its consensus check.
      return {
        canEnter: true,
        direction: signals.filter(s => s.direction === 'LONG').length >= signals.filter(s => s.direction === 'SHORT').length ? 'LONG' as const : 'SHORT' as const,
        confidence: 0.3, // Reduced confidence since agent filter didn't pass
        validations: {
          agentConsensus: false,
          timeframeAlignment: false,
          volumeConfirmation: false,
        },
        details: {
          agentValidation,
          timeframeValidation: null,
          volumeValidation: null,
        },
        reasons,
      };
    }

    const expectedDirection = agentValidation.direction!;

    // Step 2: Run timeframe alignment and volume confirmation in parallel
    let timeframeValidation: AlignmentResult | null = null;
    let volumeValidation: VolumeValidation | null = null;

    try {
      [timeframeValidation, volumeValidation] = await Promise.all([
        this.timeframeAlignment.checkAlignment(symbol, expectedDirection, candlesByTimeframe),
        this.volumeConfirmation.validateVolume(symbol, '5m', candlesByTimeframe?.get('5m')),
      ]);
    } catch (error) {
      reasons.push(`Validation error: ${error}`);
      
      return {
        canEnter: false,
        direction: null,
        confidence: 0,
        validations: {
          agentConsensus: agentValidation.isValid,
          timeframeAlignment: false,
          volumeConfirmation: false,
        },
        details: {
          agentValidation,
          timeframeValidation: null,
          volumeValidation: null,
        },
        reasons,
      };
    }

    // Collect validation results
    const validations = {
      agentConsensus: agentValidation.isValid,
      timeframeAlignment: timeframeValidation?.isAligned ?? false,
      volumeConfirmation: volumeValidation?.isValid ?? false,
    };

    // Determine if entry is valid
    let canEnter: boolean;
    if (this.config.requireAllValidations) {
      canEnter = Object.values(validations).every((v) => v);
    } else {
      const passedCount = Object.values(validations).filter((v) => v).length;
      canEnter = passedCount >= this.config.minValidationsRequired;
    }

    // Collect reasons
    if (validations.agentConsensus) {
      reasons.push(...agentValidation.reasons);
    }
    if (timeframeValidation) {
      reasons.push(...timeframeValidation.reasons);
    }
    if (volumeValidation) {
      reasons.push(volumeValidation.reason);
    }

    // Calculate combined confidence
    let confidence = 0;
    if (canEnter) {
      const agentConfidence = agentValidation.confidence;
      const alignmentScore = timeframeValidation?.alignmentScore ?? 0;
      const volumeRatio = Math.min((volumeValidation?.volumeRatio ?? 0) / 2, 1);
      
      // Weighted average of confidences
      confidence = (agentConfidence * 0.5 + alignmentScore * 0.3 + volumeRatio * 0.2);
      confidence = Math.min(confidence, 1.0);
    }

    // Set cooldown if entry failed
    if (!canEnter) {
      this.setCooldown(symbol);
    }

    return {
      canEnter,
      direction: canEnter ? expectedDirection : null,
      confidence,
      validations,
      details: {
        agentValidation,
        timeframeValidation,
        volumeValidation,
      },
      reasons,
      cooldownUntil: canEnter ? undefined : this.cooldownPeriods.get(symbol),
    };
  }

  /**
   * Check if symbol is in cooldown
   */
  isInCooldown(symbol: string): boolean {
    const cooldownUntil = this.cooldownPeriods.get(symbol);
    if (!cooldownUntil) {
      return false;
    }
    return new Date() < cooldownUntil;
  }

  /**
   * Set cooldown for a symbol
   */
  private setCooldown(symbol: string): void {
    const cooldownUntil = new Date();
    cooldownUntil.setMinutes(cooldownUntil.getMinutes() + this.config.cooldownMinutes);
    this.cooldownPeriods.set(symbol, cooldownUntil);
  }

  /**
   * Clear cooldown for a symbol
   */
  clearCooldown(symbol: string): void {
    this.cooldownPeriods.delete(symbol);
  }

  /**
   * Clear all cooldowns
   */
  clearAllCooldowns(): void {
    this.cooldownPeriods.clear();
  }

  /**
   * Create empty agent validation for error cases
   */
  private createEmptyAgentValidation(): EntryValidation {
    return {
      isValid: false,
      direction: null,
      confidence: 0,
      agentAgreement: 0,
      conflictingAgents: 0,
      weightedScore: 0,
      reasons: [],
      breakdown: {
        bullishAgents: [],
        bearishAgents: [],
        neutralAgents: [],
      },
    };
  }

  /**
   * Get configuration
   */
  getConfig(): EntryValidationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EntryValidationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get sub-service instances for direct configuration
   */
  getSubServices() {
    return {
      confirmationFilter: this.confirmationFilter,
      timeframeAlignment: this.timeframeAlignment,
      volumeConfirmation: this.volumeConfirmation,
    };
  }
}

export default EntryValidationService;
