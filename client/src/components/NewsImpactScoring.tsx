import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, TrendingUp, TrendingDown, AlertTriangle, Award, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

interface NewsItem {
  id: string;
  title: string;
  source: string;
  tier: 1 | 2 | 3;
  category: string;
  sentiment: "bullish" | "bearish" | "neutral";
  impactScore: number;
  credibilityScore: number;
  recencyScore: number;
  timestamp: string;
  url: string;
}

export function NewsImpactScoring() {
  const [filterTier, setFilterTier] = useState<"all" | 1 | 2 | 3>("all");
  const [filterCategory, setFilterCategory] = useState<"all" | string>("all");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTC/USDT");

  // Fetch real news from NewsSentinel via tRPC
  const { data: newsFeed, isLoading, error, refetch, isFetching } = trpc.seerMulti.getNewsFeed.useQuery(
    { symbol: selectedSymbol },
    {
      refetchInterval: 60000, // Refetch every minute
      staleTime: 30000, // Consider data stale after 30 seconds
    }
  );

  const news = newsFeed?.items || [];
  const summary = newsFeed?.summary;

  const filteredNews = news.filter((item) => {
    if (filterTier !== "all" && item.tier !== filterTier) return false;
    if (filterCategory !== "all" && item.category !== filterCategory) return false;
    return true;
  });

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1:
        return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      case 2:
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case 3:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
      default:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  const getTierLabel = (tier: number) => {
    switch (tier) {
      case 1:
        return "Tier 1: Institutional";
      case 2:
        return "Tier 2: Industry";
      case 3:
        return "Tier 3: Social";
      default:
        return "Unknown";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "regulatory":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "technical":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "market":
        return "bg-green-500/10 text-green-400 border-green-500/20";
      case "macro":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      case "sentiment":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case "bullish":
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case "bearish":
        return <TrendingDown className="w-4 h-4 text-red-400" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getImpactColor = (score: number) => {
    if (score >= 80) return "text-red-400";
    if (score >= 60) return "text-orange-400";
    if (score >= 40) return "text-yellow-400";
    return "text-gray-400";
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 1000 / 60);

    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Calculate aggregate impact by tier
  const tier1News = news.filter((n) => n.tier === 1);
  const tier2News = news.filter((n) => n.tier === 2);
  const tier3News = news.filter((n) => n.tier === 3);
  const tier1Impact = tier1News.length > 0 ? tier1News.reduce((sum, n) => sum + n.impactScore, 0) / tier1News.length : 0;
  const tier2Impact = tier2News.length > 0 ? tier2News.reduce((sum, n) => sum + n.impactScore, 0) / tier2News.length : 0;
  const tier3Impact = tier3News.length > 0 ? tier3News.reduce((sum, n) => sum + n.impactScore, 0) / tier3News.length : 0;

  // Get unique categories for filter
  const categories = ["all", ...new Set(news.map(n => n.category))];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-muted-foreground">Loading real-time news from CoinGecko...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="glass p-6">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-red-400">Failed to load news feed</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Symbol Selector and Refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="BTC/USDT">Bitcoin (BTC)</option>
            <option value="ETH/USDT">Ethereum (ETH)</option>
            <option value="SOL/USDT">Solana (SOL)</option>
            <option value="BNB/USDT">BNB</option>
          </select>
          {summary && (
            <Badge 
              className={
                summary.overallSentiment === 'bullish' 
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : summary.overallSentiment === 'bearish'
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
              }
            >
              Overall: {summary.overallSentiment.toUpperCase()}
            </Badge>
          )}
        </div>
        <Button 
          onClick={() => refetch()} 
          variant="outline" 
          size="sm"
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Tier Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <Award className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tier 1: Institutional</p>
              <p className="text-xs text-muted-foreground">Bloomberg, Reuters, WSJ</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-yellow-400">
              {tier1Impact.toFixed(0)}
            </span>
            <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              {summary?.tier1Count || 0} items
            </Badge>
          </div>
        </Card>

        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Newspaper className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tier 2: Industry</p>
              <p className="text-xs text-muted-foreground">CoinDesk, CoinGecko</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-blue-400">
              {tier2Impact.toFixed(0)}
            </span>
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
              {summary?.tier2Count || 0} items
            </Badge>
          </div>
        </Card>

        <Card className="glass p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-gray-500/10">
              <AlertTriangle className="w-6 h-6 text-gray-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tier 3: Social</p>
              <p className="text-xs text-muted-foreground">Twitter, Reddit, Forums</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-mono font-bold text-gray-400">
              {tier3Impact.toFixed(0)}
            </span>
            <Badge className="bg-gray-500/10 text-gray-400 border-gray-500/20">
              {summary?.tier3Count || 0} items
            </Badge>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tier:</span>
          {(["all", 1, 2, 3] as const).map((tier) => (
            <button
              key={tier}
              onClick={() => setFilterTier(tier)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterTier === tier
                  ? "bg-blue-500 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {tier === "all" ? "All" : `Tier ${tier}`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Category:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                filterCategory === cat
                  ? "bg-blue-500 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* News Feed */}
      <Card className="glass p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Newspaper className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Live News Feed</h2>
            <Badge variant="outline" className="text-green-400 border-green-400/30">
              REAL DATA
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {summary?.totalItems || 0} articles from CoinGecko
          </p>
        </div>

        {filteredNews.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4">
            <Newspaper className="w-12 h-12 text-gray-500" />
            <p className="text-muted-foreground">No news articles found</p>
            <p className="text-sm text-gray-500">Try changing the filters or selecting a different symbol</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredNews.map((item, index) => (
              <div
                key={item.id}
                className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50 animate-fadeInUp hover:border-blue-500/30 transition-colors"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={getTierColor(item.tier)}>{getTierLabel(item.tier)}</Badge>
                      <Badge className={getCategoryColor(item.category)}>{item.category}</Badge>
                      {getSentimentIcon(item.sentiment)}
                    </div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {item.source} • {formatTime(item.timestamp)}
                      </p>
                      {item.url && (
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-xs text-muted-foreground mb-1">Impact Score</p>
                    <p className={`text-2xl font-mono font-bold ${getImpactColor(item.impactScore)}`}>
                      {item.impactScore}
                    </p>
                  </div>
                </div>

                {/* Score Breakdown */}
                <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-700/50">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Credibility</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-400 rounded-full"
                          style={{ width: `${item.credibilityScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono">{item.credibilityScore}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Recency</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-400 rounded-full"
                          style={{ width: `${item.recencyScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono">{item.recencyScore}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Impact</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            item.impactScore >= 80
                              ? "bg-red-400"
                              : item.impactScore >= 60
                              ? "bg-orange-400"
                              : item.impactScore >= 40
                              ? "bg-yellow-400"
                              : "bg-gray-400"
                          }`}
                          style={{ width: `${item.impactScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono">{item.impactScore}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Data Source Attribution */}
      <div className="text-center text-sm text-muted-foreground">
        <p>News data sourced from CoinGecko News API • Updated every minute</p>
        <p className="text-xs mt-1">Sentiment analysis powered by NewsSentinel AI Agent</p>
      </div>
    </div>
  );
}
