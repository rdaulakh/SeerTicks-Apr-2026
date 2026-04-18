import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { useMemo } from "react";

interface CorrelationData {
  symbol1: string;
  symbol2: string;
  correlation: number; // -1 to 1
  period: string; // e.g., "30d", "7d"
}

interface CorrelationHeatmapProps {
  correlations: CorrelationData[];
  symbols: string[];
  highlightThreshold?: number; // Highlight correlations above this value (default 0.7)
}

export function CorrelationHeatmap({
  correlations,
  symbols,
  highlightThreshold = 0.7,
}: CorrelationHeatmapProps) {
  // Build correlation matrix
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    symbols.forEach((s1) => {
      m[s1] = {};
      symbols.forEach((s2) => {
        if (s1 === s2) {
          m[s1][s2] = 1.0; // Perfect correlation with self
        } else {
          const corr = correlations.find(
            (c) =>
              (c.symbol1 === s1 && c.symbol2 === s2) ||
              (c.symbol1 === s2 && c.symbol2 === s1)
          );
          m[s1][s2] = corr?.correlation ?? 0;
        }
      });
    });
    return m;
  }, [correlations, symbols]);

  // Find highly correlated pairs
  const highCorrelations = useMemo(() => {
    return correlations.filter(
      (c) => Math.abs(c.correlation) >= highlightThreshold
    );
  }, [correlations, highlightThreshold]);

  // Get color for correlation value
  const getCorrelationColor = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 0.8) return value > 0 ? "bg-red-600" : "bg-blue-600";
    if (abs >= 0.6) return value > 0 ? "bg-red-500" : "bg-blue-500";
    if (abs >= 0.4) return value > 0 ? "bg-red-400" : "bg-blue-400";
    if (abs >= 0.2) return value > 0 ? "bg-red-300" : "bg-blue-300";
    return "bg-gray-300";
  };

  const getCorrelationTextColor = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 0.4) return "text-white";
    return "text-foreground";
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Correlation Matrix
          </CardTitle>
          {highCorrelations.length > 0 && (
            <Badge variant="outline" className="gap-1 border-yellow-500/50">
              <AlertTriangle className="h-3 w-3 text-yellow-600" />
              {highCorrelations.length} High Correlations
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Correlation Matrix Grid */}
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-xs font-medium text-muted-foreground text-left">
                    {/* Empty corner cell */}
                  </th>
                  {symbols.map((symbol) => (
                    <th
                      key={symbol}
                      className="p-2 text-xs font-medium text-muted-foreground text-center"
                    >
                      {symbol}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbols.map((symbol1) => (
                  <tr key={symbol1}>
                    <td className="p-2 text-xs font-medium text-muted-foreground">
                      {symbol1}
                    </td>
                    {symbols.map((symbol2) => {
                      const value = matrix[symbol1]?.[symbol2] ?? 0;
                      const isHighlighted =
                        symbol1 !== symbol2 &&
                        Math.abs(value) >= highlightThreshold;
                      return (
                        <td key={symbol2} className="p-1">
                          <div
                            className={`
                              w-12 h-12 flex items-center justify-center rounded
                              ${getCorrelationColor(value)}
                              ${getCorrelationTextColor(value)}
                              ${isHighlighted ? "ring-2 ring-yellow-500" : ""}
                              transition-all hover:scale-110
                            `}
                            title={`${symbol1} vs ${symbol2}: ${value.toFixed(3)}`}
                          >
                            <span className="text-xs font-semibold">
                              {value.toFixed(2)}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Correlation Legend */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Positive:</span>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-red-300 rounded" />
              <span>Weak</span>
              <div className="w-4 h-4 bg-red-500 rounded" />
              <span>Moderate</span>
              <div className="w-4 h-4 bg-red-600 rounded" />
              <span>Strong</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Negative:</span>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 bg-blue-300 rounded" />
              <span>Weak</span>
              <div className="w-4 h-4 bg-blue-500 rounded" />
              <span>Moderate</span>
              <div className="w-4 h-4 bg-blue-600 rounded" />
              <span>Strong</span>
            </div>
          </div>
        </div>

        {/* High Correlation Warnings */}
        {highCorrelations.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              High Correlation Warnings:
            </div>
            <div className="space-y-1">
              {highCorrelations.map((corr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
                >
                  <div className="flex items-center gap-2">
                    {corr.correlation > 0 ? (
                      <TrendingUp className="h-4 w-4 text-red-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-blue-500" />
                    )}
                    <span className="text-sm font-medium">
                      {corr.symbol1} ↔ {corr.symbol2}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        corr.correlation > 0
                          ? "bg-red-500/10 text-red-600 border-red-500/20"
                          : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                      }
                    >
                      {corr.correlation > 0 ? "+" : ""}
                      {corr.correlation.toFixed(3)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {corr.period}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 inline mr-1 text-yellow-600" />
              Opening positions in highly correlated assets increases portfolio
              risk. Consider reducing position sizes or diversifying.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
