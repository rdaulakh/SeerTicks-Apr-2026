import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type DateRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

const getDateRangeFilter = (range: DateRange) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (range) {
    case "1D":
      return { startDate: today.toISOString(), endDate: now.toISOString() };
    case "1W":
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { startDate: weekAgo.toISOString(), endDate: now.toISOString() };
    case "1M":
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return { startDate: monthAgo.toISOString(), endDate: now.toISOString() };
    case "3M":
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return { startDate: threeMonthsAgo.toISOString(), endDate: now.toISOString() };
    case "6M":
      const sixMonthsAgo = new Date(today);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return { startDate: sixMonthsAgo.toISOString(), endDate: now.toISOString() };
    case "1Y":
      const yearAgo = new Date(today);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      return { startDate: yearAgo.toISOString(), endDate: now.toISOString() };
    case "ALL":
      return {};
    default:
      return {};
  }
};

export default function PnLChart() {
  const [selectedRange, setSelectedRange] = useState<DateRange>("1M");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("all");

  const dateFilter = useMemo(() => getDateRangeFilter(selectedRange), [selectedRange]);
  
  // Fetch available strategies
  const { data: strategies } = trpc.pnlChart.getStrategies.useQuery();
  
  // Fetch strategy breakdown
  const { data: strategyBreakdown } = trpc.pnlChart.getStrategyBreakdown.useQuery(dateFilter);

  const { data: pnlData, isLoading } = trpc.pnlChart.getDateWisePnl.useQuery(
    { ...dateFilter, strategy: selectedStrategy !== "all" ? selectedStrategy : undefined },
    { refetchInterval: 30000 }
  );

  const { data: dailyTrades } = trpc.pnlChart.getTradesByDate.useQuery(
    { 
      date: selectedDate || "",
      strategy: selectedStrategy !== "all" ? selectedStrategy : undefined 
    },
    { enabled: !!selectedDate }
  );

  const ranges: DateRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "ALL"];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const chartData = pnlData?.data || [];
  const summary = pnlData?.summary || {
    totalTrades: 0,
    totalWins: 0,
    totalLosses: 0,
    totalPnl: 0,
    totalCommission: 0,
  };

  const overallWinRate = summary.totalTrades > 0
    ? ((summary.totalWins / summary.totalTrades) * 100).toFixed(2)
    : "0.00";

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total P&L</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
              {summary.totalPnl >= 0 ? "+" : ""}${summary.totalPnl.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Trades</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalTrades}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Win Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{overallWinRate}%</div>
            <div className="text-xs text-muted-foreground mt-1">
              {summary.totalWins}W / {summary.totalLosses}L
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Commission</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              ${summary.totalCommission.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net P&L</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
              {summary.totalPnl >= 0 ? <TrendingUp className="inline h-5 w-5 mr-1" /> : <TrendingDown className="inline h-5 w-5 mr-1" />}
              ${summary.totalPnl.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strategy Breakdown Cards */}
      {strategyBreakdown && strategyBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Strategy Performance Breakdown</CardTitle>
            <CardDescription>Compare performance across different trading strategies</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {strategyBreakdown.map((stat) => (
                <Card key={stat.strategy} className="border-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {stat.strategy.replace(/_/g, ' ').toUpperCase()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Net P&L:</span>
                      <span className={`font-bold ${stat.netPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {stat.netPnl >= 0 ? '+' : ''}${stat.netPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Trades:</span>
                      <span className="font-medium">{stat.totalTrades}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Win Rate:</span>
                      <span className="font-medium text-blue-600">{stat.winRate}%</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">{stat.winCount}W / {stat.lossCount}L</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Range Selector */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cumulative P&L Chart</CardTitle>
              <CardDescription>Track your profit and loss trends over time</CardDescription>
            </div>
            <div className="flex gap-2 items-center">
              {/* Strategy Filter */}
              {strategies && strategies.length > 0 && (
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Strategies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Strategies</SelectItem>
                      {strategies.map((strategy) => (
                        <SelectItem key={strategy} value={strategy}>
                          {strategy.replace(/_/g, ' ').toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Date Range Buttons */}
              {ranges.map((range) => (
                <Button
                  key={range}
                  variant={selectedRange === range ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedRange(range)}
                >
                  {range}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-96 text-muted-foreground">
              No trading data available for the selected period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart
                data={chartData}
                onClick={(data) => {
                  if (data?.activeLabel) {
                    setSelectedDate(data.activeLabel);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold mb-2">{data.date}</p>
                          <div className="space-y-1 text-sm">
                            <p className={data.dailyPnl >= 0 ? "text-green-600" : "text-red-600"}>
                              Daily P&L: ${data.dailyPnl}
                            </p>
                            <p className="text-blue-600">
                              Cumulative P&L: ${data.cumulativePnl}
                            </p>
                            <p className="text-muted-foreground">
                              Trades: {data.tradeCount} ({data.winCount}W / {data.lossCount}L)
                            </p>
                            <p className="text-muted-foreground">
                              Win Rate: {data.winRate}%
                            </p>
                            <p className="text-orange-600">
                              Commission: ${data.totalCommission}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="dailyPnl"
                  fill="#8884d8"
                  name="Daily P&L"
                  opacity={0.6}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulativePnl"
                  stroke="#10b981"
                  strokeWidth={3}
                  name="Cumulative P&L"
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily Trades Detail */}
      {selectedDate && dailyTrades && dailyTrades.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Trades on {selectedDate}</CardTitle>
                <CardDescription>{dailyTrades.length} trades executed</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Exit Price</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Net P&L</TableHead>
                  <TableHead>P&L %</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Exit Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-medium">{trade.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={trade.side === "long" ? "default" : "secondary"}>
                        {trade.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{trade.quantity.toFixed(4)}</TableCell>
                    <TableCell>${trade.entryPrice.toFixed(2)}</TableCell>
                    <TableCell>${trade.exitPrice.toFixed(2)}</TableCell>
                    <TableCell className={trade.realizedPnl >= 0 ? "text-green-600" : "text-red-600"}>
                      ${trade.realizedPnl.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-orange-600">
                      ${trade.commission.toFixed(2)}
                    </TableCell>
                    <TableCell className={trade.netPnl >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                      ${trade.netPnl.toFixed(2)}
                    </TableCell>
                    <TableCell className={trade.pnlPercentage >= 0 ? "text-green-600" : "text-red-600"}>
                      {trade.pnlPercentage >= 0 ? "+" : ""}{trade.pnlPercentage}%
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-500">
                        {trade.strategy?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {trade.exitReason || "manual"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
