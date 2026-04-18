import { useMemo } from "react";

interface SparklineProps {
  data: number[]; // Array of values to plot
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  showDots?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 200,
  height = 40,
  color = "rgb(34, 197, 94)", // green-500
  fillColor = "rgba(34, 197, 94, 0.1)",
  showDots = false,
  className = "",
}: SparklineProps) {
  const { path, fillPath, dots } = useMemo(() => {
    if (data.length === 0) {
      return { path: "", fillPath: "", dots: [] };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // Avoid division by zero

    // Calculate points
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return { x, y, value };
    });

    // Create SVG path
    const pathData = points
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${point.x} ${point.y}`;
      })
      .join(" ");

    // Create filled area path
    const fillPathData = `${pathData} L ${width} ${height} L 0 ${height} Z`;

    return {
      path: pathData,
      fillPath: fillPathData,
      dots: showDots ? points : [],
    };
  }, [data, width, height, showDots]);

  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ width, height }}>
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {/* Filled area */}
      <path d={fillPath} fill={fillColor} />

      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots (optional) */}
      {dots.map((dot, index) => (
        <circle
          key={index}
          cx={dot.x}
          cy={dot.y}
          r="2"
          fill={color}
        />
      ))}
    </svg>
  );
}
