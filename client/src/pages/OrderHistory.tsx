import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Download, TrendingUp, TrendingDown, DollarSign, Target, AlertCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function OrderHistory() {
  const { user, loading: authLoading } = useAuth();
  const [isPaper, setIsPaper] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("all");
  const [selectedExitReason, setSelectedExitReason] = useState<string>("all");

  // Fetch closed positions
  const { data: positions, isLoading: positionsLoading } = trpc.orderHistory.getClosedPositions.useQuery(
    {
      isPaper,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      symbol: selectedSymbol === "all" ? undefined : selectedSymbol,
      exitReason: selectedExitReason === "all" ? undefined : selectedExitReason,
    },
    {
      enabled: !!user,
      refetchInterval: 5000, // Refresh every 5 seconds
    }
  );

  // Fetch analytics
  const { data: analytics, isLoading: analyticsLoading } = trpc.orderHistory.getAnalytics.useQuery(
    { isPaper },
    {
      enabled: !!user,
      refetchInterval: 5000,
    }
  );

  // Fetch available symbols
  const { data: symbols } = trpc.orderHistory.getSymbols.useQuery(
    { isPaper },
    {
      enabled: !!user,
    }
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
      const pnlPercent = pos.realizedPnl && pos.entryPrice
        ? ((Number(pos.realizedPnl) / (Number(pos.entryPrice) * Number(pos.quantity))) * 100).toFixed(2)
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
    if (!exitTime) return "N/A";
    const entry = new Date(entryTime);
    const exit = new Date(exitTime);
    const diffMin = Math.round((exit.getTime() - entry.getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hours}h ${mins}m`;
  };

  const getExitReasonBadge = (reason: string | null) => {
    if (!reason) return <Badge variant="outline">Manual</Badge>;
    
    const variants: Record<string, { variant: "default" | "destructive" | "secondary" | "outline", icon: any }> = {
      manual: { variant: "outline", icon: null },
      stop_loss: { variant: "destructive", icon: AlertCircle },
      take_profit: { variant: "default", icon: Target },
      liquidation: { variant: "destructive", icon: AlertCircle },
      system: { variant: "secondary", icon: null },
    };

    const config = variants[reason] || variants.manual;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {reason.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
        <div className="flex items-center justify-center h-full">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="space-y-4 lg:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Order History</h1>
            <p className="text-muted-foreground text-sm lg:text-base hidden sm:block">
              Complete trade history with detailed P&L analysis
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={isPaper ? "paper" : "live"} onValueChange={(v) => setIsPaper(v === "paper")}>
              <SelectTrigger className="w-[110px] lg:w-[140px] text-xs lg:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paper">Paper</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={exportToCSV} variant="outline" disabled={!positions || positions.length === 0} size="sm" className="text-xs lg:text-sm">
              <Download className="h-3 w-3 lg:h-4 lg:w-4 mr-1 lg:mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </Button>
          </div>
        </div>

        {/* Analytics Cards */}
        {analyticsLoading ? (
          <div className="grid gap-2 sm:gap-3 lg:gap-4 grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : analytics ? (
          <div className="grid gap-2 sm:gap-3 lg:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.totalTrades}</div>
                <p className="text-xs text-muted-foreground">
                  {analytics.winningTrades} wins / {analytics.losingTrades} losses
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net P&L</CardTitle>
                {analytics.netPnl >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${analytics.netPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  ${analytics.netPnl.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Profit: ${analytics.totalProfit.toFixed(2)} / Loss: ${Math.abs(analytics.totalLoss).toFixed(2)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{analytics.winRate}%</div>
                <p className="text-xs text-muted-foreground">
                  Profit Factor: {analytics.profitFactor.toFixed(2)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {analytics.avgTradeDuration > 0
                    ? `${Math.round(analytics.avgTradeDuration / 60)}m`
                    : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Avg Win: ${analytics.avgWin.toFixed(2)} / Avg Loss: ${Math.abs(analytics.avgLoss).toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Filter order history by date, symbol, or exit reason</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Symbol</label>
                <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Symbols" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Symbols</SelectItem>
                    {symbols?.map((symbol) => (
                      <SelectItem key={symbol} value={symbol}>
                        {symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Exit Reason</label>
                <Select value={selectedExitReason} onValueChange={setSelectedExitReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Reasons" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="stop_loss">Stop Loss</SelectItem>
                    <SelectItem value="take_profit">Take Profit</SelectItem>
                    <SelectItem value="liquidation">Liquidation</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={clearFilters} variant="outline" size="sm">
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Order History Table */}
        <Card>
          <CardHeader>
            <CardTitle>Trade History</CardTitle>
            <CardDescription>
              {positions?.length || 0} closed positions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {positionsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : positions && positions.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Entry Price</TableHead>
                      <TableHead className="text-right">Exit Price</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Entry Time</TableHead>
                      <TableHead>Exit Time</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Exit Reason</TableHead>
                      <TableHead className="text-right">Realized P&L</TableHead>
                      <TableHead className="text-right">P&L %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos: any) => {
                      const pnl = pos.realizedPnl ? Number(pos.realizedPnl) : 0;
                      const exitPrice = pos.currentPrice ? Number(pos.currentPrice) : 0;
                      const pnlPercent = pos.realizedPnl && pos.entryPrice
                        ? ((pnl / (Number(pos.entryPrice) * Number(pos.quantity))) * 100)
                        : 0;

                      return (
                        <TableRow key={pos.id}>
                          <TableCell className="font-medium">{pos.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={pos.side === "long" ? "default" : "secondary"}>
                              {pos.side.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${Number(pos.entryPrice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${exitPrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(pos.quantity).toFixed(4)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(pos.entryTime), "MMM dd, HH:mm")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {pos.exitTime ? format(new Date(pos.exitTime), "MMM dd, HH:mm") : "N/A"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDuration(pos.entryTime, pos.exitTime)}
                          </TableCell>
                          <TableCell>{getExitReasonBadge(pos.exitReason)}</TableCell>
                          <TableCell className={`text-right font-bold ${pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                            ${pnl.toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${pnlPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No closed positions found</p>
                <p className="text-sm">Start trading to see your order history here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
