/**
 * SEER Wallet — Phase 93.13 (institutional polish on Phase 93.8 layout)
 *
 * The "where is my money" view. Reads from /api/trpc/trading.getWalletLedger
 * which pulls paperTransactions (audit-grade ledger) + paperWallets
 * (reconciled to Binance every 5 min).
 *
 * Sections (top to bottom):
 *   1. Balance summary cards — real money in, current balance, equity, unrealized
 *   2. Lifetime ledger totals — deposits, withdrawals, P&L, commissions
 *   3. Monthly chart — deposits / withdrawals / P&L / commissions
 *   4. Transaction history table — paginated full ledger
 *
 * Phase 93.13 polish: tighter padding, tabular-nums on every number,
 * uniform border-slate-800/60, no decorative gradients, type badges crisp,
 * mobile overflow-x-auto on table, font-mono on all amounts and timestamps.
 */

import { useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, ArrowDownToLine,
  Wallet as WalletIcon, Receipt, BarChart3, Activity,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

const TX_TYPE_COLORS: Record<string, string> = {
  DEPOSIT:        "bg-green-500/10 text-green-300 border-green-500/30",
  WITHDRAWAL:     "bg-orange-500/10 text-orange-300 border-orange-500/30",
  TRADE_PROFIT:   "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  TRADE_LOSS:     "bg-red-500/10 text-red-300 border-red-500/30",
  COMMISSION:     "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  POSITION_OPEN:  "bg-blue-500/10 text-blue-300 border-blue-500/30",
  POSITION_CLOSE: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  WALLET_RESET:   "bg-slate-500/10 text-slate-300 border-slate-500/30",
  ADJUSTMENT:     "bg-pink-500/10 text-pink-300 border-pink-500/30",
};

function fmt(n: number, sign = false): string {
  if (!Number.isFinite(n)) return "—";
  const s = sign && n > 0 ? "+" : "";
  return `${s}$${n.toFixed(2)}`;
}

export default function Wallet() {
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isLoading } = trpc.trading.getWalletLedger.useQuery(
    { limit: pageSize, offset: page * pageSize },
    { refetchInterval: 30000, staleTime: 15000 },
  );

  const liveWallet = data?.wallets?.live;
  const totals = data?.totals;
  const monthly = data?.monthly ?? [];
  const transactions = data?.transactions ?? [];

  // Total commission as % of net deposits — drag on returns.
  const commissionDragPct = totals && totals.netDeposited > 0
    ? (totals.totalCommissionsPaid / totals.netDeposited) * 100
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground pt-16 lg:pt-20">
      <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6 space-y-4 max-w-[1800px]">

        {/* ─── HEADER ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <WalletIcon className="w-5 h-5 lg:w-6 lg:h-6 text-cyan-400" />
              Wallet
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
              Real money in, fees paid, full ledger.
            </p>
          </div>
          {liveWallet?.updatedAt && (
            <p className="text-[10px] text-slate-500 font-mono text-right">
              Reconciled with exchange
              <br className="hidden sm:inline" />
              <span className="text-slate-400">{new Date(liveWallet.updatedAt).toLocaleTimeString([], { hour12: false })}</span>
            </p>
          )}
        </div>

        {/* ─── ROW 1: Balance summary ───────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:gap-3">
          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Real money in</p>
              <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <p className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums">
              {fmt(totals?.netDeposited ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
              {totals?.depositCount ?? 0} dep &minus; {totals?.withdrawalCount ?? 0} wd
            </p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Current balance</p>
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums">
              {fmt(liveWallet?.balance ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">cash on exchange</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Total equity</p>
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <p className="text-xl lg:text-2xl font-bold text-foreground font-mono tabular-nums">
              {fmt(liveWallet?.equity ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">cash + unrealized</p>
          </Card>

          <Card className="border-slate-800/60 bg-slate-900/40 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Unrealized P&amp;L</p>
              {(liveWallet?.unrealizedPnL ?? 0) >= 0
                ? <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
            </div>
            <p className={cn(
              "text-xl lg:text-2xl font-bold font-mono tabular-nums",
              (liveWallet?.unrealizedPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400",
            )}>
              {fmt(liveWallet?.unrealizedPnL ?? 0, true)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">open positions</p>
          </Card>
        </div>

        {/* ─── ROW 2: Lifetime ledger totals ────────────────────── */}
        <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-cyan-400" />
            Lifetime ledger
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 lg:gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Deposits</p>
              <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-green-400">
                {fmt(totals?.totalDeposited ?? 0)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">{totals?.depositCount ?? 0} events</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Withdrawals</p>
              <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-orange-400">
                {fmt(totals?.totalWithdrawn ?? 0)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono">{totals?.withdrawalCount ?? 0} events</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Trade profits</p>
              <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-emerald-400">
                {fmt(totals?.tradeProfits ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Trade losses</p>
              <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-red-400">
                {fmt(totals?.tradeLosses ?? 0)}
              </p>
            </div>
            <div className="md:border-l md:border-slate-700/40 md:pl-4">
              <p className="text-[10px] uppercase tracking-wider text-yellow-300/70">Fees paid</p>
              <p className="text-base lg:text-lg font-bold font-mono tabular-nums text-yellow-400">
                {fmt(totals?.totalCommissionsPaid ?? 0)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono tabular-nums">
                {commissionDragPct.toFixed(2)}% of deposits
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/40">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Net realized P&amp;L</p>
              <p className={cn(
                "text-xl lg:text-2xl font-bold font-mono tabular-nums",
                (totals?.netRealizedPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400",
              )}>{fmt(totals?.netRealizedPnL ?? 0, true)}</p>
            </div>
          </div>
        </Card>

        {/* ─── ROW 3: Monthly timeline chart ────────────────────── */}
        {monthly.length > 0 && (
          <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
              Monthly activity
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 12 }}
                  formatter={(v: any) => fmt(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="deposits"    name="Deposits"    fill="#10b981" />
                <Bar dataKey="withdrawals" name="Withdrawals" fill="#f59e0b" />
                <Bar dataKey="realized"    name="Realized P&L" fill="#3b82f6" />
                <Bar dataKey="commissions" name="Commissions" fill="#facc15" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* ─── ROW 4: Transaction history ───────────────────────── */}
        <Card className="border-slate-800/60 bg-slate-900/40 p-3 lg:p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Transaction history
            </h2>
            <span className="text-[10px] text-slate-500 font-mono">
              {data?.pagination?.total ?? 0} total
            </span>
          </div>
          {isLoading ? (
            <p className="text-xs text-slate-500 py-6 text-center">Loading ledger&hellip;</p>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No transactions on the ledger yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700/50">
                    <tr className="text-left">
                      <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Time</th>
                      <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Type</th>
                      <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Mode</th>
                      <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">Amount</th>
                      <th className="py-2 pr-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-right">Balance</th>
                      <th className="py-2 pl-3 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                        <td className="py-2 pr-3 font-mono text-slate-400 whitespace-nowrap tabular-nums">
                          {new Date(t.timestamp).toLocaleString([], { hour12: false })}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap",
                            TX_TYPE_COLORS[t.type] ?? "bg-slate-500/10 text-slate-300 border-slate-500/30",
                          )}>{t.type}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-400 uppercase text-[10px] font-mono">{t.tradingMode}</td>
                        <td className={cn(
                          "py-2 pr-3 text-right font-mono font-semibold tabular-nums",
                          t.amount > 0 ? "text-green-400" : "text-red-400",
                        )}>
                          {fmt(t.amount, true)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300 tabular-nums">
                          {fmt(t.balanceAfter)}
                        </td>
                        <td className="py-2 pl-3 text-slate-400 truncate max-w-md" title={t.description ?? ''}>
                          {t.description ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3 pt-3 border-t border-slate-700/40">
                <p className="text-[10px] text-slate-400 font-mono tabular-nums">
                  {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, data?.pagination?.total ?? 0)} of {data?.pagination?.total ?? 0}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="h-7 text-[11px] px-2.5"
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" /> Prev
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={!data?.pagination?.hasMore}
                    onClick={() => setPage(p => p + 1)}
                    className="h-7 text-[11px] px-2.5"
                  >
                    Next <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
