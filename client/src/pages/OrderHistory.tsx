/**
 * SEER Order History — Institutional Grade (Phase 93.12)
 *
 * Single source of truth for CLOSED trade audit log. Open positions live
 * exclusively on the Positions page.
 *
 * Design: Bloomberg-style dense table, monospace numerics, collapsible
 * filters (autonomous platform — filters are optional, not mandatory).
 */

import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  Download,
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
  Clock,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function OrderHistory() {
  const { user, loading: authLoading } = useAuth();
  const [isPaper, setIsPaper] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("all");
  const [selectedExitReason, setSelectedExitReason] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  const filtersActive =
    !!startDate || !!endDate || selectedSymbol !== "all" || selectedExitReason !== "all";

  const { data: positions, isLoading: positionsLoading } =
    trpc.orderHistory.getClosedPositions.useQuery(
      {
        isPaper,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        symbol: selectedSymbol === "all" ? undefined : selectedSymbol,
        exitReason: selectedExitReason === "all" ? undefined : selectedExitReason,
      },
      {
        enabled: !!user,
        refetchInterval: 10_000, // closed trades; 10s is plenty
      }
    );

  const { data: analytics, isLoading: analyticsLoading } =
    trpc.orderHistory.getAnalytics.useQuery(
      { isPaper },
      { enabled: !!user, refetchInterval: 10_000 }
    );

  const { data: symbols } = trpc.orderHistory.getSymbols.useQuery(
    { isPaper },
    { enabled: !!user }
  );

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedSymbol("all");
    setSelectedExitReason("all");
  };

  const exportToCSV = () => {
    if (!positions || positions.length === 0) return;

    const headers = [
      "Symbol",
      "Side",
      "Entry Price",
      "Exit Price",
      "Quantity",
      "Entry Time",
      "Exit Time",
      "Duration (min)",
      "Exit Reason",
      "Realized P&L",
      "P&L %",
      "Commission",
    ];

    const rows = positions.map((pos: any) => {
      const entryTime = new Date(pos.entryTime);
      const exitTime = pos.exitTime ? new Date(pos.exitTime) : null;
      const durationMin = exitTime
        ? Math.round((exitTime.getTime() - entryTime.getTime()) / 60000)
        : 0;

      const exitPrice = pos.currentPrice || 0;
      const pnlPercent =
        pos.realizedPnl && pos.entryPrice
          ? (
              (Number(pos.realizedPnl) / (Number(pos.entryPrice) * Number(pos.quantity))) *
              100
            ).toFixed(2)
          : "0.00";

      return [
        pos.symbol,
        pos.side.toUpperCase(),
        Number(pos.entryPrice).toFixed(8),
        Number(exitPrice).toFixed(8),
        Number(pos.quantity).toFixed(8),
        format(entryTime, "yyyy-MM-dd HH:mm:ss"),
        exitTime ? format(exitTime, "yyyy-MM-dd HH:mm:ss") : "",
        durationMin,
        pos.exitReason || "manual",
        pos.realizedPnl ? Number(pos.realizedPnl).toFixed(2) : "0.00",
        pnlPercent,
        pos.commission ? Number(pos.commission).toFixed(2) : "0.00",
      ];
    });

    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `order-history-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatDuration = (entryTime: string, exitTime: string | null) => {
    if (!exitTime) return "—";
    const diffMin = Math.round(
      (new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000
    );
    if (diffMin < 60) return `${diffMin}m`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hours}h ${mins}m`;
  };

  const exitReasonBadge = (reason: string | null) => {
    if (!reason)
      return (
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
          MANUAL
        </Badge>
      );

    const variants: Record<
      string,
      { cls: string; icon: any }
    > = {
      manual: { cls: "bg-slate-700/30 text-slate-300 border-slate-600/40", icon: null },
      stop_loss: { cls: "bg-red-500/15 text-red-400 border-red-500/30", icon: AlertCircle },
      take_profit: {
        cls: "bg-green-500/15 text-green-400 border-green-500/30",
        icon: Target,
      },
      liquidation: { cls: "bg-red-500/15 text-red-400 border-red-500/30", icon: AlertCircle },
      system: { cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: null },
    };

    const config = variants[reason] || variants.manual;
    const Icon = config.icon;

    return (
      <Badge className={cn("text-[10px] font-mono px-1.5 py-0 gap-1", config.cls)}>
        {Icon && <Icon className="h-2.5 w-2.5" />}
        {reason.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  const positionCount = positions?.length ?? 0;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-3 sm:p-4 lg:p-6">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-3 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-3 lg:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">Order History</h1>
            <p className="text-[11px] lg:text-xs text-muted-foreground mt-0.5 hidden sm:block">
              Closed positions · audit log
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={isPaper ? "paper" : "live"} onValueChange={(v) => setIsPaper(v === "paper")}>
              <SelectTrigger className="h-8 w-[110px] text-xs border-slate-700 bg-slate-900/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="paper">Paper</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((s) => !s)}
              className="h-8 text-xs border-slate-700 bg-slate-900/60 hover:bg-slate-800"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
              Filters
              {filtersActive && (
                <Badge className="ml-1.5 h-4 px-1 text-[9px] bg-blue-500/20 text-blue-400 border-blue-500/30">
                  ACTIVE
                </Badge>
              )}
            </Button>
            <Button
              onClick={exportToCSV}
              variant="outline"
              size="sm"
              disabled={!positions || positions.length === 0}
              className="h-8 text-xs border-slate-700 bg-slate-900/60 hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          </div>
        </div>

        {/* Analytics strip — dense KPI tiles, no Card chrome */}
        {analyticsLoading ? (
          <div className="grid gap-2 lg:gap-3 grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 bg-slate-800/40" />
            ))}
          </div>
        ) : analytics ? (
          <div className="grid gap-2 lg:gap-3 grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Total Trades"
              value={analytics.totalTrades.toLocaleString()}
              subtext={`${analytics.winningTrades}W / ${analytics.losingTrades}L`}
            />
            <KpiTile
              label="Net P&L"
              value={`${analytics.netPnl >= 0 ? "+" : ""}$${analytics.netPnl.toFixed(2)}`}
              tone={analytics.netPnl >= 0 ? "pos" : "neg"}
              subtext={`+$${analytics.totalProfit.toFixed(2)} / -$${Math.abs(
                analytics.totalLoss
              ).toFixed(2)}`}
              icon={
                analytics.netPnl >= 0 ? (
                  <TrendingUp className="w-3 h-3 text-green-400" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-red-400" />
                )
              }
            />
            <KpiTile
              label="Win Rate"
              value={`${analytics.winRate}%`}
              subtext={`PF ${analytics.profitFactor.toFixed(2)}`}
              icon={<Target className="w-3 h-3 text-slate-400" />}
            />
            <KpiTile
              label="Avg Duration"
              value={
                analytics.avgTradeDuration > 0
                  ? `${Math.round(analytics.avgTradeDuration / 60)}m`
                  : "—"
              }
              subtext={`W $${analytics.avgWin.toFixed(2)} / L $${Math.abs(
                analytics.avgLoss
              ).toFixed(2)}`}
              icon={<Clock className="w-3 h-3 text-slate-400" />}
            />
          </div>
        ) : null}

        {/* Filters — collapsed by default */}
        {showFilters && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 lg:p-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <FilterField label="Start Date">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 text-xs bg-slate-900/60 border-slate-700"
                />
              </FilterField>
              <FilterField label="End Date">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs bg-slate-900/60 border-slate-700"
                />
              </FilterField>
              <FilterField label="Symbol">
                <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                  <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    <SelectItem value="all">All Symbols</SelectItem>
                    {symbols?.map((symbol) => (
                      <SelectItem key={symbol} value={symbol}>
                        {symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Exit Reason">
                <Select value={selectedExitReason} onValueChange={setSelectedExitReason}>
                  <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    <SelectItem value="all">All Reasons</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="stop_loss">Stop Loss</SelectItem>
                    <SelectItem value="take_profit">Take Profit</SelectItem>
                    <SelectItem value="liquidation">Liquidation</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </div>
            {filtersActive && (
              <div className="mt-3 flex justify-end">
                <Button
                  onClick={clearFilters}
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Trade History Table */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-3 py-2 lg:px-4 lg:py-2.5 border-b border-border">
            <h2 className="text-xs lg:text-sm font-bold uppercase tracking-wider text-foreground">
              Trade History
            </h2>
            <span className="text-[11px] text-muted-foreground font-mono">
              {positionCount.toLocaleString()} closed
            </span>
          </div>

          {positionsLoading ? (
            <div className="space-y-1 p-3">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-full bg-slate-800/40" />
              ))}
            </div>
          ) : positions && positions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Symbol
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Side
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500 text-right">
                      Entry
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500 text-right">
                      Exit
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500 text-right">
                      Qty
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Entered
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Exited
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Hold
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500">
                      Exit Reason
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500 text-right">
                      P&L
                    </TableHead>
                    <TableHead className="h-8 text-[10px] uppercase tracking-wider text-slate-500 text-right">
                      P&L %
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos: any) => {
                    const pnl = pos.realizedPnl ? Number(pos.realizedPnl) : 0;
                    const exitPrice = pos.currentPrice ? Number(pos.currentPrice) : 0;
                    const pnlPercent =
                      pos.realizedPnl && pos.entryPrice
                        ? (pnl / (Number(pos.entryPrice) * Number(pos.quantity))) * 100
                        : 0;
                    const isProfit = pnl >= 0;

                    return (
                      <TableRow
                        key={pos.id}
                        className="border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                      >
                        <TableCell className="py-2 font-mono font-semibold text-slate-100">
                          {pos.symbol}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge
                            className={cn(
                              "text-[10px] font-mono px-1.5 py-0",
                              pos.side === "long"
                                ? "bg-green-500/15 text-green-400 border-green-500/30"
                                : "bg-red-500/15 text-red-400 border-red-500/30"
                            )}
                          >
                            {pos.side.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-slate-200 tabular-nums">
                          ${Number(pos.entryPrice).toFixed(2)}
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-slate-200 tabular-nums">
                          ${exitPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-slate-400 tabular-nums">
                          {Number(pos.quantity).toFixed(4)}
                        </TableCell>
                        <TableCell className="py-2 text-xs font-mono text-slate-400">
                          {format(new Date(pos.entryTime), "MMM dd, HH:mm")}
                        </TableCell>
                        <TableCell className="py-2 text-xs font-mono text-slate-400">
                          {pos.exitTime
                            ? format(new Date(pos.exitTime), "MMM dd, HH:mm")
                            : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-xs font-mono text-slate-400">
                          {formatDuration(pos.entryTime, pos.exitTime)}
                        </TableCell>
                        <TableCell className="py-2">
                          {exitReasonBadge(pos.exitReason)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "py-2 text-right font-mono font-bold tabular-nums",
                            isProfit ? "text-green-400" : "text-red-400"
                          )}
                        >
                          {isProfit ? "+" : ""}${pnl.toFixed(2)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "py-2 text-right font-mono tabular-nums",
                            pnlPercent >= 0 ? "text-green-400" : "text-red-400"
                          )}
                        >
                          {pnlPercent >= 0 ? "+" : ""}
                          {pnlPercent.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 px-4">
              <Calendar className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-foreground font-medium">No closed positions</p>
              <p className="text-xs text-muted-foreground mt-1">
                {filtersActive
                  ? "Try adjusting your filters"
                  : "Closed trades will appear here"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// KPI tile — dense, no Card chrome
// =============================================================================
interface KpiTileProps {
  label: string;
  value: string;
  subtext?: string;
  tone?: "pos" | "neg" | "neutral";
  icon?: React.ReactNode;
}

function KpiTile({ label, value, subtext, tone = "neutral", icon }: KpiTileProps) {
  const valueColor =
    tone === "pos" ? "text-green-500 dark:text-green-400" : tone === "neg" ? "text-red-500 dark:text-red-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 lg:px-4 lg:py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </span>
        {icon}
      </div>
      <div className={cn("text-lg lg:text-xl font-bold font-mono mt-0.5 tabular-nums", valueColor)}>
        {value}
      </div>
      {subtext && (
        <div className="text-[10px] text-slate-500 mt-0.5 font-mono tabular-nums">
          {subtext}
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
