/**
 * Phase 15 — AgentWeightManager persistence across restart.
 *
 * Pre-Phase-15 the adaptive-weight feedback loop was in-memory-only:
 *
 *   Trade closes → recordTradeOutcome → performanceHistory.push(1 or 0)
 *   [pm2 restart] → performanceHistory = new Map() // GONE
 *   Every restart → system re-learns from scratch with no carry-over,
 *     MIN_SAMPLES_FOR_ADJUSTMENT (10) had to be re-earned every time.
 *
 * The system advertised "agent learning" but never actually learned across
 * any meaningful horizon. Phase 15 persists the history to disk (atomic
 * write-and-rename) and rehydrates on construction, so a 200-trade
 * learning window survives restart.
 *
 * These tests cover the persistence helpers + the construct → record →
 * new-instance-loads flow end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  __loadAgentPerformanceFromFile,
  __saveAgentPerformanceToFile,
  AgentWeightManager,
  ALL_AGENTS,
} from '../services/AgentWeightManager';

describe('Phase 15 — AgentWeightManager persistence', () => {
  let tmpFile: string;
  let origDataDir: string | undefined;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seer-awm-phase15-'));
    tmpFile = path.join(tmpDir, 'agent-performance.json');
    origDataDir = process.env.SEER_DATA_DIR;
    process.env.SEER_DATA_DIR = tmpDir;
  });
  afterEach(() => {
    if (origDataDir === undefined) delete process.env.SEER_DATA_DIR;
    else process.env.SEER_DATA_DIR = origDataDir;
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* file may not exist */
    }
  });

  describe('file round-trip helpers', () => {
    it('returns null when the file does not exist (fresh-install behavior)', () => {
      expect(__loadAgentPerformanceFromFile(tmpFile)).toBeNull();
    });

    it('returns null on malformed JSON without throwing (corrupt disk)', () => {
      fs.writeFileSync(tmpFile, 'not valid json {', 'utf8');
      expect(__loadAgentPerformanceFromFile(tmpFile)).toBeNull();
    });

    it('returns null on wrong schema version (future-safe compat boundary)', () => {
      fs.writeFileSync(
        tmpFile,
        JSON.stringify({ version: 999, userId: 1 }),
        'utf8',
      );
      expect(__loadAgentPerformanceFromFile(tmpFile)).toBeNull();
    });

    it('saves and reloads a populated state without data loss', () => {
      const original = {
        version: 1 as const,
        updatedAt: new Date().toISOString(),
        userId: 42,
        performanceHistory: { TechnicalAnalyst: [1, 1, 0, 1, 0, 1, 1] },
        detailedPerformance: {
          TechnicalAnalyst: [
            { wasCorrect: true, predictedConfidence: 0.72, timestamp: 1 },
            { wasCorrect: false, predictedConfidence: 0.41, timestamp: 2 },
          ],
        },
      };
      __saveAgentPerformanceToFile(original, tmpFile);
      const reloaded = __loadAgentPerformanceFromFile(tmpFile);
      expect(reloaded).toEqual(original);
    });

    it('uses atomic write — no partial file on crash mid-flush', () => {
      // The implementation writes to `<file>.tmp` then renames. If a prior
      // crash left a .tmp lying around, the consumer should still read the
      // real file (which here doesn't exist yet → null) without inspecting
      // or erroring on the stale .tmp.
      fs.writeFileSync(`${tmpFile}.tmp`, '{partial', 'utf8');
      expect(__loadAgentPerformanceFromFile(tmpFile)).toBeNull();
    });
  });

  describe('construct → record → new-instance flow (the whole point)', () => {
    it('empty-file construction leaves all agents at zero history', () => {
      const mgr = new AgentWeightManager(1, { skipHydration: false });
      for (const agent of ALL_AGENTS) {
        const metrics = mgr.getAgentMetrics(agent);
        expect(metrics.samples).toBe(0);
      }
    });

    it('records after restart are preserved (the core guarantee)', () => {
      const mgr1 = new AgentWeightManager(1, { skipHydration: false });
      // Feed the recalc interval (10 records) so the persistence fires.
      for (let i = 0; i < 10; i++) {
        mgr1.recordPerformance('TechnicalAnalyst', i % 3 !== 0, 0.7); // ~67% correct
      }
      const metricsBefore = mgr1.getAgentMetrics('TechnicalAnalyst');
      expect(metricsBefore.samples).toBe(10);
      expect(metricsBefore.accuracy).toBeGreaterThan(0.5);

      // Sanity — file actually got written with a payload for our agent.
      expect(fs.existsSync(tmpFile)).toBe(true);
      const persisted = __loadAgentPerformanceFromFile(tmpFile);
      expect(persisted).not.toBeNull();
      expect(persisted!.performanceHistory.TechnicalAnalyst).toHaveLength(10);
      expect(persisted!.userId).toBe(1);

      // Simulated restart: construct a new instance, same userId.
      const mgr2 = new AgentWeightManager(1, { skipHydration: false });
      const metricsAfter = mgr2.getAgentMetrics('TechnicalAnalyst');
      expect(metricsAfter.samples).toBe(10);
      expect(metricsAfter.accuracy).toBeCloseTo(metricsBefore.accuracy, 6);
    });

    it('skips rehydration when the userId does not match (multi-user isolation)', () => {
      const mgr1 = new AgentWeightManager(1, { skipHydration: false });
      for (let i = 0; i < 10; i++) mgr1.recordPerformance('TechnicalAnalyst', true, 0.8);
      // Construct for a DIFFERENT user — should NOT inherit user 1's history.
      const mgr2 = new AgentWeightManager(999);
      expect(mgr2.getAgentMetrics('TechnicalAnalyst').samples).toBe(0);
    });

    it('does not throw on a read-only data dir — persistence is best-effort', () => {
      // If the data dir can't be written to (e.g., container with ro fs),
      // recording still works; only the save is skipped. We simulate by
      // pointing SEER_DATA_DIR at an impossibly nested path that can't be
      // created.
      process.env.SEER_DATA_DIR = '/proc/forbidden/nope/seer';
      const mgr = new AgentWeightManager(1, { skipHydration: false });
      expect(() => {
        for (let i = 0; i < 10; i++)
          mgr.recordPerformance('TechnicalAnalyst', true, 0.6);
      }).not.toThrow();
    });

    it('file is created on the FIRST recalc tick, not before', () => {
      const mgr = new AgentWeightManager(1, { skipHydration: false });
      // 9 records — one short of WEIGHT_RECALC_INTERVAL. No file yet.
      for (let i = 0; i < 9; i++)
        mgr.recordPerformance('TechnicalAnalyst', true, 0.6);
      expect(fs.existsSync(tmpFile)).toBe(false);
      // 10th record — tips over the recalc threshold → file exists.
      mgr.recordPerformance('TechnicalAnalyst', true, 0.6);
      expect(fs.existsSync(tmpFile)).toBe(true);
      // File contains version 1 payload (not half-written).
      const saved = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      expect(saved.version).toBe(1);
      expect(saved.userId).toBe(1);
    });
  });
});
