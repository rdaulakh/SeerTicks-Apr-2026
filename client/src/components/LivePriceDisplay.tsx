/**
 * LivePriceDisplay - Real-Time Price Display Component
 * 
 * Displays live prices with:
 * - Flash animations on price changes
 * - Direction indicators (up/down arrows)
 * - Pulse animation for live indicator
 * - Smooth transitions between price updates
 */

import { memo, useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LivePriceDisplayProps {
  price: number;
  previousPrice?: number;
  direction?: 'up' | 'down' | 'neutral';
  priceFlash?: 'up' | 'down';
  showLiveIndicator?: boolean;
  className?: string;
  formatPrice?: (price: number) => string;
  size?: 'sm' | 'md' | 'lg';
}

const defaultFormatPrice = (price: number) => {
  const decimals = price < 1 ? 6 : price < 100 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(price);
};

export const LivePriceDisplay = memo(function LivePriceDisplay({
  price,
  previousPrice,
  direction = 'neutral',
  priceFlash,
  showLiveIndicator = true,
  className,
  formatPrice = defaultFormatPrice,
  size = 'md',
}: LivePriceDisplayProps) {
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashDirection, setFlashDirection] = useState<'up' | 'down' | null>(null);

  // Handle flash animation
  useEffect(() => {
    if (priceFlash) {
      setIsFlashing(true);
      setFlashDirection(priceFlash);
      const timer = setTimeout(() => {
        setIsFlashing(false);
        setFlashDirection(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [priceFlash, price]);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div className={cn('relative', className)}>
      {/* Live indicator */}
      {showLiveIndicator && (
        <div className="flex items-center gap-1 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-green-400 font-semibold uppercase tracking-wider">
            Live
          </span>
        </div>
      )}
      
      {/* Price display */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'font-mono font-semibold text-white transition-colors duration-150',
            sizeClasses[size],
            isFlashing && flashDirection === 'up' && 'text-green-400',
            isFlashing && flashDirection === 'down' && 'text-red-400',
          )}
          style={{
            animation: isFlashing 
              ? `priceFlash${flashDirection === 'up' ? 'Green' : 'Red'} 0.3s ease-out` 
              : undefined,
          }}
        >
          {formatPrice(price)}
        </span>
        
        {/* Direction indicator */}
        {direction === 'up' && (
          <ArrowUpRight className={cn(iconSizes[size], 'text-green-400 animate-bounce')} />
        )}
        {direction === 'down' && (
          <ArrowDownRight className={cn(iconSizes[size], 'text-red-400 animate-bounce')} />
        )}
        {direction === 'neutral' && (
          <Minus className={cn(iconSizes[size], 'text-gray-500')} />
        )}
      </div>
      
      {/* Previous price (optional) */}
      {previousPrice !== undefined && previousPrice !== price && (
        <div className="text-xs text-gray-500 mt-0.5">
          was {formatPrice(previousPrice)}
        </div>
      )}
    </div>
  );
});

/**
 * LivePnLDisplay - Real-Time P&L Display Component
 */
interface LivePnLDisplayProps {
  pnl: number;
  pnlPercent: number;
  priceFlash?: 'up' | 'down';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showPercent?: boolean;
}

export const LivePnLDisplay = memo(function LivePnLDisplay({
  pnl,
  pnlPercent,
  priceFlash,
  className,
  size = 'md',
  showPercent = true,
}: LivePnLDisplayProps) {
  const [isFlashing, setIsFlashing] = useState(false);
  const isProfit = pnl >= 0;

  useEffect(() => {
    if (priceFlash) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 300);
      return () => clearTimeout(timer);
    }
  }, [priceFlash, pnl]);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className={cn('text-right', className)}>
      <div className="flex items-center justify-end gap-2">
        {isProfit ? (
          <ArrowUpRight className={cn(
            size === 'lg' ? 'w-5 h-5' : 'w-4 h-4',
            'text-green-400',
            isFlashing && 'animate-bounce'
          )} />
        ) : (
          <ArrowDownRight className={cn(
            size === 'lg' ? 'w-5 h-5' : 'w-4 h-4',
            'text-red-400',
            isFlashing && 'animate-bounce'
          )} />
        )}
        <span
          className={cn(
            'font-mono font-bold transition-all duration-150',
            sizeClasses[size],
            isProfit ? 'text-green-400' : 'text-red-400',
            isFlashing && (isProfit ? 'scale-110' : 'scale-110'),
          )}
        >
          {isProfit ? '+' : ''}{formatCurrency(pnl)}
        </span>
      </div>
      
      {showPercent && (
        <span className={cn(
          'text-sm font-mono',
          isProfit ? 'text-green-500/70' : 'text-red-500/70'
        )}>
          {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

/**
 * LiveValueCard - Card displaying a live updating value
 */
interface LiveValueCardProps {
  label: string;
  value: number;
  previousValue?: number;
  formatValue?: (value: number) => string;
  icon?: React.ReactNode;
  priceFlash?: 'up' | 'down';
  colorByValue?: boolean; // Color green/red based on positive/negative
  className?: string;
}

export const LiveValueCard = memo(function LiveValueCard({
  label,
  value,
  previousValue,
  formatValue = defaultFormatPrice,
  icon,
  priceFlash,
  colorByValue = false,
  className,
}: LiveValueCardProps) {
  const [isFlashing, setIsFlashing] = useState(false);
  const isPositive = value >= 0;

  useEffect(() => {
    if (priceFlash) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 300);
      return () => clearTimeout(timer);
    }
  }, [priceFlash, value]);

  return (
    <div className={cn(
      'bg-gray-800/50 rounded-xl p-4 relative overflow-hidden transition-all duration-150',
      isFlashing && priceFlash === 'up' && 'ring-1 ring-green-500/50',
      isFlashing && priceFlash === 'down' && 'ring-1 ring-red-500/50',
      className
    )}>
      {/* Flash overlay */}
      {isFlashing && (
        <div className={cn(
          'absolute inset-0 opacity-20 transition-opacity duration-300',
          priceFlash === 'up' ? 'bg-green-500' : 'bg-red-500'
        )} />
      )}
      
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <p className="text-xs text-gray-500">{label}</p>
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        </div>
        <p className={cn(
          'text-lg font-mono font-semibold transition-colors duration-150',
          colorByValue 
            ? (isPositive ? 'text-green-400' : 'text-red-400')
            : 'text-white',
          isFlashing && priceFlash === 'up' && 'text-green-400',
          isFlashing && priceFlash === 'down' && 'text-red-400',
        )}>
          {colorByValue && isPositive && value !== 0 ? '+' : ''}
          {formatValue(value)}
        </p>
        
        {previousValue !== undefined && previousValue !== value && (
          <p className="text-xs text-gray-500 mt-0.5">
            was {formatValue(previousValue)}
          </p>
        )}
      </div>
    </div>
  );
});
