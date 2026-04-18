/**
 * MetricCardSkeleton - Animated loading skeleton for metric cards
 * 
 * Provides consistent loading states across Dashboard, Positions, and Performance pages.
 * Prevents $0 flash by showing skeleton while data initializes.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardSkeletonProps {
  className?: string;
  variant?: 'default' | 'glass' | 'gradient';
}

export function MetricCardSkeleton({ 
  className,
  variant = 'default' 
}: MetricCardSkeletonProps) {
  const baseClasses = {
    default: "bg-gray-900/50 border-gray-700/50",
    glass: "glass-card border-slate-800/50",
    gradient: "bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700/50",
  };

  return (
    <Card className={cn(
      "p-4 relative overflow-hidden",
      baseClasses[variant],
      className
    )}>
      {/* Shimmer effect overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      
      <div className="relative space-y-3">
        {/* Label and icon row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20 bg-gray-700/50" />
          <Skeleton className="h-4 w-4 rounded bg-gray-700/50" />
        </div>
        
        {/* Value */}
        <Skeleton className="h-7 w-28 bg-gray-700/60" />
        
        {/* Subtext */}
        <Skeleton className="h-3 w-16 bg-gray-700/30" />
      </div>
    </Card>
  );
}

interface MetricGridSkeletonProps {
  count?: number;
  columns?: 2 | 4 | 6;
  variant?: 'default' | 'glass' | 'gradient';
}

export function MetricGridSkeleton({ 
  count = 4, 
  columns = 4,
  variant = 'default' 
}: MetricGridSkeletonProps) {
  const gridClasses = {
    2: "grid-cols-2",
    4: "grid-cols-2 md:grid-cols-4",
    6: "grid-cols-2 md:grid-cols-4 lg:grid-cols-6",
  };

  return (
    <div className={cn("grid gap-4", gridClasses[columns])}>
      {Array.from({ length: count }).map((_, i) => (
        <MetricCardSkeleton key={i} variant={variant} />
      ))}
    </div>
  );
}

// Add shimmer animation to global CSS
// @keyframes shimmer {
//   100% { transform: translateX(100%); }
// }
