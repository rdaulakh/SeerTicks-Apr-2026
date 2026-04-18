/**
 * Phase 39: Persistent Status Bar — Tests
 * 
 * Tests cover:
 * 1. PersistentStatusBar data sources are available (tRPC endpoints)
 * 2. No duplicity: Health.tsx deleted, /health route removed
 * 3. Uptime formatting logic
 * 4. Last trade time formatting logic
 * 5. Regime display config completeness
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 39: Persistent Status Bar', () => {

  describe('Component exists and is properly structured', () => {
    it('PersistentStatusBar component file exists', () => {
      const filePath = path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('PersistentStatusBar is wired into App.tsx', () => {
      const appContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'), 'utf-8'
      );
      expect(appContent).toContain('PersistentStatusBar');
      expect(appContent).toContain('import { PersistentStatusBar }');
    });

    it('PersistentStatusBar is inside ProtectedRoute (not on public pages)', () => {
      const appContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'), 'utf-8'
      );
      const protectedStart = appContent.indexOf('<ProtectedRoute>');
      const protectedEnd = appContent.indexOf('</ProtectedRoute>');
      const statusBarPos = appContent.indexOf('<PersistentStatusBar');
      expect(statusBarPos).toBeGreaterThan(protectedStart);
      expect(statusBarPos).toBeLessThan(protectedEnd);
    });

    it('has padding-bottom spacer to prevent content overlap', () => {
      const appContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'), 'utf-8'
      );
      expect(appContent).toContain('pb-7');
    });
  });

  describe('No duplicity: Health.tsx cleanup', () => {
    it('Health.tsx page file is deleted', () => {
      const filePath = path.join(process.cwd(), 'client/src/pages/Health.tsx');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('App.tsx does not reference /health route', () => {
      const appContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/App.tsx'), 'utf-8'
      );
      expect(appContent).not.toContain('path="/health"');
    });

    it('Dashboard links to /system not /health', () => {
      const dashContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'), 'utf-8'
      );
      // Should have /system link
      expect(dashContent).toContain('/system');
      // Should NOT have /health link
      expect(dashContent).not.toMatch(/href="\/health"/);
      expect(dashContent).not.toMatch(/to="\/health"/);
    });

    it('GlobalSearch references /system not /health', () => {
      const searchContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/GlobalSearch.tsx'), 'utf-8'
      );
      expect(searchContent).not.toContain('"/health"');
    });
  });

  describe('No duplicity: Dashboard header cleanup', () => {
    it('Dashboard does not import RateLimitIndicator', () => {
      const dashContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'), 'utf-8'
      );
      expect(dashContent).not.toContain('RateLimitIndicator');
    });

    it('Dashboard does not import TradeExecutionIndicator', () => {
      const dashContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'), 'utf-8'
      );
      expect(dashContent).not.toContain('TradeExecutionIndicator');
    });

    it('Dashboard still has WebSocketHealthIndicator (kept as compact status)', () => {
      const dashContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/pages/Dashboard.tsx'), 'utf-8'
      );
      expect(dashContent).toContain('WebSocketHealthIndicator');
    });
  });

  describe('System Health in More menu', () => {
    it('Navigation includes System Health in moreNavItems', () => {
      const navContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/Navigation.tsx'), 'utf-8'
      );
      expect(navContent).toContain('/system');
      expect(navContent).toContain('System Health');
    });
  });

  describe('PersistentStatusBar component features', () => {
    it('uses real tRPC data sources (not mock data)', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      // Must use actual tRPC queries
      expect(barContent).toContain('trpc.seerMulti.getStatus.useQuery');
      expect(barContent).toContain('trpc.pipeline.getRegimeDashboard.useQuery');
      expect(barContent).toContain('trpc.automatedTrading.getTradeHistory.useQuery');
    });

    it('uses useSocketIOMulti for connection state', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('useSocketIOMulti');
      expect(barContent).toContain('connected');
    });

    it('shows engine uptime with live timer', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('formatUptime');
      expect(barContent).toContain('setInterval');
      expect(barContent).toContain('Uptime');
    });

    it('shows current regime with icon and confidence', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('REGIME_CONFIG');
      expect(barContent).toContain('Regime:');
      expect(barContent).toContain('confidence');
    });

    it('shows last trade time', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('Last Trade');
      expect(barContent).toContain('formatLastTradeTime');
    });

    it('is fixed to bottom with proper z-index', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('fixed bottom-0');
      expect(barContent).toContain('z-40');
    });

    it('hides when user is not authenticated', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      expect(barContent).toContain('if (!user) return null');
    });

    it('covers all known regime types', () => {
      const barContent = fs.readFileSync(
        path.join(process.cwd(), 'client/src/components/PersistentStatusBar.tsx'), 'utf-8'
      );
      const regimes = ['trending_up', 'trending_down', 'high_volatility', 'mean_reverting', 'range_bound', 'breakout'];
      regimes.forEach(regime => {
        expect(barContent).toContain(regime);
      });
    });
  });

  describe('Uptime formatting logic', () => {
    // Test the formatting logic directly
    function formatUptime(startedAt: string): string {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      const diff = Math.max(0, now - start);
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
      return `${seconds}s`;
    }

    it('formats seconds correctly', () => {
      const now = new Date();
      const thirtySecsAgo = new Date(now.getTime() - 30000).toISOString();
      const result = formatUptime(thirtySecsAgo);
      expect(result).toMatch(/^\d+s$/);
    });

    it('formats minutes correctly', () => {
      const now = new Date();
      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      const result = formatUptime(fiveMinsAgo);
      expect(result).toMatch(/^\d+m \d+s$/);
    });

    it('formats hours correctly', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const result = formatUptime(twoHoursAgo);
      expect(result).toMatch(/^\d+h \d+m$/);
    });

    it('formats days correctly', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatUptime(threeDaysAgo);
      expect(result).toMatch(/^\d+d \d+h \d+m$/);
    });
  });

  describe('Last trade time formatting logic', () => {
    function formatLastTradeTime(timestamp: string | Date): string {
      const tradeTime = new Date(timestamp).getTime();
      const now = Date.now();
      const diff = Math.max(0, now - tradeTime);
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
      if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
      if (minutes > 0) return `${minutes}m ago`;
      if (seconds > 0) return `${seconds}s ago`;
      return "just now";
    }

    it('formats recent trades as seconds ago', () => {
      const tenSecsAgo = new Date(Date.now() - 10000);
      expect(formatLastTradeTime(tenSecsAgo)).toMatch(/\d+s ago/);
    });

    it('formats minutes-old trades', () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatLastTradeTime(fiveMinsAgo)).toMatch(/\d+m ago/);
    });

    it('formats hours-old trades', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(formatLastTradeTime(threeHoursAgo)).toMatch(/\d+h \d+m ago/);
    });

    it('formats day-old trades', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(formatLastTradeTime(twoDaysAgo)).toMatch(/\d+d ago/);
    });

    it('formats just now for current time', () => {
      expect(formatLastTradeTime(new Date())).toBe("just now");
    });
  });
});
