# SEER tRPC API Rules
# Applies to: server/routers/**, server/_core/trpc.ts, client/src/**

## tRPC Architecture
- 43 routers — all registered in `server/routers/index.ts` (or `appRouter`)
- `server/_core/trpc.ts`: tRPC initialization — defines `publicProcedure`, `protectedProcedure`, context
- `protectedProcedure`: validates session cookie, attaches `ctx.userId` and `ctx.user`
- `publicProcedure`: no auth — only for login, register, health checks

## Procedure Types
```typescript
// Query: read-only, GET-like
export const getPositions = protectedProcedure
  .input(z.object({ tradingMode: z.enum(['paper', 'live']) }))
  .query(async ({ ctx, input }) => {
    // ctx.userId is guaranteed — no need to check auth
    return db.select().from(positions)
      .where(and(
        eq(positions.userId, ctx.userId),
        eq(positions.tradingMode, input.tradingMode)
      ));
  });

// Mutation: write operations
export const startAutoTrading = protectedProcedure
  .input(z.object({ symbol: z.string(), mode: z.enum(['paper', 'live']) }))
  .mutation(async ({ ctx, input }) => {
    // ...
  });
```

## Key Routers
| Router | Purpose | Key Procedures |
|---|---|---|
| `seerMultiRouter` | Primary trading operations | getStatus, getSymbolStates, startAutoTrading, stopAutoTrading, getOpenPositions |
| `automatedTrading` | User trading settings | getSettings, updateSettings, getTradeHistory |
| `healthRouter` | System health | agent uptime, latency metrics, error tracking |
| `agentSignalsRouter` | Signal data | getSignals, getAgentPerformance, getConsensusMetrics |
| `monitoringRouter` | Real-time metrics | performance data, WebSocket event stream |
| `settingsRouter` | User preferences | exchange configs, API key management (encrypted) |
| `consensusBacktestRouter` | Backtesting | backtest with different consensus thresholds |
| `advancedAIRouter` | ML operations | pattern recommendations, ML metrics |
| `mlAnalyticsRouter` | ML dashboard data | TradeSuccessPredictor status, training data, gate stats |

## Input Validation
- ALL procedure inputs validated with Zod — no exceptions
- Use `z.enum()` for constrained values like `tradingMode`, `symbol`
- Use `z.coerce.number()` for query params that come as strings
- Never trust `ctx.userId` can be undefined in `protectedProcedure` — tRPC guarantees it

## Error Handling
```typescript
// Use TRPCError for all procedure errors
import { TRPCError } from '@trpc/server';

throw new TRPCError({
  code: 'NOT_FOUND',           // BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, INTERNAL_SERVER_ERROR
  message: 'Position not found',
});
```
- NEVER throw raw `Error` from procedures — always `TRPCError`
- Sensitive errors (DB connection, API keys): use `INTERNAL_SERVER_ERROR` with generic message to client, log full detail server-side

## Client Usage
```typescript
// In React components — use trpc hooks
import { trpc } from '@/utils/trpc';

// Query
const { data, isLoading } = trpc.seerMulti.getStatus.useQuery(undefined, {
  refetchInterval: 5000,  // Poll every 5s for live status
});

// Mutation
const startTrading = trpc.seerMulti.startAutoTrading.useMutation({
  onSuccess: () => utils.seerMulti.getStatus.invalidate(),
});
```

## Rate Limiting
- Auth procedures: 5 req/min per IP (brute force protection)
- General tRPC API: 30 req/min per authenticated user
- WebSocket/trading pipeline: NO rate limiting — must not impede signal processing
- Rate limiting implemented via `RateLimiter` service backed by Redis

## tRPC Context
```typescript
// ctx is available in all procedures
ctx.userId    // string — guaranteed in protectedProcedure
ctx.user      // User object — from DB via session cookie
ctx.db        // Drizzle DB instance
ctx.socket?   // Socket.io server instance (for emitting events from procedures)
```

## Subscription Procedures (if used)
- tRPC subscriptions over WebSocket for streaming data
- Use sparingly — prefer Socket.io for trading events (lower overhead for frequent ticks)
- Never use tRPC subscriptions for price tick streams — Socket.io handles this
