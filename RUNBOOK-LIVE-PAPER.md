# SEER Live Paper Trading — Runbook

**Bootstrapped:** 2026-04-27 12:26 IST
**Mode:** Paper trading (no real money)
**User:** id=99999 (rd@seerticks.com), $10K notional
**Symbols:** BTC-USD, ETH-USD, SOL-USD

---

## What's running

| Component | State | Where |
|---|---|---|
| MySQL 8.4.9 | UP (Docker, container `seer-mysql`) | `127.0.0.1:3307` |
| SEER server | UP | http://localhost:3001/ |
| Coinbase WebSocket | UP | streaming all 3 symbols |
| Agents | 14 wired per symbol — including unlocked OnChainAnalyst + WhaleTracker | DB-persisted |
| User session | Active — auto-trade ON | DB row `tradingModeConfig.userId=99999` |
| First trade | BTC-USD long @ $77,776.17 | `paperPositions.id=1` |

---

## Open the dashboard

```
http://localhost:3001/
```
The server's Vite dev frontend serves the React UI on the same port. If
you need to log in, use email **rd@seerticks.com** (no password set —
local-only). If the UI requires OAuth or password, just query the DB
directly using the commands below.

---

## Live monitoring — commands

```bash
# Tail the server log (full noise)
tail -f /Users/rdaulakh/Desktop/Seerticks/data/server-logs/seer.log

# Tail just SIGNAL/CONSENSUS/TRADE events
tail -f /Users/rdaulakh/Desktop/Seerticks/data/server-logs/seer.log | grep -E "SIGNAL_|CONSENSUS|TRADE_|paperEngine|CIRCUIT|Sessions:"

# Open paper positions
docker exec seer-mysql mysql -u root -pseerlocal seer -e "SELECT id, symbol, side, entryPrice, currentPrice, unrealizedPnl, status FROM paperPositions WHERE userId=99999 ORDER BY id DESC LIMIT 20;"

# Closed trades + win rate
docker exec seer-mysql mysql -u root -pseerlocal seer -e "
  SELECT
    COUNT(*) AS n_trades,
    SUM(CASE WHEN pnlAfterCosts > 0 THEN 1 ELSE 0 END) AS wins,
    ROUND(100 * SUM(CASE WHEN pnlAfterCosts > 0 THEN 1 ELSE 0 END) / GREATEST(COUNT(*), 1), 1) AS win_pct,
    ROUND(SUM(pnlAfterCosts), 2) AS net_pnl_usd
  FROM paperTrades WHERE userId=99999;"

# Per-agent signal counts (confirms all 13 agents firing)
docker exec seer-mysql mysql -u root -pseerlocal seer -e "
  SELECT agentName, COUNT(*) AS n_signals,
         ROUND(AVG(confidence)*100, 1) AS avg_conf_pct
  FROM agentSignals
  WHERE timestamp > NOW() - INTERVAL 1 HOUR
  GROUP BY agentName
  ORDER BY n_signals DESC;"

# Recent rejections (why we're NOT trading)
docker exec seer-mysql mysql -u root -pseerlocal seer -e "
  SELECT eventType, symbol, action, reason, timestamp
  FROM tradingPipelineLog
  WHERE userId=99999
  ORDER BY id DESC LIMIT 30;"
```

---

## Phase 44 success bar

> Goal: ≥30 live trade outcomes. If live WR ≥ 45% → graduate to real
> money capped at $100. If live WR plateaus at backtest's ~38%, the
> structural ceiling is real even with the unlocked on-chain data, and
> we need a different alpha investment.

To check progress in one query:
```bash
docker exec seer-mysql mysql -u root -pseerlocal seer -e "
  SELECT
    COUNT(*) AS n_trades_so_far,
    30 - COUNT(*) AS remaining_to_30,
    ROUND(100 * SUM(CASE WHEN pnlAfterCosts > 0 THEN 1 ELSE 0 END) / GREATEST(COUNT(*), 1), 1) AS live_win_pct,
    ROUND(SUM(pnlAfterCosts), 2) AS net_pnl
  FROM paperTrades WHERE userId=99999;"
```

---

## Stop / restart commands

```bash
# Stop the SEER server (keep MySQL alive)
pkill -f "tsx server/_core/index.ts"

# Stop everything (server + DB)
pkill -f "tsx server/_core/index.ts"
docker stop seer-mysql

# Start everything fresh
docker start seer-mysql
cd /Users/rdaulakh/Desktop/Seerticks
ulimit -n 65536
export NODE_OPTIONS="--max-old-space-size=2048 --expose-gc"
export NODE_ENV=development
nohup ./node_modules/.bin/tsx server/_core/index.ts > data/server-logs/seer.log 2>&1 &
disown

# Drop & recreate DB (fresh start — destroys all paper trade history)
docker rm -f seer-mysql
docker run -d --name seer-mysql --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD=seerlocal -e MYSQL_DATABASE=seer \
  -p 3307:3306 mysql:8
# wait ~30s for MySQL to start, then re-run:
npx drizzle-kit migrate
npx tsx server/scripts/bootstrap-paper-user.ts
```

---

## Troubleshooting

### Server won't start
- Check port 3001 — if taken, the auto-finder picks 3002+. Look at log
  line `Found available port: NNNN`.
- Check `DATABASE_URL` in `.env` — must point to `127.0.0.1:3307`.
- Check Colima: `colima status` → if not running, `colima start`.

### No trades happening
- Most rejection reasons in `tradingPipelineLog` are
  `Not enough high-confidence agents for consensus`. This is normal —
  the agents are still warming up after restart. Slow agents (5-min
  cadence) need time to accumulate signals.
- `[CoinGecko] Rate limit exceeded` is expected — the OnChainFlowAnalyst
  retries every 60s. Other agents proceed without it.

### Schema drift surprises
- If you see `Unknown column 'X'`, run:
  ```
  npx drizzle-kit generate
  npx drizzle-kit migrate
  ```
- If migrate hangs, kill it and apply the latest .sql file in
  `drizzle/` directly:
  ```
  cat drizzle/0019_*.sql | sed 's|--> statement-breakpoint||g' | \
    docker exec -i seer-mysql mysql -u root -pseerlocal seer
  ```

### Whale Alert / Dune APIs
- Re-test keys: `npx tsx server/scripts/smoke-test-onchain-keys.ts`
- If a key is rotated, edit `.env` (NOT `.env.template`).
- `.env` is gitignored — never committed.

---

## What I want from you next

After this has run for ≥30 minutes (so 13 slow agents have all fired
several times) and ideally overnight (so US/Asia/Europe sessions are
all sampled), check:

```bash
docker exec seer-mysql mysql -u root -pseerlocal seer -e "
  SELECT
    COUNT(*) AS n_trades,
    ROUND(100 * SUM(CASE WHEN pnlAfterCosts > 0 THEN 1 ELSE 0 END) / GREATEST(COUNT(*),1), 1) AS live_wr,
    ROUND(SUM(pnlAfterCosts), 2) AS net_pnl
  FROM paperTrades WHERE userId=99999;"
```

The interesting comparison point is **live WR vs backtest 38.2%**:
- `live_wr ≥ 45%` → real-time on-chain data is adding alpha → green-light real-money probation
- `live_wr ≈ 38%` → on-chain data didn't help → ceiling is structural, need different alpha
- `live_wr < 35%` → signal got worse → something I broke or live conditions diverge from backtest; investigate

Either result is informative. Report the numbers back when you're ready.
