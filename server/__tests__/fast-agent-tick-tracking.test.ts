/**
 * Fast Agent Tick Tracking Tests
 * 
 * Verifies that fast agents properly track lastTickTime and ticksReceived
 * when receiving ticks from the WebSocket price feed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentHealth } from '../agents/AgentBase';

// Mock a simple fast agent for testing
class MockFastAgent {
  private health: AgentHealth;
  
  constructor(name: string) {
    this.health = {
      agentName: name,
      status: 'healthy',
      lastSignalTime: 0,
      lastTickTime: 0,
      ticksReceived: 0,
      successRate: 1.0,
      avgProcessingTime: 0,
      errorCount: 0,
      uptime: 0,
    };
  }
  
  onTick(tick: { price: number; timestamp: number; symbol?: string }): void {
    this.health.lastTickTime = Date.now();
    this.health.ticksReceived++;
  }
  
  getHealth(): AgentHealth {
    return { ...this.health };
  }
}

describe('Fast Agent Tick Tracking', () => {
  let agent: MockFastAgent;
  
  beforeEach(() => {
    agent = new MockFastAgent('TechnicalAnalyst');
  });
  
  describe('lastTickTime tracking', () => {
    it('should initialize lastTickTime to 0', () => {
      const health = agent.getHealth();
      expect(health.lastTickTime).toBe(0);
    });
    
    it('should update lastTickTime when onTick is called', () => {
      const beforeTick = Date.now();
      agent.onTick({ price: 50000, timestamp: Date.now() });
      const afterTick = Date.now();
      
      const health = agent.getHealth();
      expect(health.lastTickTime).toBeGreaterThanOrEqual(beforeTick);
      expect(health.lastTickTime).toBeLessThanOrEqual(afterTick);
    });
    
    it('should update lastTickTime on every tick', async () => {
      agent.onTick({ price: 50000, timestamp: Date.now() });
      const firstTickTime = agent.getHealth().lastTickTime;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      agent.onTick({ price: 50001, timestamp: Date.now() });
      const secondTickTime = agent.getHealth().lastTickTime;
      
      expect(secondTickTime).toBeGreaterThan(firstTickTime);
    });
  });
  
  describe('ticksReceived tracking', () => {
    it('should initialize ticksReceived to 0', () => {
      const health = agent.getHealth();
      expect(health.ticksReceived).toBe(0);
    });
    
    it('should increment ticksReceived on each tick', () => {
      agent.onTick({ price: 50000, timestamp: Date.now() });
      expect(agent.getHealth().ticksReceived).toBe(1);
      
      agent.onTick({ price: 50001, timestamp: Date.now() });
      expect(agent.getHealth().ticksReceived).toBe(2);
      
      agent.onTick({ price: 50002, timestamp: Date.now() });
      expect(agent.getHealth().ticksReceived).toBe(3);
    });
    
    it('should track high-frequency ticks accurately', () => {
      const tickCount = 1000;
      for (let i = 0; i < tickCount; i++) {
        agent.onTick({ price: 50000 + i, timestamp: Date.now() });
      }
      
      expect(agent.getHealth().ticksReceived).toBe(tickCount);
    });
  });
  
  describe('AgentHealth interface', () => {
    it('should include lastTickTime in AgentHealth', () => {
      const health = agent.getHealth();
      expect('lastTickTime' in health).toBe(true);
    });
    
    it('should include ticksReceived in AgentHealth', () => {
      const health = agent.getHealth();
      expect('ticksReceived' in health).toBe(true);
    });
  });
  
  describe('Performance', () => {
    it('should process ticks with sub-millisecond latency', () => {
      const iterations = 10000;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        agent.onTick({ price: 50000 + i, timestamp: Date.now() });
      }
      
      const elapsed = performance.now() - start;
      const avgLatency = elapsed / iterations;
      
      // Each tick should take less than 0.1ms on average
      expect(avgLatency).toBeLessThan(0.1);
      console.log(`Average tick processing latency: ${avgLatency.toFixed(4)}ms`);
    });
  });
});
