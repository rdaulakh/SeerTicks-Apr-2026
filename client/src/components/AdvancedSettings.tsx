import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, Plus, Check, X, Settings as SettingsIcon, RefreshCw } from "lucide-react";

export function AdvancedSettingsPanel() {
  const [activeTab, setActiveTab] = useState("exchanges");
  
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <TabsList className="bg-card/50 border border-border">
        <TabsTrigger value="exchanges">Exchanges</TabsTrigger>
        <TabsTrigger value="symbols">Trading Symbols</TabsTrigger>
        <TabsTrigger value="api-keys">External API Keys</TabsTrigger>
      </TabsList>

      <TabsContent value="exchanges">
        <ExchangesPanel />
      </TabsContent>

      <TabsContent value="symbols">
        <SymbolsPanel />
      </TabsContent>

      <TabsContent value="api-keys">
        <ExternalApiKeysPanel />
      </TabsContent>
    </Tabs>
  );
}

// Phase 57 — exchange options surfaced in the Add Exchange wizard. Keep the
// labels distinct (Binance Spot vs USDM Futures) since they hit different
// testnets and require different API keys.
type ExchangeName = "binance" | "binance-futures" | "coinbase";
const EXCHANGE_OPTIONS: { value: ExchangeName; label: string; hint: string }[] = [
  { value: "binance-futures", label: "Binance USDM Futures", hint: "Native long & short. Recommended." },
  { value: "binance", label: "Binance Spot", hint: "Long-only. Bearish signals can't execute as real shorts." },
  { value: "coinbase", label: "Coinbase", hint: "Spot only." },
];

// ===== Exchanges Panel =====
function ExchangesPanel() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newExchange, setNewExchange] = useState<{ exchangeName: ExchangeName; apiKey: string; apiSecret: string }>({
    exchangeName: "binance-futures",
    apiKey: "",
    apiSecret: "",
  });

  const { data: exchanges, refetch } = trpc.settings.getExchanges.useQuery();
  const addExchange = trpc.settings.addExchange.useMutation({
    onSuccess: (result) => {
      // Phase 56 — addExchange now probes credentials before persisting.
      // Surface the probe result so the user sees what actually happened.
      if (result?.success) {
        toast.success(result.message ? `Exchange added: ${result.message}` : 'Exchange added and connected');
        setShowAddForm(false);
        setNewExchange({ exchangeName: "binance-futures", apiKey: "", apiSecret: "" });
      } else {
        toast.error(result?.message || 'Saved, but connection failed — check API key permissions');
      }
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to add exchange: ${error.message}`);
    },
  });
  const deleteExchange = trpc.settings.deleteExchange.useMutation({
    onSuccess: () => {
      toast.success("Exchange deleted");
      refetch();
    },
  });
  // Phase 56 — re-probes stored API keys against the exchange and updates
  // exchanges.connectionStatus + apiKeys.isValid. Replaces the old
  // exchange.checkHealth (which only read in-memory monitor state).
  const reprobe = trpc.settings.refreshExchangeConnection.useMutation();
  const [reprobingId, setReprobingId] = useState<number | null>(null);
  const checkHealth = {
    isPending: reprobingId !== null,
    mutate: async () => {
      if (!exchanges || exchanges.length === 0) {
        toast.info("No exchanges to check");
        return;
      }
      let connected = 0;
      let failed = 0;
      for (const ex of exchanges) {
        if (ex.id <= 0) continue;
        setReprobingId(ex.id);
        try {
          const r = await reprobe.mutateAsync({ exchangeId: ex.id });
          if (r.success) connected++; else failed++;
        } catch {
          failed++;
        }
      }
      setReprobingId(null);
      await refetch();
      if (failed === 0) toast.success(`Health check OK (${connected} connected)`);
      else toast.error(`Health check: ${connected} connected, ${failed} failed`);
    },
  };

  const formatLastSync = (lastConnected: Date | null | undefined) => {
    if (!lastConnected) return "Never";
    const date = new Date(lastConnected);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const handleAddExchange = () => {
    if (!newExchange.apiKey || !newExchange.apiSecret) {
      toast.error("Please fill in all fields");
      return;
    }
    addExchange.mutate(newExchange);
  };

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle>Connected Exchanges</CardTitle>
        <CardDescription>Manage your exchange connections for multi-exchange trading</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {exchanges && exchanges.length > 0 ? (
          exchanges.map((exchange) => (
            <div
              key={exchange.id}
              className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                  <SettingsIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold capitalize">{exchange.exchangeName}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        exchange.connectionStatus === "connected"
                          ? "bg-green-500/20 text-green-600 dark:text-green-400"
                          : exchange.connectionStatus === "error"
                          ? "bg-red-500/20 text-red-600 dark:text-red-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {exchange.connectionStatus}
                    </span>
                    {exchange.isActive && (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">Active</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Last synced: {formatLastSync(exchange.lastConnected)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    setReprobingId(exchange.id);
                    try {
                      const r = await reprobe.mutateAsync({ exchangeId: exchange.id });
                      if (r.success) toast.success(r.message || 'Connected');
                      else toast.error(r.message || 'Still disconnected');
                      await refetch();
                    } catch (e: any) {
                      toast.error(e?.message || 'Probe failed');
                    } finally {
                      setReprobingId(null);
                    }
                  }}
                  disabled={reprobingId === exchange.id}
                  title="Re-test API credentials"
                >
                  <RefreshCw className={`w-4 h-4 ${reprobingId === exchange.id ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteExchange.mutate({ exchangeId: exchange.id })}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No exchanges connected yet</p>
            <p className="text-sm mt-2">Add an exchange to start trading</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button 
            onClick={() => checkHealth.mutate()} 
            variant="outline" 
            className="flex-1"
            disabled={checkHealth.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${checkHealth.isPending ? 'animate-spin' : ''}`} />
            Check Health
          </Button>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="flex-1">
              <Plus className="w-4 h-4 mr-2" />
              Add Exchange
            </Button>
          )}
        </div>

        {showAddForm && (
          <div className="p-4 bg-muted/30 rounded-lg border border-border space-y-4">
            <div>
              <Label htmlFor="exchangeName">Exchange</Label>
              <select
                id="exchangeName"
                value={newExchange.exchangeName}
                onChange={(e) => setNewExchange({ ...newExchange, exchangeName: e.target.value as ExchangeName })}
                className="w-full mt-1 bg-background border border-input rounded-md px-3 py-2"
              >
                {EXCHANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {EXCHANGE_OPTIONS.find((o) => o.value === newExchange.exchangeName)?.hint}
              </p>
              {newExchange.exchangeName === "binance-futures" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Generate keys at{" "}
                  <a
                    href="https://testnet.binancefuture.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    testnet.binancefuture.com
                  </a>
                  {" "}(not testnet.binance.vision — those are spot keys and will be rejected). Use System-generated (HMAC), enable Futures permission.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="text"
                value={newExchange.apiKey}
                onChange={(e) => setNewExchange({ ...newExchange, apiKey: e.target.value })}
                placeholder="Enter API key"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                type="password"
                value={newExchange.apiSecret}
                onChange={(e) => setNewExchange({ ...newExchange, apiSecret: e.target.value })}
                placeholder="Enter API secret"
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddExchange} disabled={addExchange.isPending} className="flex-1">
                <Check className="w-4 h-4 mr-2" />
                {addExchange.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddForm(false);
                  setNewExchange({ exchangeName: "binance-futures", apiKey: "", apiSecret: "" });
                }}
                className="flex-1"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== Symbols Panel =====
function SymbolsPanel() {
  const [newSymbol, setNewSymbol] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: symbols, refetch } = trpc.settings.getSymbols.useQuery();
  const addSymbol = trpc.settings.addSymbol.useMutation({
    onSuccess: () => {
      toast.success("Symbol added successfully");
      refetch();
      setShowAddForm(false);
      setNewSymbol("");
    },
    onError: (error) => {
      toast.error(`Failed to add symbol: ${error.message}`);
    },
  });
  const deleteSymbol = trpc.settings.deleteSymbol.useMutation({
    onSuccess: () => {
      toast.success("Symbol removed");
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to remove symbol: ${error.message}`);
    },
  });

  const handleAddSymbol = () => {
    if (!newSymbol.trim()) {
      toast.error("Please enter a symbol");
      return;
    }
    const symbolUpper = newSymbol.toUpperCase();
    if (symbols?.some(s => s.symbol === symbolUpper)) {
      toast.error("Symbol already added");
      return;
    }
    addSymbol.mutate({ symbol: symbolUpper, isActive: true });
  };

  const handleRemoveSymbol = (symbolId: number) => {
    deleteSymbol.mutate({ symbolId });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle>Trading Symbols</CardTitle>
          <CardDescription>Select symbols to trade across all connected exchanges</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {symbols && symbols.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {symbols.map((symbol) => (
                <div
                  key={symbol.id}
                  className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border"
                >
                  <span className="font-mono font-semibold">{symbol.symbol}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveSymbol(symbol.id)}
                    disabled={deleteSymbol.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No trading symbols configured yet</p>
              <p className="text-sm mt-2">Add symbols to start trading</p>
            </div>
          )}

          {!showAddForm ? (
            <Button onClick={() => setShowAddForm(true)} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Symbol
            </Button>
          ) : (
            <div className="p-4 bg-muted/30 rounded-lg border border-border space-y-4">
              <div>
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g., BTCUSDT"
                  className="mt-1 font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">Enter symbol in exchange format (e.g., BTCUSDT, ETHUSDT)</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddSymbol} disabled={addSymbol.isPending} className="flex-1">
                  <Check className="w-4 h-4 mr-2" />
                  {addSymbol.isPending ? "Adding..." : "Add"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewSymbol("");
                  }}
                  className="flex-1"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle>Multi-Symbol Trading</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable Multi-Symbol Trading</p>
              <p className="text-sm text-muted-foreground">Trade multiple symbols simultaneously for diversification</p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Auto-Rebalance</p>
              <p className="text-sm text-muted-foreground">Automatically rebalance capital across symbols</p>
            </div>
            <Switch />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== External API Keys Panel =====
function ExternalApiKeysPanel() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState({
    provider: "whale_alert",
    apiKey: "",
    rateLimit: 60,
  });

  const { data: apiKeys, refetch } = trpc.settings.getExternalApiKeys.useQuery();
  const addApiKey = trpc.settings.addExternalApiKey.useMutation({
    onSuccess: () => {
      toast.success("API key added successfully");
      refetch();
      setShowAddForm(false);
      setNewKey({ provider: "whale_alert", apiKey: "", rateLimit: 60 });
    },
    onError: (error) => {
      toast.error(`Failed to add API key: ${error.message}`);
    },
  });
  const deleteApiKey = trpc.settings.deleteExternalApiKey.useMutation({
    onSuccess: () => {
      toast.success("API key deleted");
      refetch();
    },
  });

  const handleAddKey = () => {
    if (!newKey.apiKey) {
      toast.error("Please enter an API key");
      return;
    }
    addApiKey.mutate(newKey);
  };

  const providers = [
    { value: "whale_alert", label: "Whale Alert" },
    { value: "coingecko", label: "CoinGecko" },
    { value: "newsapi", label: "News API" },
    { value: "cryptopanic", label: "CryptoPanic" },
  ];

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle>External API Keys</CardTitle>
        <CardDescription>Manage API keys for external data providers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {apiKeys && apiKeys.length > 0 ? (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border"
            >
              <div>
                <h3 className="font-semibold capitalize">{key.provider.replace("_", " ")}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      key.isValid ? "bg-green-500/20 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {key.isValid ? "Valid" : "Not Tested"}
                  </span>
                  {key.rateLimit && (
                    <span className="text-xs text-muted-foreground">{key.rateLimit} req/min</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteApiKey.mutate({ id: key.id })}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No API keys configured</p>
            <p className="text-sm mt-2">Add external API keys for enhanced data</p>
          </div>
        )}

        {!showAddForm ? (
          <Button onClick={() => setShowAddForm(true)} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add API Key
          </Button>
        ) : (
          <div className="p-4 bg-muted/30 rounded-lg border border-border space-y-4">
            <div>
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={newKey.provider}
                onChange={(e) => setNewKey({ ...newKey, provider: e.target.value })}
                className="w-full mt-1 bg-background border border-input rounded-md px-3 py-2"
              >
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={newKey.apiKey}
                onChange={(e) => setNewKey({ ...newKey, apiKey: e.target.value })}
                placeholder="Enter API key"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="rateLimit">Rate Limit (req/min)</Label>
              <Input
                id="rateLimit"
                type="number"
                value={newKey.rateLimit}
                onChange={(e) => setNewKey({ ...newKey, rateLimit: parseInt(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddKey} disabled={addApiKey.isPending} className="flex-1">
                <Check className="w-4 h-4 mr-2" />
                {addApiKey.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddForm(false);
                  setNewKey({ provider: "whale_alert", apiKey: "", rateLimit: 60 });
                }}
                className="flex-1"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
