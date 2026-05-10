/**
 * traceContext — Phase 67 distributed-trace primitive.
 *
 * Every signal that enters the pipeline gets a traceId. The traceId flows
 * through consensus → executor → order placement → fill → position lifecycle.
 * When auditors (or humans) need to reconstruct what happened to a trade,
 * one grep on the traceId reassembles the entire chain, even if events
 * landed in different log streams.
 *
 * Pre-Phase-67: every audit was archaeology because pm2 logs are
 * `console.log` of unrelated lines from many subsystems. We had to grep
 * for symbol + timestamp and hope nothing else in that second was noise.
 *
 * Implementation: a thin wrapper that generates compact-but-unique IDs
 * (12 hex chars = 6 bytes random) and a structured-log helper that JSON-
 * encodes a known event shape. Adopting this everywhere is gradual —
 * services can opt-in over time. Only critical paths need it for the
 * audit-trail goal.
 */

import { randomBytes } from 'crypto';

export type TraceId = string;

/**
 * Generates a 12-char hex traceId. Compact enough for pm2 lines, long
 * enough to be unique across a busy production day (2^48 ≈ 280T values
 * per signal generated per day = no collision worry).
 */
export function generateTraceId(): TraceId {
  return randomBytes(6).toString('hex');
}

export interface TraceLogEvent {
  ts: string;            // ISO timestamp
  traceId: TraceId;
  symbol?: string;
  event: string;         // e.g. "SIGNAL_APPROVED", "ORDER_PLACED", "FILL"
  positionId?: number | string;
  orderId?: string;
  signalId?: string;
  side?: 'long' | 'short' | 'buy' | 'sell';
  price?: number;
  quantity?: number;
  pnl?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Emits a structured trace event as a single JSONL line. Caller-friendly:
 * Pass partial fields, the rest are filled. The output is grep-able by
 * traceId AND parsable for offline TCA / replay.
 */
export function trace(ev: Partial<TraceLogEvent> & Pick<TraceLogEvent, 'event'>): void {
  const full: TraceLogEvent = {
    ...ev,
    ts: new Date().toISOString(),
    traceId: ev.traceId ?? generateTraceId(),
    event: ev.event,
  };
  // One JSON object per line — `jq` and friends can parse the whole pm2 log.
  console.log(`[TRACE] ${JSON.stringify(full)}`);
}
