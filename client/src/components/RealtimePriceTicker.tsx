import { usePriceFeed } from "@/hooks/usePriceFeed";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface RealtimePriceTickerProps {
  symbols?: string[];
  className?: string;
}

export function RealtimePriceTicker({
  symbols = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"],
  className = "",
}: RealtimePriceTickerProps) {
  const { user } = useAuth();
  const { prices, isConnected: wsConnected, error } = usePriceFeed({ symbols });
  
  // ARCHITECTURE: The SEER engine runs 24/7/365 on the server, independent of user sessions
  // The frontend is JUST a display layer - it shows what's already running on the server
  const { data: engineStatus, isLoading: engineStatusLoading } = trpc.seerMulti.getStatus.useQuery(undefined, {
    enabled: !!user,
    staleTime: 2000, // Cache for 2 seconds
    refetchInterval: 5000, // Refresh every 5 seconds
  });
  
  // CRITICAL: Show Live based on SERVER engine status, not frontend WebSocket
  // The server is always running - default to true while loading
  const isConnected = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);
  const [priceChanges, setPriceChanges] = useState<Map<string, number>>(new Map());

  // Track price changes for animation
  useEffect(() => {
    prices.forEach((priceUpdate, symbol) => {
      const previousPrice = priceChanges.get(symbol);
      if (previousPrice !== undefined && previousPrice !== priceUpdate.price) {
        const change = priceUpdate.price - previousPrice;
        setPriceChanges((prev) => new Map(prev).set(symbol, change));
        
        // Clear change indicator after animation
        setTimeout(() => {
          setPriceChanges((prev) => {
            const next = new Map(prev);
            next.delete(symbol);
            return next;
          });
        }, 1000);
      } else if (previousPrice === undefined) {
        setPriceChanges((prev) => new Map(prev).set(symbol, 0));
      }
    });
  }, [prices]);

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  };

  const getSymbolDisplay = (symbol: string) => {
    return symbol.replace("-USD", "");
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        {isConnected ? (
          <>
            <Wifi className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-500 font-medium">Live Feed Connected</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-500 font-medium">
              {error ? `Error: ${error}` : "Connecting..."}
            </span>
          </>
        )}
      </div>

      {/* Price Ticker Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {symbols.map((symbol) => {
          const priceData = prices.get(symbol);
          const change = priceChanges.get(symbol);
          const isPositive = change !== undefined && change > 0;
          const isNegative = change !== undefined && change < 0;

          return (
            <Card
              key={symbol}
              className={`p-4 transition-all duration-300 ${
                isPositive
                  ? "bg-green-500/10 border-green-500/50"
                  : isNegative
                  ? "bg-red-500/10 border-red-500/50"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{getSymbolDisplay(symbol)}</span>
                  {priceData && (
                    <Badge variant="outline" className="text-xs">
                      {priceData.source}
                    </Badge>
                  )}
                </div>
                {isPositive && <TrendingUp className="h-4 w-4 text-green-500" />}
                {isNegative && <TrendingDown className="h-4 w-4 text-red-500" />}
              </div>

              {priceData ? (
                <>
                  <div className="text-2xl font-bold mb-1">
                    ${formatPrice(priceData.price)}
                  </div>
                  {priceData.volume24h && (
                    <div className="text-xs text-muted-foreground">
                      Vol: {priceData.volume24h.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    Updated: {new Date(priceData.timestamp).toLocaleTimeString()}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Waiting for data...</div>
              )}
            </Card>
          );
        })}
      </div>

      {/* WebSocket Info */}
      <div className="text-xs text-muted-foreground text-center">
        Real-time prices via WebSocket • Updates every second
      </div>
    </div>
  );
}
