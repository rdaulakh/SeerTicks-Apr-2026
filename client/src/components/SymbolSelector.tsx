/**
 * Symbol Selector Component
 * Dropdown for switching between trading pairs (exchange + symbol combinations)
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export interface TradingPair {
  exchangeId: number;
  exchangeName: string;
  symbol: string;
  isActive: boolean;
}

interface SymbolSelectorProps {
  tradingPairs: TradingPair[];
  selectedPair: TradingPair | null;
  onSelectPair: (pair: TradingPair) => void;
  className?: string;
}

export function SymbolSelector({ tradingPairs, selectedPair, onSelectPair, className }: SymbolSelectorProps) {
  const activePairs = tradingPairs.filter(p => p.isActive);

  if (activePairs.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${className || ''}`}>
        <span className="text-sm text-muted-foreground">No active trading pairs</span>
      </div>
    );
  }

  const selectedValue = selectedPair
    ? `${selectedPair.exchangeName}-${selectedPair.symbol}`
    : undefined;

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <span className="text-sm font-medium">Trading Pair:</span>
      <Select
        value={selectedValue}
        onValueChange={(value) => {
          const [exchangeName, symbol] = value.split('-');
          const pair = activePairs.find(
            p => p.exchangeName === exchangeName && p.symbol === symbol
          );
          if (pair) {
            onSelectPair(pair);
          }
        }}
      >
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select trading pair" />
        </SelectTrigger>
        <SelectContent>
          {activePairs.map((pair) => (
            <SelectItem
              key={`${pair.exchangeName}-${pair.symbol}`}
              value={`${pair.exchangeName}-${pair.symbol}`}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {pair.exchangeName}
                </Badge>
                <span className="font-mono">{pair.symbol}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Multi-Symbol View Toggle
 * Switch between single-pair view and multi-pair grid view
 */

interface ViewToggleProps {
  view: 'single' | 'grid';
  onViewChange: (view: 'single' | 'grid') => void;
  className?: string;
}

export function ViewToggle({ view, onViewChange, className }: ViewToggleProps) {
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <button
        onClick={() => onViewChange('single')}
        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
          view === 'single'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        Single Pair
      </button>
      <button
        onClick={() => onViewChange('grid')}
        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
          view === 'grid'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        Multi-Pair Grid
      </button>
    </div>
  );
}
