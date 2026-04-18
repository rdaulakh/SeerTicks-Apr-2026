/**
 * Multi-Pair Grid Component
 * Displays all active trading pairs in a grid layout with real-time data
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";

export interface AgentSignal {
  agentName: string;
  signal: string;
  confidence: number;
  timestamp?: number;
}

export interface PairData {
  exchangeId: number;
  exchangeName: string;
  symbol: string;
  status: 'active' | 'idle' | 'error';
  currentPrice?: number;
  priceChange24h?: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  activePositions: number;
  pnl: number;
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  lastUpdate: number;
  agentSignals?: AgentSignal[];
}

interface MultiPairGridProps {
  pairs: PairData[];
  onSelectPair: (exchangeId: number, symbol: string) => void;
}

export function MultiPairGrid({ pairs, onSelectPair }: MultiPairGridProps) {
  if (pairs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No active trading pairs</p>
          <p className="text-sm mt-2">Configure exchanges and symbols in Settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {pairs.map((pair) => (
        <PairCard
          key={`${pair.exchangeName}-${pair.symbol}`}
          pair={pair}
          onClick={() => onSelectPair(pair.exchangeId, pair.symbol)}
        />
      ))}
    </div>
  );
}

interface PairCardProps {
  pair: PairData;
  onClick: () => void;
}

function PairCard({ pair, onClick }: PairCardProps) {
  const signalColor = {
    bullish: 'text-green-500',
    bearish: 'text-red-500',
    neutral: 'text-gray-500',
  }[pair.signal];

  const SignalIcon = {
    bullish: TrendingUp,
    bearish: TrendingDown,
    neutral: Minus,
  }[pair.signal];

  const pnlColor = pair.pnl >= 0 ? 'text-green-500' : 'text-red-500';
  const pnlSign = pair.pnl >= 0 ? '+' : '';

  const recommendationColor = {
    BUY: 'bg-green-500/20 text-green-500 border-green-500/50',
    SELL: 'bg-red-500/20 text-red-500 border-red-500/50',
    HOLD: 'bg-gray-500/20 text-gray-500 border-gray-500/50',
  }[pair.recommendation];

  const statusColor = {
    active: 'bg-green-500',
    idle: 'bg-gray-500',
    error: 'bg-red-500',
  }[pair.status];

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-all"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg font-mono">{pair.symbol}</CardTitle>
            <Badge variant="outline" className="mt-1 text-xs">
              {pair.exchangeName}
            </Badge>
          </div>
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Price */}
        {pair.currentPrice && (
          <div>
            <div className="text-2xl font-bold">
              ${pair.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {pair.priceChange24h !== undefined && (
              <div className={`text-sm ${pair.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {pair.priceChange24h >= 0 ? '+' : ''}{pair.priceChange24h.toFixed(2)}% (24h)
              </div>
            )}
          </div>
        )}

        {/* Signal */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SignalIcon className={`w-4 h-4 ${signalColor}`} />
            <span className={`text-sm font-medium ${signalColor}`}>
              {pair.signal.toUpperCase()}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            {pair.confidence.toFixed(0)}%
          </span>
        </div>

        {/* Agent Signals Breakdown */}
        {pair.agentSignals && pair.agentSignals.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium">Agent Signals ({pair.agentSignals.length})</div>
            <div className="space-y-0.5">
              {pair.agentSignals.filter((s: AgentSignal) => s.confidence > 0).slice(0, 4).map((s: AgentSignal, i: number) => {
                const agentSignalColor = s.signal === 'bullish' || s.signal === 'buy' ? 'text-green-400' : s.signal === 'bearish' || s.signal === 'sell' ? 'text-red-400' : 'text-gray-400';
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[120px]">{s.agentName}</span>
                    <div className="flex items-center gap-1">
                      <span className={agentSignalColor}>{(s.signal || 'neutral').toUpperCase()}</span>
                      <span className="text-muted-foreground">{Math.round((s.confidence || 0) * 100)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommendation */}
        <Badge className={`w-full justify-center ${recommendationColor}`}>
          {pair.recommendation}
        </Badge>

        {/* Positions & P&L */}
        <div className="flex items-center justify-between text-sm pt-2 border-t">
          <div>
            <span className="text-muted-foreground">Positions:</span>
            <span className="ml-1 font-medium">{pair.activePositions}</span>
          </div>
          <div className={`font-medium ${pnlColor}`}>
            {pnlSign}${Math.abs(pair.pnl).toFixed(2)}
          </div>
        </div>

        {/* Last Update */}
        <div className="text-xs text-muted-foreground text-center">
          Updated {formatTimestamp(pair.lastUpdate)}
        </div>
      </CardContent>
    </Card>
  );
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}
