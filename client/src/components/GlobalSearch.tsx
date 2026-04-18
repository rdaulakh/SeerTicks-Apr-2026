import { useState, useEffect, useCallback } from "react";
import { Search, TrendingUp, Activity, DollarSign, FileText, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  type: "page" | "symbol" | "agent" | "position";
  title: string;
  subtitle?: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const allSearchableItems: SearchResult[] = [
  // Pages
  { id: "dashboard", type: "page", title: "Dashboard", path: "/dashboard", icon: TrendingUp },
  { id: "agents", type: "page", title: "Agents", path: "/agents", icon: Activity },
  { id: "strategy", type: "page", title: "Strategy", path: "/strategy", icon: FileText },
  { id: "trading", type: "page", title: "Trading", path: "/trading", icon: DollarSign },
  { id: "positions", type: "page", title: "Positions", path: "/positions", icon: DollarSign },
  { id: "system-health", type: "page", title: "System Health", path: "/system", icon: Activity },
  { id: "settings", type: "page", title: "Settings", path: "/settings", icon: FileText },
  { id: "backtesting", type: "page", title: "Backtesting", subtitle: "Consensus threshold backtesting", path: "/backtesting", icon: Clock },
  
  // Symbols (mock - replace with real data)
  { id: "btcusdt", type: "symbol", title: "BTCUSDT", subtitle: "Bitcoin / Tether", path: "/trading", icon: TrendingUp },
  { id: "ethusdt", type: "symbol", title: "ETHUSDT", subtitle: "Ethereum / Tether", path: "/trading", icon: TrendingUp },
  { id: "bnbusdt", type: "symbol", title: "BNBUSDT", subtitle: "Binance Coin / Tether", path: "/trading", icon: TrendingUp },
  
  // Agents
  { id: "technical", type: "agent", title: "TechnicalAnalyst", subtitle: "RSI, MACD, Bollinger Bands", path: "/agents", icon: Activity },
  { id: "pattern", type: "agent", title: "PatternMatcher", subtitle: "Chart patterns detection", path: "/agents", icon: Activity },
  { id: "orderflow", type: "agent", title: "OrderFlowAnalyst", subtitle: "Order book analysis", path: "/agents", icon: Activity },
  { id: "sentiment", type: "agent", title: "SentimentAnalyst", subtitle: "Market sentiment", path: "/agents", icon: Activity },
  { id: "news", type: "agent", title: "NewsSentinel", subtitle: "News impact analysis", path: "/agents", icon: Activity },
  { id: "macro", type: "agent", title: "MacroAnalyst", subtitle: "Macro correlations", path: "/agents", icon: Activity },
  { id: "onchain", type: "agent", title: "OnChainAnalyst", subtitle: "On-chain metrics", path: "/agents", icon: Activity },
];

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setLocation] = useLocation();
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("recentSearches");
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load recent searches", e);
      }
    }
  }, []);

  // Fuzzy search implementation
  const fuzzySearch = useCallback((searchQuery: string, items: SearchResult[]) => {
    if (!searchQuery.trim()) return [];

    const lowerQuery = searchQuery.toLowerCase();
    
    return items
      .map((item) => {
        const titleLower = item.title.toLowerCase();
        const subtitleLower = item.subtitle?.toLowerCase() || "";
        
        // Exact match gets highest score
        if (titleLower === lowerQuery) return { item, score: 100 };
        
        // Starts with query gets high score
        if (titleLower.startsWith(lowerQuery)) return { item, score: 90 };
        
        // Contains query gets medium score
        if (titleLower.includes(lowerQuery)) return { item, score: 70 };
        
        // Subtitle match gets lower score
        if (subtitleLower.includes(lowerQuery)) return { item, score: 50 };
        
        // Fuzzy match (all characters present in order)
        let queryIndex = 0;
        for (let i = 0; i < titleLower.length && queryIndex < lowerQuery.length; i++) {
          if (titleLower[i] === lowerQuery[queryIndex]) {
            queryIndex++;
          }
        }
        if (queryIndex === lowerQuery.length) return { item, score: 30 };
        
        return null;
      })
      .filter((result): result is { item: SearchResult; score: number } => result !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((r) => r.item);
  }, []);

  // Update results when query changes
  useEffect(() => {
    if (query.trim()) {
      const searchResults = fuzzySearch(query, allSearchableItems);
      setResults(searchResults);
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
  }, [query, fuzzySearch]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        // Cmd+K or Ctrl+K to open
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          // Parent component handles opening
        }
        return;
      }

      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      const displayResults = query.trim() ? results : recentSearches.slice(0, 5);

      // Arrow down
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % displayResults.length);
      }

      // Arrow up
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + displayResults.length) % displayResults.length);
      }

      // Enter to navigate
      if (e.key === "Enter" && displayResults.length > 0) {
        e.preventDefault();
        handleSelect(displayResults[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, query, results, selectedIndex, recentSearches, onClose]);

  const handleSelect = (item: SearchResult) => {
    // Save to recent searches
    const updated = [item, ...recentSearches.filter((r) => r.id !== item.id)].slice(0, 10);
    setRecentSearches(updated);
    localStorage.setItem("recentSearches", JSON.stringify(updated));

    // Navigate
    setLocation(item.path);
    onClose();
    setQuery("");
  };

  if (!isOpen) return null;

  const displayResults = query.trim() ? results : recentSearches.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-background border border-white/10 rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden animate-slideDown"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <Search className="w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search symbols, agents, positions, pages..."
            className="flex-1 bg-transparent border-none outline-none text-lg placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <kbd className="px-2 py-1 text-xs bg-white/5 rounded border border-white/10">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {displayResults.length > 0 ? (
            <div className="p-2">
              {!query.trim() && (
                <div className="px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider">
                  Recent Searches
                </div>
              )}
              {displayResults.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors text-left",
                      index === selectedIndex
                        ? "bg-blue-500/20 text-blue-400"
                        : "hover:bg-white/5"
                    )}
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        item.type === "page" && "bg-blue-500/20",
                        item.type === "symbol" && "bg-green-500/20",
                        item.type === "agent" && "bg-purple-500/20",
                        item.type === "position" && "bg-yellow-500/20"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-sm text-muted-foreground truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {item.type}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : query.trim() ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No results found for "{query}"</p>
              <p className="text-sm mt-1">Try searching for symbols, agents, or pages</p>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Start typing to search...</p>
              <p className="text-sm mt-1">Try "BTC", "Technical", or "Dashboard"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10 bg-white/5 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">↓</kbd>
              <span className="ml-1">Navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">Enter</kbd>
              <span className="ml-1">Select</span>
            </div>
          </div>
          <div>
            <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">Cmd+K</kbd>
            <span className="ml-1">to toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
