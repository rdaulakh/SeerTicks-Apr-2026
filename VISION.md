# SEER — Vision

> World's first AI Agent Trader for Crypto.
> One body, one mind, 33 agents as organs feeding ONE decision-maker
> that hunts, sizes, enters, manages, exits, and learns — autonomously,
> 24/7/365, in milliseconds.

---

## North Star Metric

**Win rate ≥ 80%** (on closed trades, all-time, after commissions).

Until this metric is hit, we iterate.

Secondary metrics — these matter but they are NOT the North Star:
- **Profit factor ≥ 2.0** (gross wins / |gross losses|)
- **Avg P&L per trade ≥ $1.00** (on a $10K bankroll)
- **Max drawdown ≤ 10%**
- **Brain decision latency ≤ 1 ms p99**
- **Hard-stop response latency ≤ 100 ms (event-driven, sub-tick)**

## Founding Principles

1. **One Mind**. There is one decision-maker — `TraderBrain`. All 33 agents
   feed sensations to a shared `Sensorium`. The brain reads the Sensorium
   every 100 ms (10 Hz) and decides. There is no committee, no voting that
   the brain doesn't ultimately decide. The agents are organs; the brain
   is the cortex.

2. **Autonomous by Default**. The user adds money and toggles auto-trade
   on. Everything else is the brain's job. Operator controls exist for
   incident response but are HIDDEN by default (Phase 93.9 Autonomous toggle).
   Knobs are not for users.

3. **Sub-second Reactivity**. Critical-path response (hard-stop breach,
   consensus flip) fires on the price-tick event itself, NOT on a polling
   schedule. Polling is for the slow lane (consensus, ratchets, time
   stops); event-driven is for the fast lane (hard stops).

4. **Reconciled with Exchange**. SEER's view of equity, positions, P&L,
   and trades is reconciled against the actual exchange every 5 min.
   Any drift is surfaced immediately and self-heals.

5. **Audit-grade Ledger**. Every dollar in, out, profit, loss, and
   commission is written to `paperTransactions`. The Wallet view reads
   from this ledger, never from derived counters.

6. **Conviction-weighted Sizing**. The brain bets bigger when 3 independent
   signals agree (opportunity score + agent stance + sensor confluence);
   smaller when they don't. Range: 3.75% → 15% of equity per trade.

7. **No Same-symbol Conflict**. The brain never holds a LONG and SHORT on
   the same symbol simultaneously. Three-layer guard (Sensorium, brain,
   executor) + legacy engine guard. (Phase 93.10)

8. **Trades to Truth, Not to Theory**. Every entry must clear:
   gate-0 vetoes → opportunity score ≥ threshold → confluence ≥ N
   sensors → stance not opposing → fresh market data. Every exit must
   have a reason (hard stop / consensus flip / momentum crash / stale /
   profit target / direction flip).

9. **Learns from Every Trade**. Every closed trade feeds back into agent
   weights (Brier-score calibration), the alpha library (pattern win
   rates), and the brain's own decision evaluator. Patterns that decay
   are retired.

10. **Institutional UI**. Bloomberg / IBKR density. Monospace numbers.
    Color-coded P&L. No emojis. Dark and light mode. 100% responsive.
    (Phase 93.10–93.14)

---

## What "Done" Looks Like

The platform hits all of these simultaneously, sustained over ≥ 100
closed trades:

- [ ] **Win rate ≥ 80%** ← North Star
- [ ] Profit factor ≥ 2.0
- [ ] Avg P&L per trade ≥ $1.00
- [ ] Max drawdown ≤ 10%
- [ ] Zero same-symbol direction conflicts
- [ ] Zero unmanaged hydrated positions (all have stops)
- [ ] Zero wallet drift > $5 sustained > 10 min
- [ ] Brain tick latency p99 ≤ 1 ms

Until then, the autonomous improvement loop runs.

---

## Current Snapshot (audited 2026-05-13)

| Metric | Current | Target | Gap |
|---|---|---|---|
| Win rate (all-time, 134 trades) | 42.5% | 80% | **-37.5 pp** |
| Win rate (last 7 days, 102 trades) | 45.1% | 80% | -34.9 pp |
| Win rate (last 5–15 min hold trades) | 66.7% | 80% | -13.3 pp |
| Profit factor (all-time) | 1.09 | 2.0 | -0.91 |
| Avg P&L per trade | $0.06 | $1.00 | -$0.94 |
| Same-symbol conflicts | 0 (post-fix) | 0 | ✓ |
| Hydrated positions w/o stops | 0 (post-fix) | 0 | ✓ |
| Brain tick p99 latency | ~200 µs | ≤ 1 ms | ✓ |

**Top suspected gap drivers** (to investigate per iteration):
1. **Entry gate too loose** — `minOpportunityScore` may be admitting marginal
   setups. The 5–15 min hold bucket has 66.7% WR — those are the brain's
   highest-conviction trades. Force the rest into that bucket via tighter gates.
2. **Exit timing too late** — 30–60 min hold bucket has 41.2% WR with avg
   −$0.51. Brain is letting losers ride past the sweet spot.
3. **Stop loss / take profit ratio inverted** — current 1.2% stop vs 1.0%
   take profit means a 50% win rate breaks even before commissions.
   Win rate 80% requires either tighter stops, looser TP, or strictly
   asymmetric edge per trade.

---

## The Autonomous Improvement Loop

Every 30 minutes the loop wakes:

1. **Audit**: Pull win rate, profit factor, avg trade, exit-reason breakdown
   over last 6 h / 24 h / 7 d.
2. **Diagnose**: Which exit reason has the worst win rate? Which time bucket?
   Which symbol? Which strategy tag?
3. **Hypothesize**: One concrete config change that should help.
4. **Ship**: Edit code or systemConfig, commit, deploy.
5. **Wait**: Let the next 30 min produce data.
6. **Verify**: Did win rate move? Profit factor? If yes, keep. If no, revert
   or try a different lever.

The loop terminates when win rate ≥ 80% over ≥ 50 trades in the last 24 h.
