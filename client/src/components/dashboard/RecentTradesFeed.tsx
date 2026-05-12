/**
 * RecentTradesFeed — last N closed trades.
 *
 * Different from BrainActivityStream: that one shows DECISIONS (enter,
 * exit, hold, abstain) — this one shows OUTCOMES (what we closed and what
 * we made/lost). Source: `orderHistory.getClosedPositions`.
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const LIMIT = 10;

function fmtUSD(n: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const sign = opts.sign && n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function relTime(t: Date | string | number | null | undefined): string {
  if (!t) return "—";
  const ms = Date.now() - new Date(t).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86400_000)}d`;
}

export default function RecentTradesFeed() {
  const { data, isLoading } = trpc.orderHistory.getClosedPositions.useQuery(
    { isPaper: true },
    { refetchInterval: 30_000, staleTime: 15_000 }
  );

  // Sort by exitTime desc, take LIMIT
  const trades = (data ?? [])
    .filter((t: any) => t.exitTime)
    .sort((a: any, b: any) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())
    .slice(0, LIMIT);

  return (
    <Card className="glass-card border-slate-800/50 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          Recent Closed
          <span className="text-xs text-slate-500 normal-case">(last {LIMIT})</span>
        </h2>
        <Link href="/order-history">
          <Button variant="ghost" size="sm" className="text-xs text-slate-400 h-6">
            All <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-500 py-4 text-center">Loading…</p>
      ) : trades.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">No closed trades yet.</p>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
          {trades.map((t: any) => {
            const pnl = Number(t.realizedPnl ?? 0);
            const comm = Number(t.commission ?? 0);
            const net = pnl - comm;
            const isLong = String(t.side).toLowerCase() === "long";
            const entry = Number(t.entryPrice ?? 0);
            const qty = Number(t.quantity ?? 0);
            const notional = entry * qty;
            const pct = notional > 0 ? (pnl / notional) * 100 : 0;
            const win = net > 0;
            return (
              <div
                key={t.id}
                className={cn(
                  "grid grid-cols-12 gap-2 items-center text-[11px] font-mono px-2 py-1.5 rounded border",
                  win
                    ? "border-green-500/20 bg-green-500/5"
                    : net < 0
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-slate-700/40 bg-slate-800/20"
                )}
                title={t.exitReason || ""}
              >
                <span className="col-span-2 text-[10px] text-slate-500">{relTime(t.exitTime)} ago</span>
                <span className="col-span-3 text-slate-200 font-bold truncate">{t.symbol}</span>
                <span
                  className={cn(
                    "col-span-2 text-[10px] font-bold uppercase",
                    isLong ? "text-green-300" : "text-red-300"
                  )}
                >
                  {t.side}
                </span>
                <span
                  className={cn(
                    "col-span-3 text-right font-bold",
                    win ? "text-green-400" : net < 0 ? "text-red-400" : "text-slate-300"
                  )}
                >
                  {fmtUSD(net, { sign: true })}
                </span>
                <span
                  className={cn(
                    "col-span-2 text-right text-[10px]",
                    pct >= 0 ? "text-green-400/80" : "text-red-400/80"
                  )}
                >
                  {fmtPct(pct)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
