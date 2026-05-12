/**
 * AgentHeatmap — agents × symbols grid, color-coded by signal confidence.
 *
 * Each cell shows direction (long/short/neutral via color) and confidence
 * via opacity. Data source: `symbolStates[].signals[]` (agent name +
 * direction + confidence). Phase 40 confidence range is 0.05–0.20 — we
 * normalise into 0..1 for opacity by clamping (conf - 0.05) / 0.15.
 *
 * Operator gets a "who is firing where" view at a glance: a column of
 * mostly-green cells on one symbol = strong long consensus across agents.
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentSignal = {
  agentName: string;
  signal?: string;        // "long" / "short" / "neutral" — older engines used `signal`
  direction?: string;     // newer engines use `direction`
  confidence: number;
  timestamp?: number;
};

type SymbolState = {
  symbol: string;
  signals?: AgentSignal[];
};

function normalisedConfidence(c: number): number {
  // Phase 40: agents emit confidence in [0.05, 0.20]. Clamp into 0..1 for opacity.
  // Defensive: also handle legacy 0..1 ranges by capping.
  const raw = Math.max(0, Math.min(1, (c - 0.05) / 0.15));
  // Guarantee at least a tiny floor so the cell is visible.
  return Math.max(0.08, Math.min(1, raw));
}

function dirOf(s: AgentSignal): "long" | "short" | "neutral" {
  const d = String(s.direction ?? s.signal ?? "neutral").toLowerCase();
  if (d === "long" || d === "bullish" || d === "buy") return "long";
  if (d === "short" || d === "bearish" || d === "sell") return "short";
  return "neutral";
}

export default function AgentHeatmap({
  symbolStates,
}: {
  symbolStates: SymbolState[];
}) {
  // Union of all agent names across symbols, stable sort
  const { agents, symbols, lookup } = useMemo(() => {
    const agentSet = new Set<string>();
    const symbolList: string[] = [];
    const lookup = new Map<string, AgentSignal>(); // key: `${symbol}::${agent}`

    for (const s of symbolStates) {
      symbolList.push(s.symbol);
      for (const sig of s.signals ?? []) {
        agentSet.add(sig.agentName);
        lookup.set(`${s.symbol}::${sig.agentName}`, sig);
      }
    }

    return {
      agents: Array.from(agentSet).sort(),
      symbols: symbolList,
      lookup,
    };
  }, [symbolStates]);

  const totalCells = agents.length * symbols.length;
  const hasData = totalCells > 0;

  return (
    <Card className="glass-card border-slate-800/50 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-4 h-4 text-purple-400" />
          Agent Heatmap
          <span className="text-xs text-slate-500 normal-case">
            ({agents.length}a × {symbols.length}s)
          </span>
        </h2>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/80" /> long</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/80" /> short</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-500/60" /> neutral</span>
        </div>
      </div>

      {!hasData ? (
        <p className="text-xs text-slate-500 py-6 text-center">
          No agent signals yet — engine has not emitted a tick for this user.
        </p>
      ) : (
        <div className="overflow-auto max-h-[360px] pr-1">
          {/* Header row */}
          <div
            className="grid gap-0.5 sticky top-0 bg-slate-900/95 backdrop-blur z-10 pb-1"
            style={{ gridTemplateColumns: `minmax(110px, 1.2fr) repeat(${symbols.length}, minmax(70px, 1fr))` }}
          >
            <div className="text-[10px] uppercase tracking-wider text-slate-500 px-1">agent</div>
            {symbols.map((sym) => (
              <div key={sym} className="text-[10px] uppercase tracking-wider text-slate-400 font-mono text-center">
                {sym.replace("-USD", "").replace("USDT", "")}
              </div>
            ))}
          </div>

          {agents.map((agent) => (
            <div
              key={agent}
              className="grid gap-0.5 items-center mb-0.5"
              style={{ gridTemplateColumns: `minmax(110px, 1.2fr) repeat(${symbols.length}, minmax(70px, 1fr))` }}
            >
              <div className="text-[10px] font-mono text-slate-300 truncate px-1" title={agent}>
                {agent}
              </div>
              {symbols.map((sym) => {
                const sig = lookup.get(`${sym}::${agent}`);
                if (!sig) {
                  return (
                    <div
                      key={sym}
                      className="h-6 rounded-sm border border-slate-800/50 bg-slate-800/20"
                      title={`${agent} · ${sym}: no signal`}
                    />
                  );
                }
                const dir = dirOf(sig);
                const opacity = normalisedConfidence(Number(sig.confidence) || 0);
                const colorClass =
                  dir === "long"
                    ? "bg-green-500"
                    : dir === "short"
                      ? "bg-red-500"
                      : "bg-slate-500";
                return (
                  <div
                    key={sym}
                    className={cn(
                      "h-6 rounded-sm border border-slate-800/50 flex items-center justify-center text-[9px] font-mono",
                      colorClass
                    )}
                    style={{ opacity }}
                    title={`${agent} · ${sym}\n${dir} · conf ${Number(sig.confidence).toFixed(3)}`}
                  >
                    {dir === "neutral" ? "" : (Number(sig.confidence) * 100).toFixed(0)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
