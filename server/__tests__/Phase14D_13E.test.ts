/**
 * Phase 14D & 13E Tests
 *
 * Phase 14D: Verify legacy SEERMultiEngine dependency is removed from all runtime files
 * Phase 13E: Verify DataGapResilience service architecture and integration
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const serverDir = path.join(__dirname, '..');

// ============================================================================
// Phase 14D: Legacy SEERMultiEngine Removal
// ============================================================================

describe('Phase 14D: Legacy SEERMultiEngine Removal', () => {
  const runtimeFiles = [
    'routers.ts',
    'routers/seerMultiRouter.ts',
    'routers/positionConsensusRouter.ts',
    'routers/settingsRouter.ts',
    'websocket/WebSocketServerMulti.ts',
    'services/backgroundEngineManager.ts',
    'services/priceFeedService.ts',
    'services/AutonomousTradingIntegration.ts',
    'services/EnhancedTradeExecutor.ts',
  ];

  describe('No runtime imports of seerMainMulti', () => {
    for (const file of runtimeFiles) {
      it(`${file} should NOT import from seerMainMulti`, () => {
        const filePath = path.join(serverDir, file);
        if (!fs.existsSync(filePath)) {
          // File may not exist if it was removed — that's fine
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check for import statements (not comments)
        const importLines = content.split('\n').filter(
          line => line.includes('seerMainMulti') && 
                  !line.trim().startsWith('//') && 
                  !line.trim().startsWith('*') &&
                  !line.trim().startsWith('/*')
        );
        expect(importLines).toHaveLength(0);
      });
    }
  });

  describe('No runtime calls to getSEERMultiEngine', () => {
    for (const file of runtimeFiles) {
      it(`${file} should NOT call getSEERMultiEngine`, () => {
        const filePath = path.join(serverDir, file);
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        const callLines = content.split('\n').filter(
          line => line.includes('getSEERMultiEngine') && 
                  !line.trim().startsWith('//') && 
                  !line.trim().startsWith('*')
        );
        expect(callLines).toHaveLength(0);
      });
    }
  });

  describe('No runtime calls to getExistingEngine', () => {
    for (const file of runtimeFiles) {
      it(`${file} should NOT call getExistingEngine (legacy)`, () => {
        const filePath = path.join(serverDir, file);
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        const callLines = content.split('\n').filter(
          line => line.includes('getExistingEngine') && 
                  !line.trim().startsWith('//') && 
                  !line.trim().startsWith('*') &&
                  !line.includes('getExistingAdapter') // EngineAdapter's replacement is OK
        );
        expect(callLines).toHaveLength(0);
      });
    }
  });

  describe('EngineAdapter exists and has correct API surface', () => {
    it('EngineAdapter.ts should exist', () => {
      const filePath = path.join(serverDir, 'services', 'EngineAdapter.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('EngineAdapter should export getEngineAdapter', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('export async function getEngineAdapter');
    });

    it('EngineAdapter should export getExistingAdapter', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('export function getExistingAdapter');
    });

    it('EngineAdapter should export stopAllAdapters', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('export async function stopAllAdapters');
    });

    it('EngineAdapter should have getStatus method', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('getStatus()');
    });

    it('EngineAdapter should have getAllPositions method', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('getAllPositions()');
    });

    it('EngineAdapter should have getSignalHistory method', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('getSignalHistory()');
    });

    it('EngineAdapter should have closePosition method', () => {
      const content = fs.readFileSync(path.join(serverDir, 'services', 'EngineAdapter.ts'), 'utf-8');
      expect(content).toContain('closePosition(');
    });
  });

  describe('Phase 28: seerMainMulti.ts deleted as dead code', () => {
    it('seerMainMulti.ts should NOT exist (deleted in Phase 28 — 4153 lines dead code)', () => {
      const filePath = path.join(serverDir, 'seerMainMulti.ts');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('Migrated files use EngineAdapter', () => {
    const adapterConsumers = [
      'routers/seerMultiRouter.ts',
      'websocket/WebSocketServerMulti.ts',
      'services/backgroundEngineManager.ts',
    ];

    for (const file of adapterConsumers) {
      it(`${file} should import from EngineAdapter`, () => {
        const filePath = path.join(serverDir, file);
        if (!fs.existsSync(filePath)) return;
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('EngineAdapter');
      });
    }
  });
});

// ============================================================================
// Phase 13E: Data Gap Resilience
// ============================================================================

describe('Phase 13E: Data Gap Resilience', () => {
  describe('DataGapResilience service exists and has correct structure', () => {
    const filePath = path.join(serverDir, 'services', 'DataGapResilience.ts');

    it('DataGapResilience.ts should exist', () => {
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should export dataGapResilience singleton', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('export const dataGapResilience');
    });

    it('should have start() method', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('start(symbols');
    });

    it('should have stop() method', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('stop(): void');
    });

    it('should have getStats() method', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('getStats(): ResilienceStats');
    });
  });

  describe('REST fallback poller', () => {
    const filePath = path.join(serverDir, 'services', 'DataGapResilience.ts');

    it('should have REST poller start/stop methods', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('startRESTPoller');
      expect(content).toContain('stopRESTPoller');
    });

    it('should use Coinbase REST as primary fallback', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('api.exchange.coinbase.com');
    });

    it('should use Binance REST as secondary fallback', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('api.binance.com');
    });

    it('should feed prices into priceFeedService', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("priceFeedService.updatePrice(symbol, price, 'rest')");
    });

    it('should detect stale WebSocket feed at 5s threshold', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('STALE_THRESHOLD_MS = 5_000');
    });

    it('should poll at 2s intervals', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('REST_POLL_INTERVAL_MS = 2_000');
    });
  });

  describe('WebSocket reconnect backfill', () => {
    const filePath = path.join(serverDir, 'services', 'DataGapResilience.ts');

    it('should listen for CoinbasePublicWS disconnect/connect events', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("coinbasePublicWebSocket.on('disconnected'");
      expect(content).toContain("coinbasePublicWebSocket.on('connected'");
    });

    it('should have backfillDisconnectWindow method', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('backfillDisconnectWindow');
    });

    it('should fetch historical trades for backfill', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('fetchHistoricalTrades');
    });

    it('should persist backfilled ticks to database', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('persistBackfilledTicks');
    });

    it('should cap backfill window at 5 minutes', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('BACKFILL_MAX_WINDOW_MS = 5 * 60 * 1_000');
    });
  });

  describe('Rapid gap scanner', () => {
    const filePath = path.join(serverDir, 'services', 'DataGapResilience.ts');

    it('should run gap scans every 5 minutes', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('RAPID_GAP_SCAN_INTERVAL_MS = 5 * 60 * 1_000');
    });

    it('should have runRapidGapScan method', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('runRapidGapScan');
    });

    it('should query dataGapLogs for pending gaps', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("eq(dataGapLogs.recoveryStatus, 'pending')");
    });
  });

  describe('Gap detection at PriceFeedService level', () => {
    const filePath = path.join(serverDir, 'services', 'DataGapResilience.ts');

    it('should detect gaps at 10s threshold', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('GAP_DETECTION_THRESHOLD_MS = 10_000');
    });

    it('should log detected gaps to dataGapLogs', () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('logGapDetected');
      expect(content).toContain("detectedBy: 'data_gap_resilience'");
    });
  });

  describe('Integration with server startup', () => {
    it('_core/index.ts should initialize DataGapResilience', () => {
      const indexPath = path.join(serverDir, '_core', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).toContain("import('../services/DataGapResilience')");
      expect(content).toContain('dataGapResilience.start');
    });

    it('_core/index.ts should stop DataGapResilience on shutdown', () => {
      const indexPath = path.join(serverDir, '_core', 'index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).toContain('dataGapResilience.stop()');
    });
  });

  describe('Health router integration', () => {
    it('healthRouter should have getResilienceStats endpoint', () => {
      const routerPath = path.join(serverDir, 'routers', 'healthRouter.ts');
      const content = fs.readFileSync(routerPath, 'utf-8');
      expect(content).toContain('getResilienceStats');
      expect(content).toContain("import('../services/DataGapResilience')");
    });
  });

  describe('Database schema', () => {
    it('ticks table should support rest_backfill source', () => {
      const schemaPath = path.join(__dirname, '..', '..', 'drizzle', 'schema.ts');
      const content = fs.readFileSync(schemaPath, 'utf-8');
      expect(content).toContain('rest_backfill');
      expect(content).toContain('rest_fallback');
    });
  });
});
