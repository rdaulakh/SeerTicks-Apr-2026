/**
 * Health Router Tests
 * 
 * Tests for server health endpoint functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { healthState, updateHealthState } from '../routers/healthRouter';

describe('Health Router', () => {
  beforeEach(() => {
    // Reset health state before each test
    healthState.websocket.connected = false;
    healthState.websocket.lastPing = 0;
    healthState.websocket.provider = 'unknown';
    healthState.priceFeed.connected = false;
    healthState.priceFeed.tickCount = 0;
    healthState.priceFeed.lastTick = 0;
    healthState.agents.active = 0;
    healthState.database.connected = false;
  });

  describe('updateHealthState', () => {
    it('should update websocket state', () => {
      updateHealthState('websocket', { connected: true, provider: 'CoinAPI' });
      
      expect(healthState.websocket.connected).toBe(true);
      expect(healthState.websocket.provider).toBe('CoinAPI');
    });

    it('should update priceFeed state', () => {
      const now = Date.now();
      updateHealthState('priceFeed', { connected: true, tickCount: 100, lastTick: now });
      
      expect(healthState.priceFeed.connected).toBe(true);
      expect(healthState.priceFeed.tickCount).toBe(100);
      expect(healthState.priceFeed.lastTick).toBe(now);
    });

    it('should update agents state', () => {
      updateHealthState('agents', { active: 5, lastSignal: Date.now() });
      
      expect(healthState.agents.active).toBe(5);
      expect(healthState.agents.lastSignal).toBeGreaterThan(0);
    });

    it('should update database state', () => {
      updateHealthState('database', { connected: true, lastQuery: Date.now() });
      
      expect(healthState.database.connected).toBe(true);
      expect(healthState.database.lastQuery).toBeGreaterThan(0);
    });

    it('should preserve existing state when updating partial data', () => {
      // Set initial state
      updateHealthState('websocket', { connected: true, provider: 'CoinAPI', lastPing: 12345 });
      
      // Update only connected status
      updateHealthState('websocket', { connected: false });
      
      // Provider should be preserved
      expect(healthState.websocket.connected).toBe(false);
      expect(healthState.websocket.provider).toBe('CoinAPI');
    });
  });

  describe('Health State Structure', () => {
    it('should have correct initial structure', () => {
      expect(healthState).toHaveProperty('websocket');
      expect(healthState).toHaveProperty('priceFeed');
      expect(healthState).toHaveProperty('agents');
      expect(healthState).toHaveProperty('database');
    });

    it('should have websocket properties', () => {
      expect(healthState.websocket).toHaveProperty('connected');
      expect(healthState.websocket).toHaveProperty('lastPing');
      expect(healthState.websocket).toHaveProperty('provider');
    });

    it('should have priceFeed properties', () => {
      expect(healthState.priceFeed).toHaveProperty('connected');
      expect(healthState.priceFeed).toHaveProperty('tickCount');
      expect(healthState.priceFeed).toHaveProperty('lastTick');
      expect(healthState.priceFeed).toHaveProperty('latency');
    });

    it('should have agents properties', () => {
      expect(healthState.agents).toHaveProperty('active');
      expect(healthState.agents).toHaveProperty('total');
      expect(healthState.agents).toHaveProperty('lastSignal');
    });
  });
});
