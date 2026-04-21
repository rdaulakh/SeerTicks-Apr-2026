/**
 * EntryGates.test.ts
 *
 * Unit tests for the entry-gate audit restoration:
 *  - EntryValidationService fail-closed on agent-consensus mismatch (default)
 *  - EntryValidationService fail-open preserved under backward-compat flag
 *  - AutomatedSignalProcessor candle-availability gate
 *  - AutomatedSignalProcessor price-feed staleness gate
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── 1. Mock the DB candle loader BEFORE importing the SUT ──────────────────
vi.mock('../../db/candleStorage', () => ({
  loadCandlesFromDatabase: vi.fn(),
}));

// ── 2. Mock the price feed service BEFORE importing the SUT ────────────────
vi.mock('../priceFeedService', () => ({
  priceFeedService: {
    getLatestPrice: vi.fn(),
  },
}));

// ── 3. Mock helpers used downstream by processSignals so the test stays
//       focused on the two gates under test.
vi.mock('../AgentWeightManager', () => ({
  getAgentWeightManager: () => ({
    getConsensusWeights: () => ({ Alpha: 0.1, Beta: 0.1, Gamma: 0.1 }),
    on: () => {},
    off: () => {},
  }),
}));
vi.mock('../TradingPipelineLogger', () => ({
  logPipelineEvent: vi.fn(),
}));

import { EntryValidationService } from '../EntryValidationService';
import { AutomatedSignalProcessor } from '../AutomatedSignalProcessor';
import { getTradingConfig } from '../../config/TradingConfig';
import { loadCandlesFromDatabase } from '../../db/candleStorage';
import { priceFeedService } from '../priceFeedService';
import type { AgentSignal as SignalForProcessor } from '../../agents/AgentBase';

const mockedLoadCandles = loadCandlesFromDatabase as unknown as ReturnType<typeof vi.fn>;
const mockedGetLatestPrice = priceFeedService.getLatestPrice as unknown as ReturnType<typeof vi.fn>;

// Helper: build three disagreeing LONG/SHORT agent signals to force a
// consensus failure inside EntryConfirmationFilter.
function makeSplitAgentSignals() {
  return [
    { agentName: 'Alpha', direction: 'LONG' as const, confidence: 0.4, weight: 0.1 },
    { agentName: 'Beta',  direction: 'SHORT' as const, confidence: 0.4, weight: 0.1 },
    { agentName: 'Gamma', direction: 'NEUTRAL' as const, confidence: 0.4, weight: 0.1 },
  ];
}

// Helper: build a fresh, actionable signal set for the processor-level tests.
function makeFreshBullishSignals(symbol: string): SignalForProcessor[] {
  const ts = Date.now();
  const base = {
    symbol,
    timestamp: ts,
    signal: 'bullish' as const,
    confidence: 0.8,
    strength: 0.8,
    executionScore: 70,
    reasoning: 'test',
    evidence: {},
    qualityScore: 0.8,
    processingTime: 10,
    dataFreshness: 1,
  };
  return [
    { ...base, agentName: 'Alpha' } as SignalForProcessor,
    { ...base, agentName: 'Beta'  } as SignalForProcessor,
    { ...base, agentName: 'Gamma' } as SignalForProcessor,
  ];
}

describe('EntryValidationService — passthrough bug fix', () => {
  const originalConfig = JSON.parse(JSON.stringify(getTradingConfig()));

  afterEach(() => {
    // Reset validation flag between tests — mutate singleton in place.
    const cfg = getTradingConfig();
    cfg.validation = { ...(cfg.validation ?? {}), ...originalConfig.validation };
  });

  it('fails closed (canEnter=false) on consensus failure by default', async () => {
    // Ensure default fail-closed posture.
    const cfg = getTradingConfig();
    cfg.validation = { ...(cfg.validation ?? {}), failOpenOnConsensusMismatch: false };

    const svc = new EntryValidationService();
    const result = await svc.validateEntry('BTC-USD', makeSplitAgentSignals());

    expect(result.canEnter).toBe(false);
    expect(result.direction).toBeNull();
    expect(result.validations.agentConsensus).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('falls back to legacy pass-through (canEnter=true) when failOpenOnConsensusMismatch=true', async () => {
    const cfg = getTradingConfig();
    cfg.validation = { ...(cfg.validation ?? {}), failOpenOnConsensusMismatch: true };

    const svc = new EntryValidationService();
    const result = await svc.validateEntry('BTC-USD', makeSplitAgentSignals());

    // Legacy permissive behavior — trusts upstream consensus.
    expect(result.canEnter).toBe(true);
    expect(result.validations.agentConsensus).toBe(false);
    expect(result.confidence).toBeCloseTo(0.3, 5);
  });
});

describe('AutomatedSignalProcessor — entry gates', () => {
  const symbol = 'BTC-USD';

  beforeEach(() => {
    mockedLoadCandles.mockReset();
    mockedGetLatestPrice.mockReset();
    // Default: plenty of candles AND fresh price, so default path reaches
    // consensus-level checks without the two gates interfering.
    mockedLoadCandles.mockResolvedValue(Array.from({ length: 60 }, () => ({
      timestamp: Date.now(),
      open: 100, high: 100, low: 100, close: 100, volume: 1,
    })));
    mockedGetLatestPrice.mockReturnValue({
      symbol, price: 100, timestamp: Date.now(), source: 'websocket',
    });
  });

  it('rejects with insufficient_candle_history when CandleStorage returns < 50 rows', async () => {
    mockedLoadCandles.mockResolvedValueOnce(Array.from({ length: 10 }, () => ({
      timestamp: Date.now(),
      open: 100, high: 100, low: 100, close: 100, volume: 1,
    })));

    const processor = new AutomatedSignalProcessor(1);
    const result = await processor.processSignals(
      makeFreshBullishSignals(symbol),
      symbol,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/insufficient_candle_history/);
    processor.destroy();
  });

  it('rejects with price_feed_stale when latest price timestamp is older than 5s', async () => {
    mockedGetLatestPrice.mockReturnValueOnce({
      symbol,
      price: 100,
      timestamp: Date.now() - 10_000, // 10s old → stale
      source: 'cache',
    });

    const processor = new AutomatedSignalProcessor(1);
    const result = await processor.processSignals(
      makeFreshBullishSignals(symbol),
      symbol,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/price_feed_stale/);
    processor.destroy();
  });

  it('rejects with price_feed_stale when no latest price is available', async () => {
    mockedGetLatestPrice.mockReturnValueOnce(undefined);

    const processor = new AutomatedSignalProcessor(1);
    const result = await processor.processSignals(
      makeFreshBullishSignals(symbol),
      symbol,
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/price_feed_stale/);
    processor.destroy();
  });
});
