import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Fish,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Filter,
  TrendingUp,
  Wallet,
  Building2,
  Clock,
  Zap,
  AlertCircle,
  CheckCircle2,
  Activity,
} from "lucide-react";

// Blockchain explorer URLs
const EXPLORER_URLS: Record<string, string> = {
  bitcoin: "https://blockchain.com/btc/tx/",
  ethereum: "https://etherscan.io/tx/",
  tron: "https://tronscan.org/#/transaction/",
  ripple: "https://xrpscan.com/tx/",
  binancechain: "https://bscscan.com/tx/",
  solana: "https://solscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
};

// Blockchain colors
const BLOCKCHAIN_COLORS: Record<string, string> = {
  bitcoin: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ethereum: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  tron: "bg-red-500/20 text-red-400 border-red-500/30",
  ripple: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  binancechain: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  solana: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  polygon: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  avalanche: "bg-red-600/20 text-red-400 border-red-600/30",
  arbitrum: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  optimism: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Transaction type icons
const TYPE_ICONS: Record<string, React.ReactNode> = {
  transfer: <ArrowUpRight className="h-4 w-4" />,
  mint: <TrendingUp className="h-4 w-4 text-green-400" />,
  burn: <ArrowDownRight className="h-4 w-4 text-red-400" />,
  lock: <Building2 className="h-4 w-4 text-yellow-400" />,
  unlock: <Wallet className="h-4 w-4 text-blue-400" />,
};

interface WhaleAlert {
  id: string;
  blockchain: string;
  symbol: string;
  type: string;
  amount: string;
  amountUsd: string;
  from: string;
  to: string;
  fromOwner: string;
  toOwner: string;
  timestamp: Date;
  hash: string;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function AlertCard({ alert }: { alert: WhaleAlert }) {
  const explorerUrl = EXPLORER_URLS[alert.blockchain] || "";
  const blockchainColor = BLOCKCHAIN_COLORS[alert.blockchain] || "bg-gray-500/20 text-gray-400 border-gray-500/30";

  return (
    <Card className="bg-card/50 border-border/50 hover:bg-card/70 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left side - Transaction info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={blockchainColor}>
                {alert.blockchain}
              </Badge>
              <Badge variant="secondary" className="font-mono">
                {alert.symbol}
              </Badge>
              <div className="flex items-center gap-1 text-muted-foreground">
                {TYPE_ICONS[alert.type]}
                <span className="text-xs capitalize">{alert.type}</span>
              </div>
            </div>

            {/* Amount */}
            <div className="mb-3">
              <div className="text-2xl font-bold text-foreground">
                {alert.amountUsd}
              </div>
              <div className="text-sm text-muted-foreground">
                {alert.amount} {alert.symbol}
              </div>
            </div>

            {/* From/To */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground text-xs mb-1">From</div>
                <div className="font-mono text-foreground">{alert.from}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {alert.fromOwner}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">To</div>
                <div className="font-mono text-foreground">{alert.to}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {alert.toOwner}
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Time and actions */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(alert.timestamp)}
            </div>
            {explorerUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => window.open(explorerUrl + alert.hash, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View on Explorer</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertSkeleton() {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-12" />
            </div>
            <Skeleton className="h-8 w-32 mb-1" />
            <Skeleton className="h-4 w-24 mb-3" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Skeleton className="h-3 w-8 mb-1" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div>
                <Skeleton className="h-3 w-8 mb-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WhaleAlerts() {
  const [blockchain, setBlockchain] = useState<string>("");
  const [minValue, setMinValue] = useState<number>(500000);
  const [hoursBack, setHoursBack] = useState<number>(1);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch API status
  const { data: status } = trpc.whaleAlert.getStatus.useQuery();

  // Fetch supported blockchains
  const { data: blockchains } = trpc.whaleAlert.getSupportedBlockchains.useQuery();

  // Fetch live alerts
  const {
    data: alertsData,
    isLoading,
    refetch,
    isFetching,
  } = trpc.whaleAlert.getLiveAlerts.useQuery(
    {
      minValue,
      blockchain: blockchain || undefined,
      hoursBack,
      limit: 50,
    },
    {
      refetchInterval: autoRefresh ? 30000 : false, // Refresh every 30 seconds
    }
  );

  // Fetch stats
  const { data: stats } = trpc.whaleAlert.getStats.useQuery({
    hoursBack: 24,
  });

  // Format stats for display
  const formatVolume = (value: string | undefined) => {
    if (!value) return "$0";
    const num = parseFloat(value);
    if (num >= 1000000000) return `$${(num / 1000000000).toFixed(2)}B`;
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    return `$${num.toFixed(0)}`;
  };

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Fish className="h-8 w-8 text-primary" />
            Whale Alerts
          </h1>
          <p className="text-muted-foreground mt-1">
            Track large cryptocurrency transactions in real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* API Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/50 border border-border/50">
            {status?.connected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-500">Connected</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm text-red-500">Disconnected</span>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="24h Volume"
          value={formatVolume(stats?.totals?.totalUsd)}
          subtitle={`${stats?.totals?.count || 0} transactions`}
          icon={TrendingUp}
        />
        <StatsCard
          title="Avg Transaction"
          value={formatVolume(stats?.totals?.avgUsd)}
          subtitle="Per whale movement"
          icon={Fish}
        />
        <StatsCard
          title="Top Chain"
          value={stats?.volumeByBlockchain?.[0]?.blockchain || "N/A"}
          subtitle={formatVolume(stats?.volumeByBlockchain?.[0]?.totalUsd)}
          icon={Zap}
        />
        <StatsCard
          title="Top Token"
          value={stats?.volumeBySymbol?.[0]?.symbol || "N/A"}
          subtitle={formatVolume(stats?.volumeBySymbol?.[0]?.totalUsd)}
          icon={Wallet}
        />
      </div>

      {/* Filters */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Blockchain Filter */}
            <div className="space-y-2">
              <Label>Blockchain</Label>
              <Select value={blockchain} onValueChange={setBlockchain}>
                <SelectTrigger>
                  <SelectValue placeholder="All blockchains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All blockchains</SelectItem>
                  {blockchains?.map((chain) => (
                    <SelectItem key={chain} value={chain}>
                      {chain.charAt(0).toUpperCase() + chain.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Min Value Filter */}
            <div className="space-y-2">
              <Label>Min Value (USD)</Label>
              <Select
                value={minValue.toString()}
                onValueChange={(v) => setMinValue(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100000">$100K+</SelectItem>
                  <SelectItem value="500000">$500K+</SelectItem>
                  <SelectItem value="1000000">$1M+</SelectItem>
                  <SelectItem value="5000000">$5M+</SelectItem>
                  <SelectItem value="10000000">$10M+</SelectItem>
                  <SelectItem value="50000000">$50M+</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Range Filter */}
            <div className="space-y-2">
              <Label>Time Range</Label>
              <Select
                value={hoursBack.toString()}
                onValueChange={(v) => setHoursBack(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 1 hour</SelectItem>
                  <SelectItem value="6">Last 6 hours</SelectItem>
                  <SelectItem value="12">Last 12 hours</SelectItem>
                  <SelectItem value="24">Last 24 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Auto Refresh Toggle */}
            <div className="space-y-2">
              <Label>Auto Refresh</Label>
              <Button
                variant={autoRefresh ? "default" : "outline"}
                className="w-full"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`} />
                {autoRefresh ? "On (30s)" : "Off"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts Feed */}
      <Tabs defaultValue="live" className="space-y-4">
        <TabsList>
          <TabsTrigger value="live">Live Feed</TabsTrigger>
          <TabsTrigger value="correlation">
            <Activity className="h-4 w-4 mr-1" />
            Signal Correlation
          </TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <AlertSkeleton key={i} />
              ))}
            </div>
          ) : alertsData?.alerts && alertsData.alerts.length > 0 ? (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                {alertsData.alerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-12 text-center">
                <Fish className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No whale alerts found</h3>
                <p className="text-muted-foreground">
                  {alertsData?.error
                    ? alertsData.error
                    : "Try adjusting your filters or check back later"}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="correlation" className="space-y-4">
          <div className="text-center text-muted-foreground py-8">Correlation analysis coming soon</div>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Volume by Blockchain */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle>Volume by Blockchain (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats?.volumeByBlockchain?.slice(0, 8).map((item) => (
                    <div key={item.blockchain} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={BLOCKCHAIN_COLORS[item.blockchain] || ""}
                        >
                          {item.blockchain}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {item.count} txns
                        </span>
                      </div>
                      <span className="font-mono font-semibold">
                        {formatVolume(item.totalUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Volume by Token */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle>Top Tokens by Volume (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats?.volumeBySymbol?.map((item) => (
                    <div key={item.symbol} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {item.symbol}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {item.count} txns
                        </span>
                      </div>
                      <span className="font-mono font-semibold">
                        {formatVolume(item.totalUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Transaction Types */}
            <Card className="bg-card/50 border-border/50 md:col-span-2">
              <CardHeader>
                <CardTitle>Transaction Types (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {stats?.byType?.map((item) => (
                    <div
                      key={item.type}
                      className="p-4 rounded-lg bg-background/50 border border-border/50 text-center"
                    >
                      <div className="flex justify-center mb-2">
                        {TYPE_ICONS[item.type]}
                      </div>
                      <div className="text-sm text-muted-foreground capitalize mb-1">
                        {item.type}
                      </div>
                      <div className="font-semibold">{formatVolume(item.totalUsd)}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.count} transactions
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
