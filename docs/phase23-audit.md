# Phase 23: Position Close Code Path Audit — Complete Findings

## All 16 code paths that set status='closed' on positions

| # | File:Line | Trigger | Has Real ExitPrice? | Has Real P&L? | Verdict |
|---|-----------|---------|---------------------|---------------|---------|
| 1 | PaperTradingEngine.ts:698 | In-memory close | YES (order.filledPrice) | YES | **FIXED** (Phase 23 — added DB update) |
| 2 | PaperTradingEngine.ts:713 | In-memory close fallback | YES | YES | **FIXED** (Phase 23) |
| 3 | seerMainMulti.ts:633 | Exit manager callback (1st instance) | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 4 | seerMainMulti.ts:966 | Orphan auto-close | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 5 | seerMainMulti.ts:1625 | Exit manager callback (2nd instance) | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 6 | seerMainMulti.ts:3352 | closePosition method | YES (priceFeedService, throws if missing) | YES | **OK** |
| 7 | db.ts:478 | Wallet reset (close all) | **BROKEN** — no exitPrice set at all | **BROKEN** — no P&L set | **MUST FIX** |
| 8 | db.ts:652 | closePaperPosition helper | Depends on caller | Depends on caller | **MISSING exitPrice field** |
| 9 | db.ts:711 | closeStalePaperPositions | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 10 | PositionManager.ts:574 | Live position close | YES (from caller) | YES | OK (live trading) |
| 11 | StrategyOrchestrator.ts:2656 | Veto exit | YES (currentPrice from price feed) | YES | OK |
| 12 | positionConsensusRouter.ts:462 | Manual override (paper) | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 13 | positionConsensusRouter.ts:474 | Manual override (live) | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 14 | PositionGuardian.ts:261 | Emergency exit | **BROKEN** — falls back to entryPrice | YES (from fallback) | **MUST FIX** |
| 15 | PositionMonitoringService.ts:417 | Stop loss/take profit | YES (from caller) | YES | OK |
| 16 | cleanupGhostData.ts:219 | Ghost cleanup | **BROKEN** — uses entryPrice, P&L = 0 | **BROKEN** — hardcoded 0 | **MUST FIX** |

## Root Cause Pattern

The same anti-pattern appears in 9 of 16 paths:

```typescript
// ANTI-PATTERN: Fallback chain that hides missing data
const exitPrice = priceData?.price || Number(position.currentPrice) || Number(position.entryPrice);
```

When `priceData?.price` is null (price feed disconnected) AND `currentPrice` is null/0 (never updated), this silently falls back to `entryPrice`, producing $0 P&L and corrupting financial data.

## Fix Strategy

**Principle: REJECT, don't fabricate.**

1. If real market price is not available → DO NOT close the position
2. Log the failure and retry later
3. Only exception: wallet reset (user explicitly requesting reset — mark positions with `data_integrity_issue`)
4. closePaperPosition helper must require exitPrice in the SET clause

## Paths to Fix

1. **seerMainMulti.ts:610** — Remove `|| Number(position.entryPrice)` fallback, reject if no real price
2. **seerMainMulti.ts:955** — Same fix for orphan auto-close
3. **seerMainMulti.ts:1598** — Same fix for 2nd exit manager callback
4. **db.ts:478** — Wallet reset: set exitPrice + calculate P&L from currentPrice, or mark as data_integrity_issue
5. **db.ts:652** — closePaperPosition: add exitPrice to SET clause
6. **db.ts:697** — closeStalePaperPositions: reject if no real currentPrice
7. **positionConsensusRouter.ts:441** — Manual override: reject if no real price
8. **PositionGuardian.ts:241** — Emergency exit: reject if no real price (already has skip logic but still falls back)
9. **cleanupGhostData.ts:220** — Ghost cleanup: use real price or mark as data_integrity_issue
