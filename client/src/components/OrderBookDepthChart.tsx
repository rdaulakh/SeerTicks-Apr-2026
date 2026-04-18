import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { useMemo } from "react";

interface OrderBookLevel {
  price: number;
  size: number;
  total: number; // Cumulative size
}

interface OrderBookDepthChartProps {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  currentPrice: number;
  symbol: string;
}

export function OrderBookDepthChart({
  bids,
  asks,
  currentPrice,
  symbol,
}: OrderBookDepthChartProps) {
  // Calculate order book metrics
  const metrics = useMemo(() => {
    const bidVolume = bids.reduce((sum, b) => sum + b.size, 0);
    const askVolume = asks.reduce((sum, a) => sum + a.size, 0);
    const totalVolume = bidVolume + askVolume;
    const bidAskRatio = askVolume > 0 ? bidVolume / askVolume : 0;
    const imbalance = ((bidVolume - askVolume) / totalVolume) * 100;

    const spread =
      asks.length > 0 && bids.length > 0
        ? asks[0].price - bids[0].price
        : 0;
    const spreadPercent =
      currentPrice > 0 ? (spread / currentPrice) * 100 : 0;

    return {
      bidVolume,
      askVolume,
      totalVolume,
      bidAskRatio,
      imbalance,
      spread,
      spreadPercent,
    };
  }, [bids, asks, currentPrice]);

  // Normalize depths for visualization (0-100%)
  const maxTotal = Math.max(
    bids[bids.length - 1]?.total || 0,
    asks[asks.length - 1]?.total || 0
  );

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Order Book Depth
          </CardTitle>
          <Badge variant="outline" className="gap-1">
            <Activity className="h-3 w-3" />
            {symbol}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Order Book Metrics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Spread</div>
            <div className="font-medium">
              ${metrics.spread.toFixed(2)}
              <span className="text-xs text-muted-foreground ml-1">
                ({metrics.spreadPercent.toFixed(3)}%)
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Bid/Ask Ratio</div>
            <div className="font-medium">{metrics.bidAskRatio.toFixed(2)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Imbalance</div>
            <div
              className={`font-medium ${
                metrics.imbalance > 10
                  ? "text-green-600"
                  : metrics.imbalance < -10
                    ? "text-red-600"
                    : "text-yellow-600"
              }`}
            >
              {metrics.imbalance > 0 ? "+" : ""}
              {metrics.imbalance.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Depth Visualization */}
        <div className="space-y-2">
          {/* Asks (Sell Orders) */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span>Ask Depth ({metrics.askVolume.toFixed(2)} total)</span>
            </div>
            <div className="space-y-0.5">
              {asks.slice(0, 10).map((ask, idx) => (
                <div key={idx} className="relative h-6 flex items-center">
                  {/* Background bar */}
                  <div
                    className="absolute inset-0 bg-red-500/10 rounded"
                    style={{
                      width: `${(ask.total / maxTotal) * 100}%`,
                    }}
                  />
                  {/* Price and size */}
                  <div className="relative z-10 flex items-center justify-between w-full px-2 text-xs">
                    <span className="font-mono text-red-600">
                      ${ask.price.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">
                      {ask.size.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Current Price Divider */}
          <div className="flex items-center gap-2 py-1 border-y border-border/40">
            <div className="text-sm font-semibold">
              ${currentPrice.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">Current Price</div>
          </div>

          {/* Bids (Buy Orders) */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span>Bid Depth ({metrics.bidVolume.toFixed(2)} total)</span>
            </div>
            <div className="space-y-0.5">
              {bids.slice(0, 10).map((bid, idx) => (
                <div key={idx} className="relative h-6 flex items-center">
                  {/* Background bar */}
                  <div
                    className="absolute inset-0 bg-green-500/10 rounded"
                    style={{
                      width: `${(bid.total / maxTotal) * 100}%`,
                    }}
                  />
                  {/* Price and size */}
                  <div className="relative z-10 flex items-center justify-between w-full px-2 text-xs">
                    <span className="font-mono text-green-600">
                      ${bid.price.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">
                      {bid.size.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order Book Imbalance Indicator */}
        <div className="pt-2 border-t border-border/40">
          <div className="text-xs text-muted-foreground mb-2">
            Market Pressure:
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden flex">
            <div
              className="bg-green-500 transition-all"
              style={{
                width: `${((metrics.bidVolume / metrics.totalVolume) * 100).toFixed(1)}%`,
              }}
            />
            <div
              className="bg-red-500 transition-all"
              style={{
                width: `${((metrics.askVolume / metrics.totalVolume) * 100).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
            <span className="text-green-600">
              {((metrics.bidVolume / metrics.totalVolume) * 100).toFixed(1)}%
              Bids
            </span>
            <span className="text-red-600">
              {((metrics.askVolume / metrics.totalVolume) * 100).toFixed(1)}%
              Asks
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
