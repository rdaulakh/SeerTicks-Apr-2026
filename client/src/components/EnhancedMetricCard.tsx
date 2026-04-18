/**
 * Enhanced Metric Card Component
 * 
 * Silicon Valley-level stat card with:
 * - Sparkline charts showing 24h trend
 * - Trend indicators (↑↓ arrows with % change)
 * - Number count-up animations
 * - "Last Updated" timestamps
 * - Contextual tooltips
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparklines, SparklinesLine } from 'react-sparklines';
import CountUp from 'react-countup';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface EnhancedMetricCardProps {
  title: string;
  value: number;
  previousValue?: number;
  icon: React.ReactNode;
  iconBgColor: string;
  iconColor: string;
  description?: string;
  tooltip?: string;
  sparklineData?: number[];
  lastUpdated?: Date;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  colorValue?: boolean; // If true, color value based on positive/negative
}

export default function EnhancedMetricCard({
  title,
  value,
  previousValue,
  icon,
  iconBgColor,
  iconColor,
  description,
  tooltip,
  sparklineData,
  lastUpdated,
  prefix = '',
  suffix = '',
  decimals = 2,
  colorValue = false,
}: EnhancedMetricCardProps) {
  // Calculate trend
  const trend = previousValue !== undefined ? ((value - previousValue) / Math.abs(previousValue || 1)) * 100 : 0;
  const trendDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral';
  
  // Determine value color
  const valueColor = colorValue 
    ? value >= 0 
      ? 'text-green-500' 
      : 'text-red-500'
    : '';

  // Determine trend color
  const trendColor = trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-muted-foreground';

  const cardContent = (
    <Card className="hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={`p-2 rounded-lg ${iconBgColor}`}>
          <div className={iconColor}>
            {icon}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Value with count-up animation */}
        <div className="flex items-baseline gap-2">
          <div className={`text-2xl font-bold font-mono ${valueColor}`}>
            <CountUp
              start={previousValue || 0}
              end={value}
              duration={0.5}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
              preserveValue
            />
          </div>
          
          {/* Trend indicator */}
          {previousValue !== undefined && trend !== 0 && (
            <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
              {trendDirection === 'up' && <ArrowUp className="h-3 w-3" />}
              {trendDirection === 'down' && <ArrowDown className="h-3 w-3" />}
              {trendDirection === 'neutral' && <Minus className="h-3 w-3" />}
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Sparkline chart */}
        {sparklineData && sparklineData.length > 0 && (
          <div className="h-8 -mx-2">
            <Sparklines data={sparklineData} height={32} margin={0}>
              <SparklinesLine 
                color={value >= (previousValue || 0) ? '#4ade80' : '#f87171'} 
                style={{ strokeWidth: 2, fill: 'none' }}
              />
            </Sparklines>
          </div>
        )}

        {/* Description and last updated */}
        <div className="space-y-1">
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {lastUpdated && (
            <p className="text-xs text-muted-foreground/70">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Wrap in tooltip if tooltip text provided
  if (tooltip) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          {cardContent}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return cardContent;
}
