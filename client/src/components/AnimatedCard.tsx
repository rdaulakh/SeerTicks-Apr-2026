import { ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  hover?: boolean;
  glow?: boolean;
  glowColor?: "primary" | "success" | "danger" | "warning";
}

export function AnimatedCard({
  children,
  className,
  delay = 0,
  hover = true,
  glow = false,
  glowColor = "primary",
}: AnimatedCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const glowClasses = {
    primary: "glow-primary",
    success: "glow-success",
    danger: "glow-danger",
    warning: "glow-warning",
  };

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-6 transition-all duration-300",
        "animate-fadeInUp",
        hover && "hover:scale-[1.02] hover:-translate-y-1 hover:shadow-2xl",
        glow && isHovered && glowClasses[glowColor],
        className
      )}
      style={{
        animationDelay: `${delay}ms`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </div>
  );
}

interface PulseIndicatorProps {
  active?: boolean;
  color?: "green" | "red" | "blue" | "yellow";
  size?: "sm" | "md" | "lg";
}

export function PulseIndicator({
  active = true,
  color = "green",
  size = "md",
}: PulseIndicatorProps) {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };

  const colorClasses = {
    green: "bg-green-500",
    red: "bg-red-500",
    blue: "bg-blue-500",
    yellow: "bg-yellow-500",
  };

  return (
    <div className="relative flex items-center justify-center">
      <div
        className={cn(
          "rounded-full",
          sizeClasses[size],
          colorClasses[color],
          active && "animate-pulse"
        )}
      />
      {active && (
        <div
          className={cn(
            "absolute rounded-full opacity-75 animate-ping",
            sizeClasses[size],
            colorClasses[color]
          )}
        />
      )}
    </div>
  );
}

interface ShimmerTextProps {
  children: ReactNode;
  className?: string;
}

export function ShimmerText({ children, className }: ShimmerTextProps) {
  return (
    <div
      className={cn(
        "relative inline-block bg-gradient-to-r from-white via-blue-200 to-white",
        "bg-clip-text text-transparent bg-[length:200%_100%]",
        "animate-shimmer",
        className
      )}
    >
      {children}
    </div>
  );
}

interface CountUpProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function CountUp({
  value,
  duration = 1000,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: CountUpProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useState(() => {
    const startTime = Date.now();
    const startValue = 0;
    const endValue = value;

    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      const easeOutQuad = 1 - (1 - progress) * (1 - progress);
      const currentValue = startValue + (endValue - startValue) * easeOutQuad;

      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  });

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </span>
  );
}

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: "primary" | "success" | "danger" | "warning";
  animated?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  color = "primary",
  animated = true,
  className,
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  const colorClasses = {
    primary: "bg-blue-500",
    success: "bg-green-500",
    danger: "bg-red-500",
    warning: "bg-yellow-500",
  };

  return (
    <div className={cn("w-full h-2 bg-white/5 rounded-full overflow-hidden", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500 ease-out",
          colorClasses[color],
          animated && "animate-pulse"
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-4 bg-white/5 rounded animate-pulse",
            i === lines - 1 && "w-3/4",
            className
          )}
        />
      ))}
    </div>
  );
}
