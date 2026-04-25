/**
 * Phase 20 — GlobalMarketEngine default symbols include SOL-USD.
 *
 * Pre-Phase 20 the engine spun up agent analyzers only for BTC-USD and
 * ETH-USD even though the price-feed and trade pipeline were configured
 * for BTC + ETH + SOL. SOL ticks streamed in, but no GlobalSymbolAnalyzer
 * ever ran for it → no signals → no trades, ever, on SOL. The 4-day
 * silence was on top of this background bug; even after Phase 19
 * unblocked the BTC and ETH paths, SOL stayed silent because nobody
 * was analyzing it.
 *
 * This test pins the defaults so a future symbol-list edit (e.g. trimming
 * to "just BTC for testing") can't silently disable SOL again. The DB
 * is the runtime source of truth via `globalSymbols`, but this constant
 * is the ground floor for fresh installs and migrations.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 20 — GlobalMarketEngine default symbols', () => {
  const sourceFile = path.resolve(
    __dirname,
    '..',
    'services',
    'GlobalMarketEngine.ts',
  );

  it('source declares DEFAULT_SYMBOLS containing BTC-USD, ETH-USD, SOL-USD', () => {
    // We test the source file directly because GlobalMarketEngine has
    // heavy startup-time imports (DB, exchanges, all agents) that we
    // don't want to instantiate just to read a constant. The raw source
    // is the single source of truth for what defaults ship.
    const src = fs.readFileSync(sourceFile, 'utf8');
    const match = src.match(/const DEFAULT_SYMBOLS\s*=\s*\[([^\]]+)\];/);
    expect(match).not.toBeNull();
    const arrayLiteral = match![1];
    expect(arrayLiteral).toMatch(/'BTC-USD'/);
    expect(arrayLiteral).toMatch(/'ETH-USD'/);
    expect(arrayLiteral).toMatch(/'SOL-USD'/);
  });

  it('all 3 trading symbols are subscribed in _core/index.ts price-feed wiring', () => {
    // The cross-module invariant: whatever symbols the engine analyzes
    // MUST also be subscribed in the price-feed startup or there will
    // be no ticks to analyze. Catches the symmetric mistake of trimming
    // the engine list while leaving the price-feed list intact (the
    // exact shape of the SOL bug, just inverted).
    const coreSrc = fs.readFileSync(
      path.resolve(__dirname, '..', '_core', 'index.ts'),
      'utf8',
    );
    expect(coreSrc).toMatch(/['"]BTC-USD['"]/);
    expect(coreSrc).toMatch(/['"]ETH-USD['"]/);
    expect(coreSrc).toMatch(/['"]SOL-USD['"]/);
  });
});
