/**
 * SEER Wallet — Phase 93.8
 *
 * The "where is my money" view. User asked for: "how much money is real money,
 * how much charges we paid, and when we added how much money."
 *
 * This page answers exactly those questions.
 *
 * Sections (top to bottom):
 *   1. Balance summary cards: real money in, current balance, equity, unrealized
 *   2. Lifetime totals strip: deposits, withdrawals, realized P&L, commissions
 *   3. Monthly chart: deposits / withdrawals / realized P&L / commissions
 *   4. Transaction history table: paginated full ledger
 *
 * Reads from /api/trpc/trading.getWalletLedger which pulls from paperTransactions
 * (the audit-grade ledger) + paperWallets (reconciled to Binance every 5 min).
 */

import { useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine,
  Wallet as WalletIcon, Receipt, PieChart as PieChartIcon, Activity,
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
  DEPOSIT: "bg-green-500/20 text-green-300 border-green-500/40",
  WITHDRAWAL: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  TRADE_PROFIT: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  TRADE_LOSS: "bg-red-500/20 text-red-300 border-red-500/40",
  COMMISSION: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  POSITION_OPEN: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  POSITION_CLOSE: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  WALLET_RESET: "bg-gray-500/20 text-gray-300 border-gray-500/40",
  ADJUSTMENT: "bg-pink-500/20 text-pink-300 border-pink-500/40",
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
    { refetchInterval: 30000, staleTime: 15000 }
  );

  const liveWallet = data?.wallets?.live;
  const totals = data?.totals;
  const monthly = data?.monthly ?? [];
  const transactions = data?.transactions ?? [];

  // Compute total commission as percent of net deposits — drag on returns.
  const commissionDragPct = totals && totals.netDeposited > 0
    ? (totals.totalCommissionsPaid / totals.netDeposited) * 100
    : 0;

  return (
    <div className="space-y-4 p-3 md:p-4 max-w-[1800px] mx-auto">
      {/* ─── HEADER ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <WalletIcon className="w-6 h-6 text-cyan-400" />
            Wallet
          </h1>
          <p className="text-sm text-slate-400">
            Real money, real ledger. Where it came from, where it went.
          </p>
        </div>
        {liveWallet?.updatedAt && (
          <p className="text-[10px] text-slate-500">
            Reconciled with exchange · {new Date(liveWallet.updatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* ─── ROW 1: Balance summary ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="glass-card border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-cyan-300/70 uppercase tracking-wider">Real money in</p>
            <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {fmt(totals?.netDeposited ?? 0)}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            {totals?.depositCount ?? 0} deposits − {totals?.withdrawalCount ?? 0} withdrawals
          </p>
        </Card>

        <Card className="glass-card border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Current balance</p>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {fmt(liveWallet?.balance ?? 0)}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            cash on the exchange
          </p>
        </Card>

        <Card className="glass-card border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Total equity</p>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white font-mono">
            {fmt(liveWallet?.equity ?? 0)}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            cash + unrealized
          </p>
        </Card>

        <Card className="glass-card border-slate-700/50 p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Unrealized P&L</p>
            {(liveWallet?.unrealizedPnL ?? 0) >= 0
              ? <TrendingUp className="w-4 h-4 text-green-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />}
          </div>
          <p className={cn(
            "text-2xl font-bold font-mono",
            (liveWallet?.unrealizedPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"
          )}>
            {fmt(liveWallet?.unrealizedPnL ?? 0, true)}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">
            open positions only
          </p>
        </Card>
      </div>

      {/* ─── ROW 2: Lifetime ledger totals ──────────────────────── */}
      <Card className="glass-card border-slate-800/50 p-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-cyan-400" />
          Lifetime Ledger
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Deposits</p>
            <p className="text-xl font-bold font-mono text-green-400">
              {fmt(totals?.totalDeposited ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500">{totals?.depositCount ?? 0} events</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Withdrawals</p>
            <p className="text-xl font-bold font-mono text-orange-400">
              {fmt(totals?.totalWithdrawn ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500">{totals?.withdrawalCount ?? 0} events</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trade profits</p>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {fmt(totals?.tradeProfits ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trade losses</p>
            <p className="text-xl font-bold font-mono text-red-400">
              {fmt(totals?.tradeLosses ?? 0)}
            </p>
          </div>
          <div className="border-l border-slate-700/50 pl-4">
            <p className="text-[10px] text-yellow-300/70 uppercase tracking-wider">Commissions paid</p>
            <p className="text-xl font-bold font-mono text-yellow-300">
              {fmt(totals?.totalCommissionsPaid ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500">
              {commissionDragPct.toFixed(2)}% of net deposits
            </p>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Net realized P&L (profits + losses)</p>
            <p className={cn(
              "text-2xl font-bold font-mono",
              (totals?.netRealizedPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"
            )}>{fmt(totals?.netRealizedPnL ?? 0, true)}</p>
          </div>
        </div>
      </Card>

      {/* ─── ROW 3: Monthly timeline chart ──────────────────────── */}
      {monthly.length > 0 && (
        <Card className="glass-card border-slate-800/50 p-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-purple-400" />
            Monthly Activity
          </h2>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#64748b" style={{ fontSize: '10px' }} />
                <YAxis stroke="#64748b" style={{ fontSize: '10px' }} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: '12px' }}
                  formatter={(v: any) => fmt(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="deposits" name="Deposits" fill="#10b981" />
                <Bar dataKey="withdrawals" name="Withdrawals" fill="#f59e0b" />
                <Bar dataKey="realized" name="Realized P&L" fill="#3b82f6" />
                <Bar dataKey="commissions" name="Commissions" fill="#facc15" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ─── ROW 4: Transaction history ─────────────────────────── */}
      <Card className="glass-card border-slate-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Transaction History
            <span className="text-xs text-slate-500 normal-case">
              ({data?.pagination?.total ?? 0} total)
            </span>
          </h2>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-500 py-6 text-center">Loading ledger…</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">No transactions on the ledger yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-slate-700/50">
                  <tr className="text-left text-slate-500 uppercase tracking-wider">
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Mode</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3 text-right">Balance</th>
                    <th className="py-2 pl-3">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                      <td className="py-2 pr-3 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(t.timestamp).toLocaleString([], { hour12: false })}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={cn(
                          "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border",
                          TX_TYPE_COLORS[t.type] ?? "bg-slate-500/10 text-slate-300 border-slate-500/30"
                        )}>{t.type}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-400">{t.tradingMode}</td>
                      <td className={cn(
                        "py-2 pr-3 text-right font-mono font-semibold",
                        t.amount > 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {fmt(t.amount, true)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-300">
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
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/50">
              <p className="text-xs text-slate-400">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, data?.pagination?.total ?? 0)} of {data?.pagination?.total ?? 0}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="w-3 h-3 mr-1" /> Prev
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={!data?.pagination?.hasMore}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
