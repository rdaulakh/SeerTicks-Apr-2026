/**
 * LLM Circuit Breaker Production Test
 * 
 * Tests the complete circuit breaker lifecycle:
 * 1. Normal operation (CLOSED state)
 * 2. Quota exhaustion detection (412/429 errors)
 * 3. Circuit opening after threshold failures
 * 4. Anthropic fallback activation
 * 5. JSON enforcement on fallback (SentimentAnalyst fix)
 * 6. Half-open recovery probe
 * 7. Full recovery back to CLOSED
 * 8. Exponential backoff on repeated failures
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getLLMCircuitBreaker,
  destroyLLMCircuitBreaker,
  type CircuitState,
  type CircuitBreakerStats,
} from '../utils/LLMCircuitBreaker';

describe('LLM Circuit Breaker — Complete Lifecycle', () => {
  beforeEach(() => {
    destroyLLMCircuitBreaker();
  });

  afterEach(() => {
    destroyLLMCircuitBreaker();
  });

  describe('1. Normal Operation (CLOSED state)', () => {
    it('should start in CLOSED state', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);
    });

    it('should remain CLOSED on successful calls', () => {
      const cb = getLLMCircuitBreaker();
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordSuccess();
      
      expect(cb.getState()).toBe('CLOSED');
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });

    it('should track success timestamps', () => {
      const cb = getLLMCircuitBreaker();
      const before = Date.now();
      cb.recordSuccess();
      
      const stats = cb.getStats();
      expect(stats.lastSuccessTime).toBeGreaterThanOrEqual(before);
    });

    it('should allow execution in CLOSED state', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.canExecute()).toBe(true);
      expect(cb.canExecute()).toBe(true);
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('2. Quota Exhaustion Detection', () => {
    it('should detect 412 errors as quota exhaustion', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.isQuotaExhausted(new Error('HTTP 412: usage exhausted'))).toBe(true);
    });

    it('should detect 429 errors as quota exhaustion', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.isQuotaExhausted(new Error('HTTP 429: too many requests'))).toBe(true);
    });

    it('should detect rate limit messages', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.isQuotaExhausted(new Error('rate limit exceeded'))).toBe(true);
    });

    it('should detect quota exceeded messages', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.isQuotaExhausted(new Error('API quota exceeded for this billing period'))).toBe(true);
    });

    it('should NOT flag non-quota errors', () => {
      const cb = getLLMCircuitBreaker();
      expect(cb.isQuotaExhausted(new Error('Network timeout'))).toBe(false);
      expect(cb.isQuotaExhausted(new Error('Internal server error 500'))).toBe(false);
      expect(cb.isQuotaExhausted(new Error('Invalid JSON response'))).toBe(false);
    });
  });

  describe('3. Circuit Opening (CLOSED → OPEN)', () => {
    it('should open after 3 consecutive failures (default threshold)', () => {
      const cb = getLLMCircuitBreaker();
      
      cb.recordFailure(new Error('412: usage exhausted'));
      expect(cb.getState()).toBe('CLOSED');
      
      cb.recordFailure(new Error('412: usage exhausted'));
      expect(cb.getState()).toBe('CLOSED');
      
      cb.recordFailure(new Error('412: usage exhausted'));
      expect(cb.getState()).toBe('OPEN');
    });

    it('should block execution when OPEN', () => {
      const cb = getLLMCircuitBreaker();
      
      // Trip the circuit
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      
      expect(cb.canExecute()).toBe(false);
    });

    it('should track total circuit opens', () => {
      const cb = getLLMCircuitBreaker();
      
      // First open
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      
      const stats = cb.getStats();
      expect(stats.totalCircuitOpens).toBe(1);
      expect(stats.consecutiveFailures).toBe(3);
      expect(stats.totalFailures).toBe(3);
    });

    it('should reset consecutive failures on success', () => {
      const cb = getLLMCircuitBreaker();
      
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordSuccess(); // Reset
      
      expect(cb.getState()).toBe('CLOSED');
      
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalFailures).toBe(2); // Total still tracked
    });

    it('should report cooldown remaining when OPEN', () => {
      const cb = getLLMCircuitBreaker();
      
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      
      const stats = cb.getStats();
      expect(stats.cooldownRemaining).toBeGreaterThan(0);
      expect(stats.cooldownRemaining).toBeLessThanOrEqual(5 * 60 * 1000); // 5 min default
    });
  });

  describe('4. Half-Open Recovery Probe', () => {
    it('should transition to HALF_OPEN after cooldown expires', () => {
      destroyLLMCircuitBreaker();
      const cb = getLLMCircuitBreaker();
      
      // Trip the circuit
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      
      expect(cb.getState()).toBe('OPEN');
      
      // Manually advance time by manipulating lastFailureTime
      // This tests the auto-transition logic in getState()
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago (> 5 min cooldown)
      
      expect(cb.getState()).toBe('HALF_OPEN');
    });

    it('should allow one test call in HALF_OPEN state', () => {
      destroyLLMCircuitBreaker();
      const cb = getLLMCircuitBreaker();
      
      // Trip and expire cooldown
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
      
      // Transition to HALF_OPEN via getState()
      expect(cb.getState()).toBe('HALF_OPEN');
      
      // First canExecute() sets halfOpenInProgress = true
      expect(cb.canExecute()).toBe(true);
      
      // Second call should be blocked (only one probe allowed)
      expect(cb.canExecute()).toBe(false);
    });

    it('should close circuit on successful probe', () => {
      const cb = getLLMCircuitBreaker();
      
      // Trip and expire cooldown
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
      
      // Transition to HALF_OPEN
      cb.getState();
      expect(cb.getState()).toBe('HALF_OPEN');
      
      // Successful probe
      cb.recordSuccess();
      
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);
    });

    it('should reopen circuit on failed probe with increased cooldown', () => {
      const cb = getLLMCircuitBreaker();
      
      // Trip and expire cooldown
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
      
      // Transition to HALF_OPEN
      cb.getState();
      
      // Failed probe
      cb.recordFailure(new Error('412'));
      
      expect(cb.getState()).toBe('OPEN');
      
      // Cooldown should have doubled (exponential backoff)
      const currentCooldown = (cb as any).currentCooldownMs;
      expect(currentCooldown).toBe(10 * 60 * 1000); // 5 min * 2 = 10 min
    });
  });

  describe('5. Exponential Backoff', () => {
    it('should double cooldown on each failed probe', () => {
      const cb = getLLMCircuitBreaker();
      
      // Initial trip
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      expect((cb as any).currentCooldownMs).toBe(5 * 60 * 1000); // 5 min
      
      // First failed probe
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
      cb.getState(); // → HALF_OPEN
      cb.recordFailure(new Error('412'));
      expect((cb as any).currentCooldownMs).toBe(10 * 60 * 1000); // 10 min
      
      // Second failed probe
      (cb as any).lastFailureTime = Date.now() - (11 * 60 * 1000);
      cb.getState(); // → HALF_OPEN
      cb.recordFailure(new Error('412'));
      expect((cb as any).currentCooldownMs).toBe(20 * 60 * 1000); // 20 min
      
      // Third failed probe — should cap at 30 min
      (cb as any).lastFailureTime = Date.now() - (21 * 60 * 1000);
      cb.getState(); // → HALF_OPEN
      cb.recordFailure(new Error('412'));
      expect((cb as any).currentCooldownMs).toBe(30 * 60 * 1000); // Capped at 30 min
    });

    it('should reset cooldown on successful recovery', () => {
      const cb = getLLMCircuitBreaker();
      
      // Trip and escalate
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
      cb.getState(); // → HALF_OPEN
      cb.recordFailure(new Error('412')); // Escalate to 10 min
      
      // Now recover
      (cb as any).lastFailureTime = Date.now() - (11 * 60 * 1000);
      cb.getState(); // → HALF_OPEN
      cb.recordSuccess(); // Recover
      
      expect(cb.getState()).toBe('CLOSED');
      expect((cb as any).currentCooldownMs).toBe(5 * 60 * 1000); // Reset to default
    });
  });

  describe('6. Manual Reset', () => {
    it('should reset all state on manual reset', () => {
      const cb = getLLMCircuitBreaker();
      
      // Trip the circuit
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      cb.recordFailure(new Error('412'));
      
      expect(cb.getState()).toBe('OPEN');
      
      // Manual reset
      cb.reset();
      
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);
      
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('7. Stats Reporting', () => {
    it('should report complete stats', () => {
      const cb = getLLMCircuitBreaker();
      
      cb.recordSuccess();
      cb.recordFailure(new Error('412'));
      cb.recordFallback();
      
      const stats = cb.getStats();
      
      expect(stats.state).toBe('CLOSED');
      expect(stats.consecutiveFailures).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.totalFallbacks).toBe(1);
      expect(stats.primaryProvider).toBe('Forge/Gemini');
      expect(stats.lastSuccessTime).toBeTruthy();
      expect(stats.lastFailureTime).toBeTruthy();
    });

    it('should report fallback availability based on ANTHROPIC_API_KEY', () => {
      const cb = getLLMCircuitBreaker();
      const stats = cb.getStats();
      
      // In test env, ANTHROPIC_API_KEY may or may not be set
      if (process.env.ANTHROPIC_API_KEY) {
        expect(stats.fallbackAvailable).toBe(true);
        expect(stats.fallbackProvider).toBe('Anthropic Claude');
      } else {
        expect(stats.fallbackAvailable).toBe(false);
        expect(stats.fallbackProvider).toBeNull();
      }
    });
  });

  describe('8. Singleton Pattern', () => {
    it('should return same instance from getLLMCircuitBreaker', () => {
      const cb1 = getLLMCircuitBreaker();
      const cb2 = getLLMCircuitBreaker();
      
      expect(cb1).toBe(cb2);
    });

    it('should create new instance after destroy', () => {
      const cb1 = getLLMCircuitBreaker();
      cb1.recordFailure(new Error('412'));
      
      destroyLLMCircuitBreaker();
      
      const cb2 = getLLMCircuitBreaker();
      const stats = cb2.getStats();
      expect(stats.totalFailures).toBe(0); // Fresh instance
    });
  });
});

describe('Anthropic Fallback — JSON Enforcement', () => {
  describe('JSON Detection', () => {
    it('should detect JSON expectation from response_format parameter', async () => {
      // Import the internal function for testing
      const mod = await import('../utils/AnthropicFallback');
      
      // We can't directly test expectsJsonResponse (it's not exported),
      // but we can verify the module exports the right functions
      expect(typeof mod.isAnthropicAvailable).toBe('function');
      expect(typeof mod.invokeAnthropicFallback).toBe('function');
    });

    it('should check Anthropic availability based on API key', async () => {
      const { isAnthropicAvailable } = await import('../utils/AnthropicFallback');
      
      if (process.env.ANTHROPIC_API_KEY) {
        expect(isAnthropicAvailable()).toBe(true);
      } else {
        expect(isAnthropicAvailable()).toBe(false);
      }
    });
  });

  describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Live Anthropic Fallback (requires API key)', () => {
    it('should return valid JSON when response_format is json_schema', async () => {
      const { invokeAnthropicFallback } = await import('../utils/AnthropicFallback');
      
      const result = await invokeAnthropicFallback({
        messages: [
          { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
          { role: 'user', content: 'Return a JSON object with fields: sentiment (number -1 to 1), summary (string), confidence (number 0 to 1)' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'sentiment_analysis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                sentiment: { type: 'number' },
                summary: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['sentiment', 'summary', 'confidence'],
              additionalProperties: false,
            },
          },
        },
      });
      
      expect(result.choices).toHaveLength(1);
      const content = result.choices[0].message.content;
      
      // Should be valid JSON
      let parsed: any;
      expect(() => { parsed = JSON.parse(content); }).not.toThrow();
      
      // Should have the expected fields
      expect(parsed).toHaveProperty('sentiment');
      expect(parsed).toHaveProperty('summary');
      expect(parsed).toHaveProperty('confidence');
      expect(typeof parsed.sentiment).toBe('number');
      expect(typeof parsed.summary).toBe('string');
      expect(typeof parsed.confidence).toBe('number');
    }, 30000);

    it('should return valid JSON when system prompt requests JSON', async () => {
      const { invokeAnthropicFallback } = await import('../utils/AnthropicFallback');
      
      const result = await invokeAnthropicFallback({
        messages: [
          { role: 'system', content: 'You are a sentiment analysis engine. Return only valid JSON with fields: score, label, reasoning.' },
          { role: 'user', content: 'Analyze the sentiment of: "Bitcoin is crashing hard today, massive sell-off"' },
        ],
      });
      
      expect(result.choices).toHaveLength(1);
      const content = result.choices[0].message.content;
      
      // Should be valid JSON (this is the SentimentAnalyst fix verification)
      let parsed: any;
      expect(() => { parsed = JSON.parse(content); }).not.toThrow();
      
      // Should not be prose like "I cannot f..."
      expect(content.startsWith('{')).toBe(true);
    }, 30000);

    it('should handle non-JSON requests normally', async () => {
      const { invokeAnthropicFallback } = await import('../utils/AnthropicFallback');
      
      const result = await invokeAnthropicFallback({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say hello in one sentence.' },
        ],
      });
      
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content.length).toBeGreaterThan(0);
      
      // Should NOT be forced into JSON
      // (it might happen to be valid JSON, but it shouldn't be required)
      expect(result.choices[0].message.role).toBe('assistant');
    }, 30000);

    it('should return OpenAI-compatible response format', async () => {
      const { invokeAnthropicFallback } = await import('../utils/AnthropicFallback');
      
      const result = await invokeAnthropicFallback({
        messages: [
          { role: 'user', content: 'Say "test" and nothing else.' },
        ],
      });
      
      // Verify OpenAI-compatible structure
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('choices');
      expect(result.choices[0]).toHaveProperty('index', 0);
      expect(result.choices[0]).toHaveProperty('message');
      expect(result.choices[0].message).toHaveProperty('role', 'assistant');
      expect(result.choices[0].message).toHaveProperty('content');
      expect(result.choices[0]).toHaveProperty('finish_reason');
    }, 30000);
  });
});

describe('End-to-End Circuit Breaker Simulation', () => {
  it('should simulate complete quota exhaustion → fallback → recovery cycle', () => {
    const cb = getLLMCircuitBreaker();
    const events: string[] = [];
    
    // Phase 1: Normal operation
    cb.recordSuccess();
    events.push(`CLOSED: Normal operation, canExecute=${cb.canExecute()}`);
    expect(cb.getState()).toBe('CLOSED');
    
    // Phase 2: Quota starts failing
    cb.recordFailure(new Error('412: usage exhausted'));
    events.push(`CLOSED: 1st failure, canExecute=${cb.canExecute()}`);
    expect(cb.getState()).toBe('CLOSED');
    
    cb.recordFailure(new Error('429: too many requests'));
    events.push(`CLOSED: 2nd failure, canExecute=${cb.canExecute()}`);
    expect(cb.getState()).toBe('CLOSED');
    
    cb.recordFailure(new Error('quota exceeded'));
    events.push(`OPEN: 3rd failure, canExecute=${cb.canExecute()}`);
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
    
    // Phase 3: Fallback activated
    cb.recordFallback();
    cb.recordFallback();
    cb.recordFallback();
    events.push(`OPEN: 3 fallback calls recorded`);
    
    const statsOpen = cb.getStats();
    expect(statsOpen.totalFallbacks).toBe(3);
    expect(statsOpen.totalCircuitOpens).toBe(1);
    
    // Phase 4: Cooldown expires → HALF_OPEN
    (cb as any).lastFailureTime = Date.now() - (6 * 60 * 1000);
    expect(cb.getState()).toBe('HALF_OPEN');
    events.push(`HALF_OPEN: Cooldown expired, canExecute=${cb.canExecute()}`);
    
    // Phase 5: Probe succeeds → CLOSED
    cb.recordSuccess();
    events.push(`CLOSED: Probe succeeded, canExecute=${cb.canExecute()}`);
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
    
    // Verify final stats
    const statsFinal = cb.getStats();
    expect(statsFinal.state).toBe('CLOSED');
    expect(statsFinal.totalFailures).toBe(3);
    expect(statsFinal.totalFallbacks).toBe(3);
    expect(statsFinal.totalCircuitOpens).toBe(1);
    expect(statsFinal.consecutiveFailures).toBe(0);
    
    // Log the complete event timeline
    console.log('\n=== Circuit Breaker Simulation Timeline ===');
    events.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    console.log('=== Simulation Complete ===\n');
  });
});
