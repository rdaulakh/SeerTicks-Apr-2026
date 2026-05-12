/**
 * SymbolTickerStrip — compact per-symbol price ticker with sparklines.
 *
 * Each row: symbol · live price · 24h %Δ · 24-hour sparkline. Live price and
 * 24h change come from `getStatus.symbolStates` (already cached by parent).
 * The sparkline pulls 24 × 1-hour candles from `candles.getCandles` (one
 * request per symbol; only fires on mount + every 5 min — candles barely
 * change intra-hour, so a long staleTime is the right call).
 *
 * Note on symbol formats: the candle storage layer accepts variations
 * (BTC-USD / BTCUSD / BTCUSDT) — see `getSymbolVariations` server-side, so
 * we pass the canonical Coinbase-style ticker (e.g. "BTC-USD").
 */

import { useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const DEFAULT_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function SparkRow({ symbol, price, change24h }: { symbol: string; price: number; change24h: number }) {
  const { data: candles } = trpc.candles.getCandles.useQuery(
    { symbol, timeframe: "1h", limit: 24 },
    { staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 }
  );
  const series = useMemo(
    () => (candles ?? []).map((c: any) => ({ t: c.timestamp, close: c.close })),
    [candles]
  );
  const up = change24h >= 0;
  const stroke = up ? "#10b981" : "#ef4444";
  const validSeries = series.length >= 2;

  return (
    <div className="flex items-center gap-2 py-2 px-2 border-b border-slate-800/40 last:border-b-0">
      <div className="w-16 shrink-0">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{symbol}</p>
      </div>
      <div className="w-20 shrink-0 text-right">
        <p className="text-[11px] font-mono text-slate-900 dark:text-white">{fmtPrice(price)}</p>
      </div>
      <div className="w-16 shrink-0 flex items-center justify-end gap-0.5">
        {up ? (
          <ArrowUpRight className="w-3 h-3 text-green-400" />
        ) : (
          <ArrowDownRight className="w-3 h-3 text-red-400" />
        )}
        <span className={cn("text-[11px] font-mono", up ? "text-green-400" : "text-red-400")}>
          {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
        </span>
      </div>
      <div className="flex-1 h-8 min-w-[60px]">
        {validSeries ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              {/* invisible axis to anchor scale */}
              <YAxis hide domain={["auto", "auto"]} />
              <Line
                type="monotone"
                dataKey="close"
                stroke={stroke}
                strokeWidth={1.4}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-end text-[10px] text-slate-600">no data</div>
        )}
      </div>
    </div>
  );
}

export default function SymbolTickerStrip({
  symbolStates,
}: {
  symbolStates: Array<{ symbol: string; lastPrice?: number; priceChange24h?: number }>;
}) {
  // Always show at least the default 3. If symbolStates exists, prefer its data.
  const stateMap = new Map(symbolStates.map((s) => [s.symbol, s]));
  const rows = DEFAULT_SYMBOLS.map((sym) => {
    const s = stateMap.get(sym);
    return {
      symbol: sym,
      price: Number(s?.lastPrice ?? 0),
      change24h: Number(s?.priceChange24h ?? 0),
    };
  });

  // Append any additional symbols the engine tracks beyond the defaults
  for (const s of symbolStates) {
    if (!DEFAULT_SYMBOLS.includes(s.symbol)) {
      rows.push({
        symbol: s.symbol,
        price: Number(s.lastPrice ?? 0),
        change24h: Number(s.priceChange24h ?? 0),
      });
    }
  }

  return (
    <Card className="glass-card border-slate-800/50 p-3 h-full">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        Markets
        <span className="text-xs text-slate-500 normal-case">(24h)</span>
      </h2>
      <div className="divide-y divide-slate-800/40">
        {rows.map((r) => (
          <SparkRow key={r.symbol} symbol={r.symbol} price={r.price} change24h={r.change24h} />
        ))}
      </div>
    </Card>
  );
}
