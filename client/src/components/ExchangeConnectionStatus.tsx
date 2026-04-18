/**
 * Exchange Connection Status Component
 * Displays connected exchanges and active trading symbols
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Globe, 
  Coins,
  AlertCircle,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export function ExchangeConnectionStatus() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Fetch exchanges with error handling
  const { data: exchanges, isLoading: exchangesLoading, refetch: refetchExchanges, error: exchangesError } = trpc.settings.getExchanges.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
  });
  
  // Fetch trading symbols with error handling
  const { data: symbols, isLoading: symbolsLoading, refetch: refetchSymbols, error: symbolsError } = trpc.settings.getSymbols.useQuery(undefined, {
    retry: 1,
    retryDelay: 1000,
  });
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchExchanges(), refetchSymbols()]);
      toast.success("Refreshed exchange status");
    } catch (error) {
      toast.error("Failed to refresh status");
    } finally {
      setIsRefreshing(false);
    }
  };

  const isLoading = exchangesLoading || symbolsLoading;
  const hasError = exchangesError || symbolsError;
  const hasExchanges = exchanges && exchanges.length > 0;
  const hasSymbols = symbols && symbols.length > 0;
  const activeSymbols = symbols?.filter(s => s.isActive) || [];

  // Show error state if queries failed
  if (hasError && !isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Exchange Connection
              </CardTitle>
              <CardDescription className="text-red-500">Failed to load connection status</CardDescription>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="w-5 h-5 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-500">Connection Error</p>
              <p className="text-xs text-muted-foreground">Click refresh to try again</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Exchange Connection
          </CardTitle>
          <CardDescription>Loading connection status...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Exchange Connection
            </CardTitle>
            <CardDescription>Connected exchanges and trading symbols</CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Exchanges Section */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            Connected Exchanges
          </h4>
          
          {!hasExchanges ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertCircle className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-sm font-medium text-yellow-500">No exchanges connected</p>
                <p className="text-xs text-muted-foreground">Use the Exchange Configuration wizard below to connect an exchange</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {exchanges.map((exchange) => (
                <div 
                  key={exchange.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                >
                  <div className="flex items-center gap-3">
                    {exchange.connectionStatus === 'connected' ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium capitalize">{exchange.exchangeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {exchange.connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={exchange.isActive ? 'default' : 'secondary'}>
                    {exchange.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Symbols Section */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Coins className="w-4 h-4 text-muted-foreground" />
            Trading Symbols ({activeSymbols.length} active)
          </h4>
          
          {!hasSymbols ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border">
              <AlertCircle className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">No trading symbols configured</p>
                <p className="text-xs text-muted-foreground">Add symbols during exchange setup</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {symbols.map((symbol) => (
                <Badge 
                  key={symbol.id}
                  variant={symbol.isActive ? 'default' : 'outline'}
                  className={symbol.isActive ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}
                >
                  {symbol.symbol}
                  {symbol.isActive && (
                    <CheckCircle className="w-3 h-3 ml-1" />
                  )}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        {(hasExchanges || hasSymbols) && (
          <div className="pt-4 border-t">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{exchanges?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Exchanges</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{activeSymbols.length}</p>
                <p className="text-xs text-muted-foreground">Active Symbols</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
