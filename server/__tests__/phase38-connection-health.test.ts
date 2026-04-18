/**
 * Phase 38: Connection Health & Duplicity Cleanup Tests
 * 
 * Tests:
 * 1. Health indicator consolidation — no duplicate health displays
 * 2. Navigation structure — System Health in More menu, no dead routes
 * 3. WebSocket reconnection — infinite reconnect + visibilitychange
 * 4. Connection health data availability via tRPC endpoints
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 38: Connection Health & Duplicity Cleanup', () => {
  
  // ==========================================
  // 1. Duplicity Cleanup Verification
  // ==========================================
  describe('Health Indicator Duplicity Cleanup', () => {
    it('should NOT have orphaned Health.tsx page', () => {
      const healthPagePath = path.join(process.cwd(), 'client/src/pages/Health.tsx');
      expect(fs.existsSync(healthPagePath)).toBe(false);
    });

    it('should NOT have /health route in App.tsx', () => {
      const appTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'),
        'utf-8'
      );
      // /health route should not exist — only /system
      expect(appTsx).not.toMatch(/path=["']\/health["']/);
    });

    it('should have /system route in App.tsx', () => {
      const appTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'),
        'utf-8'
      );
      expect(appTsx).toMatch(/path=["']\/system["']/);
    });

    it('should NOT have RateLimitIndicator in Dashboard header', () => {
      const dashboardTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'),
        'utf-8'
      );
      // RateLimitIndicator should be removed from Dashboard — now in System Health Connection tab
      expect(dashboardTsx).not.toContain('RateLimitIndicator');
    });

    it('should NOT have TradeExecutionIndicator in Dashboard header', () => {
      const dashboardTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'),
        'utf-8'
      );
      expect(dashboardTsx).not.toContain('TradeExecutionIndicator');
    });

    it('should NOT reference /health in GlobalSearch', () => {
      const globalSearchPath = path.join(process.cwd(), 'client/src/components/GlobalSearch.tsx');
      if (fs.existsSync(globalSearchPath)) {
        const globalSearch = fs.readFileSync(globalSearchPath, 'utf-8');
        expect(globalSearch).not.toMatch(/["']\/health["']/);
      }
    });

    it('should reference /system in GlobalSearch instead of /health', () => {
      const globalSearchPath = path.join(process.cwd(), 'client/src/components/GlobalSearch.tsx');
      if (fs.existsSync(globalSearchPath)) {
        const globalSearch = fs.readFileSync(globalSearchPath, 'utf-8');
        expect(globalSearch).toContain('/system');
      }
    });
  });

  // ==========================================
  // 2. Navigation Structure
  // ==========================================
  describe('Navigation Structure', () => {
    it('should have System Health in More menu', () => {
      const navTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/Navigation.tsx'),
        'utf-8'
      );
      // System Health should be in moreNavItems
      expect(navTsx).toContain('/system');
      expect(navTsx).toContain('System Health');
    });

    it('should NOT have duplicate AdvancedAI page in More menu', () => {
      const navTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/Navigation.tsx'),
        'utf-8'
      );
      expect(navTsx).not.toContain('/advanced-ai');
    });

    it('should NOT have duplicate DataIngestion page in More menu', () => {
      const navTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/Navigation.tsx'),
        'utf-8'
      );
      expect(navTsx).not.toContain('/data-ingestion');
    });

    it('should NOT have A++ Optimization page in More menu', () => {
      const navTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/Navigation.tsx'),
        'utf-8'
      );
      expect(navTsx).not.toContain('/optimization');
    });
  });

  // ==========================================
  // 3. Connection Tab in SystemHealth
  // ==========================================
  describe('Connection Tab in SystemHealth', () => {
    it('should have Connection tab in SystemHealth', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('value="connection"');
      expect(systemHealthTsx).toContain('ConnectionHealthPanel');
    });

    it('should have 6 tabs in SystemHealth (overview, connection, services, agents, latency, logs)', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('grid-cols-6');
      expect(systemHealthTsx).toContain('value="overview"');
      expect(systemHealthTsx).toContain('value="connection"');
      expect(systemHealthTsx).toContain('value="services"');
      expect(systemHealthTsx).toContain('value="agents"');
      expect(systemHealthTsx).toContain('value="latency"');
      expect(systemHealthTsx).toContain('value="logs"');
    });

    it('should display price feed architecture in Connection tab', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('Price Feed Architecture');
      expect(systemHealthTsx).toContain('getPriceFeedHealth');
    });

    it('should display circuit breakers in Connection tab', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('Circuit Breakers');
      expect(systemHealthTsx).toContain('getCircuitBreakerStatus');
    });

    it('should display rate limits in Connection tab', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('API Rate Limits');
      expect(systemHealthTsx).toContain('getRateLimitStatus');
    });

    it('should display LLM service health in Connection tab', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('LLM Service Health');
      expect(systemHealthTsx).toContain('getLLMCircuitBreakerStats');
    });

    it('should display candle cache status in Connection tab', () => {
      const systemHealthTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/SystemHealth.tsx'),
        'utf-8'
      );
      expect(systemHealthTsx).toContain('Candle Cache');
      expect(systemHealthTsx).toContain('getCandleCacheStatus');
    });
  });

  // ==========================================
  // 4. WebSocket Reconnection Robustness
  // ==========================================
  describe('WebSocket Reconnection Robustness', () => {
    it('useWebSocket should have infinite reconnection (no maxReconnectAttempts limit)', () => {
      const useWebSocketPath = path.join(process.cwd(), 'client/src/hooks/useWebSocket.ts');
      if (fs.existsSync(useWebSocketPath)) {
        const content = fs.readFileSync(useWebSocketPath, 'utf-8');
        // Should NOT have a hard limit that gives up
        expect(content).not.toMatch(/Failed to connect after multiple attempts/);
        // Should have visibilitychange handler
        expect(content).toContain('visibilitychange');
      }
    });

    it('useSocketIOMulti should have visibilitychange handler', () => {
      const useSocketIOMultiPath = path.join(process.cwd(), 'client/src/hooks/useSocketIOMulti.ts');
      if (fs.existsSync(useSocketIOMultiPath)) {
        const content = fs.readFileSync(useSocketIOMultiPath, 'utf-8');
        expect(content).toContain('visibilitychange');
      }
    });

    it('useLivePriceStream should have visibilitychange handler', () => {
      const useLivePriceStreamPath = path.join(process.cwd(), 'client/src/hooks/useLivePriceStream.ts');
      if (fs.existsSync(useLivePriceStreamPath)) {
        const content = fs.readFileSync(useLivePriceStreamPath, 'utf-8');
        expect(content).toContain('visibilitychange');
      }
    });

    it('useWebSocket should reset reconnect counter on successful connection', () => {
      const useWebSocketPath = path.join(process.cwd(), 'client/src/hooks/useWebSocket.ts');
      if (fs.existsSync(useWebSocketPath)) {
        const content = fs.readFileSync(useWebSocketPath, 'utf-8');
        // On successful connection, reconnect attempts should reset
        expect(content).toMatch(/reconnect.*=.*0|attempts.*=.*0|reset/i);
      }
    });

    it('CoinbasePublicWebSocket should never permanently give up', () => {
      const coinbasePath = path.join(process.cwd(), 'server/market-data/CoinbasePublicWebSocket.ts');
      if (fs.existsSync(coinbasePath)) {
        const content = fs.readFileSync(coinbasePath, 'utf-8');
        // Should reset attempts and retry even after MAX_RECONNECT_ATTEMPTS
        expect(content).toContain('reconnectAttempts = 0');
      }
    });
  });

  // ==========================================
  // 5. No Dead Health Routes
  // ==========================================
  describe('No Dead Health Routes', () => {
    it('Dashboard Health button should link to /system not /health', () => {
      const dashboardTsx = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'),
        'utf-8'
      );
      // Should not have /health link
      expect(dashboardTsx).not.toMatch(/href=["']\/health["']/);
      // Should have /system link for health
      expect(dashboardTsx).toContain('/system');
    });
  });
});
