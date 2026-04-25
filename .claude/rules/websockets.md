# SEER WebSocket & Real-time Rules
# Applies to: server/services/CoinbasePublicWS.ts, server/services/DataGapResilience.ts, server/routers/seerMultiRouter.ts (WebSocket section), client/src/**

## Price Feed Architecture (3-Tier Fallback)
```
Tier 1: CoinbasePublicWS (WebSocket) — primary real-time feed
  ↓ (on disconnect/gap)
Tier 2: Coinbase REST API — backfill missing candles
  ↓ (on Coinbase unavailability)
Tier 3: Binance REST API (BinanceRestFallback) — secondary exchange data
```
- `DataGapResilience` service manages automatic failover and backfill
- Gap scanner: runs every 5 min, logs all gaps to `dataGapLogs` table
- NEVER assume the price feed is current — check timestamp of last tick before using
- Gap threshold: > 30s without tick = trigger backfill

## CoinbasePublicWS Rules
- Singleton per platform — connects to `wss://advanced-trade-ws.coinbase.com`
- Subscribes to: trades, ticker, level2 channels for tracked symbols
- `BinanceAdapter`: stores reconnect timeout handle — clear on disconnect to prevent memory leak
- Reconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s)
- On successful reconnect: trigger backfill for gap period before resuming live feed
- Log every reconnect with gap duration and data loss estimate

## Socket.io Server (WebSocket to Frontend)
- `WebSocketServerMulti`: routes per-user connections
- Authentication: verify session cookie on `connection` event — reject unauthenticated sockets
- Price ticks: broadcast globally to all connected clients (price data is public)
- Trading events: user-specific via `sendToUser(userId, event, data)`
- Memory leak prevention: track engine listeners per user, remove on disconnect

## Key Socket.io Events
| Event | Direction | Scope | Payload |
|---|---|---|---|
| `price:tick` | Server → Client | Global (broadcast) | `{ symbol, price, timestamp, source }` |
| `signal:update` | Server → Client | Per-user | `{ symbol, consensus, direction, agents }` |
| `position:opened` | Server → Client | Per-user | `{ positionId, symbol, side, entryPrice }` |
| `position:closed` | Server → Client | Per-user | `{ positionId, exitPrice, pnl, exitReason }` |
| `position:updated` | Server → Client | Per-user | `{ positionId, currentPrice, unrealizedPnl }` |
| `alert:circuit_breaker` | Server → Client | Per-user | `{ type, message, timestamp }` |
| `system:health` | Server → Client | Admin only | `{ agentStatuses, latency, errors }` |

## Client-Side WebSocket Usage
```typescript
// Connect once — in root layout or dedicated context, not per-component
const socket = io(VITE_API_URL, {
  withCredentials: true,    // Send session cookie
  transports: ['websocket']
});

// Always clean up in useEffect
useEffect(() => {
  socket.on('position:updated', handlePositionUpdate);
  return () => socket.off('position:updated', handlePositionUpdate);
}, []);  // Handler must be stable ref (useCallback) to avoid double-subscription
```

## Data Gap Resilience
- `DataGapResilience` service: continuously monitors tick timestamps
- Gap detected: immediately backfill from REST API (Coinbase first, Binance fallback)
- Backfill range: from last known good tick to current time
- Agents that depend on price history: invalidate their cached state during gap
- `dataGapLogs` table: records every gap — start time, end time, duration, source used for backfill

## Real-time Signal History
- `seerMainMulti.ts` maintains `signalHistory[]`: ring buffer, 288 entries (5-min intervals = 24h)
- Exposed via `seerMultiRouter.getSignalHistory()` tRPC query
- Do NOT replace ring buffer with DB queries for real-time dashboard — this is a performance choice
- Ring buffer survives server restart only via in-memory state — restarts reset to empty (by design)

## WebSocket Scaling
- Current: single-server Socket.io (no Redis adapter configured by default)
- For multi-instance: must add Redis adapter (`@socket.io/redis-adapter`) BEFORE scaling
- Without Redis adapter: user events from one instance won't reach users on other instances
- Price tick broadcast: unaffected by multi-instance (each instance has its own WS connection to Coinbase)
