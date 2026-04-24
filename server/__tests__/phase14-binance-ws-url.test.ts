/**
 * Phase 14 — Binance WebSocket base URL is env-configurable.
 *
 * Why: Binance.com's WS (stream.binance.com:9443) is geo-blocked (HTTP 451)
 * for US-East hosts where seerticks.com runs. The existing code had the URL
 * hard-coded, so Binance WS was effectively unusable on the prod box — which
 * left Coinbase WS as the sole primary source. When Coinbase gapped (every
 * 3–10s per 2026-04-21→04-24 incident), there was no working fallback.
 *
 * The fix: BINANCE_WS_BASE_URL env var. Prod sets it to Binance.US
 * (wss://stream.binance.us:9443), which speaks the IDENTICAL protocol and
 * is NOT geo-blocked. Default (dev, non-US) stays on Binance.com so the
 * existing code path is untouched for anyone not opting in.
 *
 * These tests lock down the resolution logic so an accidental change to
 * `resolveBinanceWsBaseUrl` doesn't silently re-break the geo-block fix.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBinanceWsBaseUrl,
  DEFAULT_BINANCE_WS_BASE_URL,
} from '../exchanges/BinanceWebSocketManager';

describe('Phase 14 — resolveBinanceWsBaseUrl', () => {
  it('returns the hard-coded default when BINANCE_WS_BASE_URL is unset', () => {
    expect(resolveBinanceWsBaseUrl({})).toBe(DEFAULT_BINANCE_WS_BASE_URL);
    expect(DEFAULT_BINANCE_WS_BASE_URL).toBe('wss://stream.binance.com:9443');
  });

  it('honors BINANCE_WS_BASE_URL when provided (Binance.US the canonical use)', () => {
    expect(
      resolveBinanceWsBaseUrl({
        BINANCE_WS_BASE_URL: 'wss://stream.binance.us:9443',
      }),
    ).toBe('wss://stream.binance.us:9443');
  });

  it('strips any trailing slash so callers can append a path cleanly', () => {
    // Preserves both forms so downstream template strings like
    //   `${base}/stream?streams=...`
    //   `${base}/ws/btcusdt@trade`
    // never produce double slashes that some WS gateways reject.
    expect(
      resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: 'wss://x.example/' }),
    ).toBe('wss://x.example');
    expect(
      resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: 'wss://x.example///' }),
    ).toBe('wss://x.example');
  });

  it('falls back to default on empty-string / whitespace-only env value', () => {
    // An operator who sets the var to an empty string probably meant "unset" —
    // honor that rather than producing a broken URL.
    expect(resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: '' })).toBe(
      DEFAULT_BINANCE_WS_BASE_URL,
    );
    expect(resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: '   ' })).toBe(
      DEFAULT_BINANCE_WS_BASE_URL,
    );
  });

  it('trims surrounding whitespace (accidental copy/paste)', () => {
    expect(
      resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: '  wss://stream.binance.us:9443  ' }),
    ).toBe('wss://stream.binance.us:9443');
  });

  it('does NOT validate the URL shape (kept simple — prod log will surface a bad URL fast)', () => {
    // We intentionally don't block arbitrary strings; a typo will surface in
    // the first WS connection attempt. This keeps the helper pure + testable
    // and avoids a validation library for a one-env-var feature.
    expect(resolveBinanceWsBaseUrl({ BINANCE_WS_BASE_URL: 'not-a-url' })).toBe(
      'not-a-url',
    );
  });
});
