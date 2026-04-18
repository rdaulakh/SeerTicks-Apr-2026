import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Activity, Target, BarChart3, Settings, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function Signals() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC-USD");
  const [timeRange, setTimeRange] = useState("24");

  // Queries
  const { data: recentSignals, refetch: refetchRecent } = trpc.tradingSignals.getRecentSignals.useQuery(
    { limit: 50 },
    { refetchInterval: 10000 }
  );

  const { data: signalStats } = trpc.tradingSignals.getSignalStats.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const { data: currentIndicators } = trpc.tradingSignals.getCurrentIndicators.useQuery(
    { symbol: selectedSymbol },
    { refetchInterval: 5000 }
  );

  const { data: unexecutedSignals } = trpc.tradingSignals.getUnexecutedSignals.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // Mutations
  const generateSignals = trpc.tradingSignals.generateSignals.useMutation({
    onSuccess: (data) => {
      toast.success(`Generated ${data.count} signals for ${selectedSymbol}`);
      refetchRecent();
    },
    onError: (error) => {
      toast.error(`Failed to generate signals: ${error.message}`);
    },
  });

  const handleGenerateSignals = () => {
    generateSignals.mutate({ symbol: selectedSymbol, saveToDb: true });
  };

  const getSignalBadgeColor = (type: string) => {
    switch (type) {
      case "BUY":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "SELL":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case "RSI":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "MACD":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "STOCHASTIC":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "COMBINED":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Trading Signals</h1>
            <p className="text-muted-foreground mt-1">
              Automated signals based on technical indicators
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTC-USD">BTC-USD</SelectItem>
                <SelectItem value="ETH-USD">ETH-USD</SelectItem>
                <SelectItem value="SOL-USD">SOL-USD</SelectItem>
                <SelectItem value="DOGE-USD">DOGE-USD</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleGenerateSignals} disabled={generateSignals.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${generateSignals.isPending ? 'animate-spin' : ''}`} />
              Generate Signals
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Signals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{signalStats?.total || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {signalStats?.executed || 0} executed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Buy Signals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <div className="text-2xl font-bold text-green-500">{signalStats?.byType.BUY || 0}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Sell Signals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-500" />
                <div className="text-2xl font-bold text-red-500">{signalStats?.byType.SELL || 0}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <div className="text-2xl font-bold text-blue-500">{unexecutedSignals?.length || 0}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Current Indicators */}
        {currentIndicators && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Current Indicators - {selectedSymbol}
              </CardTitle>
              <CardDescription>Real-time technical indicator values</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">RSI (14)</p>
                  <p className="text-2xl font-bold">
                    {currentIndicators.rsi.toFixed(2)}
                  </p>
                  <Badge variant="outline" className={
                    currentIndicators.rsi < 30 ? "border-green-500 text-green-500" :
                    currentIndicators.rsi > 70 ? "border-red-500 text-red-500" :
                    "border-gray-500 text-gray-500"
                  }>
                    {currentIndicators.rsi < 30 ? "Oversold" :
                     currentIndicators.rsi > 70 ? "Overbought" : "Neutral"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">MACD</p>
                  <p className="text-2xl font-bold">
                    {currentIndicators.macd.histogram.toFixed(4)}
                  </p>
                  <Badge variant="outline" className={
                    currentIndicators.macd.histogram > 0 ? "border-green-500 text-green-500" :
                    "border-red-500 text-red-500"
                  }>
                    {currentIndicators.macd.histogram > 0 ? "Bullish" : "Bearish"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Stochastic %K</p>
                  <p className="text-2xl font-bold">
                    {currentIndicators.stochastic.k.toFixed(2)}
                  </p>
                  <Badge variant="outline" className={
                    currentIndicators.stochastic.k < 20 ? "border-green-500 text-green-500" :
                    currentIndicators.stochastic.k > 80 ? "border-red-500 text-red-500" :
                    "border-gray-500 text-gray-500"
                  }>
                    {currentIndicators.stochastic.k < 20 ? "Oversold" :
                     currentIndicators.stochastic.k > 80 ? "Overbought" : "Neutral"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">ATR (14)</p>
                  <p className="text-2xl font-bold">
                    {currentIndicators.atr.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">Volatility</p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Fibonacci</p>
                  <p className="text-lg font-bold">
                    {currentIndicators.fibonacci.direction === 'uptrend' ? '📈 Uptrend' : '📉 Downtrend'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {currentIndicators.fibonacci.levels['50%'].toFixed(2)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Signals Table */}
        <Card>
          <CardHeader>
            <CardTitle>Signal History</CardTitle>
            <CardDescription>Recent trading signals from all indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All Signals</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="executed">Executed</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Strength</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Reasoning</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentSignals && recentSignals.length > 0 ? (
                        recentSignals.map((signal) => (
                          <TableRow key={signal.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(signal.timestamp)}
                            </TableCell>
                            <TableCell className="font-medium">{signal.symbol}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSignalBadgeColor(signal.signalType)}>
                                {signal.signalType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSourceBadgeColor(signal.source)}>
                                {signal.source}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                  <div
                                    className="bg-blue-500 h-2 rounded-full"
                                    style={{ width: `${signal.strength}%` }}
                                  />
                                </div>
                                <span className="text-xs">{signal.strength}%</span>
                              </div>
                            </TableCell>
                            <TableCell>{signal.confidence}%</TableCell>
                            <TableCell>${parseFloat(signal.price).toFixed(2)}</TableCell>
                            <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                              {signal.reasoning}
                            </TableCell>
                            <TableCell>
                              {signal.executed ? (
                                <Badge variant="outline" className="border-green-500 text-green-500">
                                  Executed
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                                  Pending
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                            No signals yet. Generate signals to get started.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="pending" className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Strength</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Reasoning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unexecutedSignals && unexecutedSignals.length > 0 ? (
                        unexecutedSignals.map((signal) => (
                          <TableRow key={signal.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(signal.timestamp)}
                            </TableCell>
                            <TableCell className="font-medium">{signal.symbol}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSignalBadgeColor(signal.signalType)}>
                                {signal.signalType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSourceBadgeColor(signal.source)}>
                                {signal.source}
                              </Badge>
                            </TableCell>
                            <TableCell>{signal.strength}%</TableCell>
                            <TableCell>${parseFloat(signal.price).toFixed(2)}</TableCell>
                            <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                              {signal.reasoning}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No pending signals
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="executed" className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Executed At</TableHead>
                        <TableHead>Trade ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentSignals?.filter(s => s.executed).length ? (
                        recentSignals.filter(s => s.executed).map((signal) => (
                          <TableRow key={signal.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatTimestamp(signal.timestamp)}
                            </TableCell>
                            <TableCell className="font-medium">{signal.symbol}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSignalBadgeColor(signal.signalType)}>
                                {signal.signalType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getSourceBadgeColor(signal.source)}>
                                {signal.source}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {signal.executedAt ? formatTimestamp(signal.executedAt) : '-'}
                            </TableCell>
                            <TableCell>{signal.tradeId || '-'}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No executed signals
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
