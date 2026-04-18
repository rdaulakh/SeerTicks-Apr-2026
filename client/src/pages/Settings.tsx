import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdvancedSettingsPanel } from "@/components/AdvancedSettings";
import { ExchangeWizard } from "@/components/ExchangeWizard";
import { ExchangeConnectionStatus } from "@/components/ExchangeConnectionStatus";
// Navigation is rendered in App.tsx for all protected routes
import { 
  Settings as SettingsIcon, 
  Bell, 
  Zap,
  Save,
  Loader2,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Play,
  Bot,
  Wallet,
  Plus,
  DollarSign
} from "lucide-react";
import { toast } from "sonner";

/**
 * Settings Page - Simplified for Autonomous Operation
 * 
 * SEER is a fully autonomous AI trading platform.
 * Users only configure:
 * 1. Trading Mode (Paper/Live)
 * 2. Auto Trading (On/Off)
 * 3. Portfolio Funds (for paper trading)
 * 4. Notifications
 * 5. Exchange Configuration
 * 
 * All trading decisions (position sizing, stop loss, take profit, etc.)
 * are made by the AI agents autonomously.
 */
export default function Settings() {
  // Load settings from backend with optimized retry and caching
  // Using shorter staleTime for faster initial load with cached data
  const { data: tradingModeConfig, isLoading: tradingModeLoading, isError: tradingModeError } = trpc.settings.getTradingMode.useQuery(undefined, {
    retry: 1, // Reduce retries for faster failure
    retryDelay: 500,
    staleTime: 60000, // 1 minute cache
    gcTime: 300000, // Keep in cache for 5 minutes
  });
  const { data: autoTradingConfig, isLoading: autoTradingLoading, isError: autoTradingError } = trpc.settings.getAutoTrading.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 60000,
    gcTime: 300000,
  });
  const { data: portfolioFundsData, isLoading: portfolioFundsLoading, isError: portfolioFundsError } = trpc.settings.getPortfolioFunds.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 60000,
    gcTime: 300000,
  });
  const updateTradingModeMutation = trpc.settings.updateTradingMode.useMutation();
  const updateAutoTradingMutation = trpc.settings.updateAutoTrading.useMutation();
  const updatePortfolioFundsMutation = trpc.settings.updatePortfolioFunds.useMutation();
  const utils = trpc.useUtils();

  // Trading mode state
  const [tradingMode, setTradingMode] = useState<'paper' | 'real'>('paper');
  const [autoTradingEnabled, setAutoTradingEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Portfolio funds state
  const [portfolioFunds, setPortfolioFunds] = useState("10000.00");
  const [addFundsAmount, setAddFundsAmount] = useState("");
  const [isAddingFunds, setIsAddingFunds] = useState(false);

  // Notification settings
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    pushNotifications: false,
    tradeAlerts: true,
    signalAlerts: false,
  });

  // Sync with backend data
  useEffect(() => {
    if (tradingModeConfig) {
      setTradingMode(tradingModeConfig.mode);
    }
  }, [tradingModeConfig]);

  // Sync auto trading state with backend - this ensures persistence across logout/login
  useEffect(() => {
    console.log('[Settings] autoTradingConfig changed:', autoTradingConfig, 'isLoading:', autoTradingLoading, 'isError:', autoTradingError);
    if (autoTradingConfig !== undefined) {
      console.log('[Settings] Setting autoTradingEnabled to:', autoTradingConfig.enabled);
      setAutoTradingEnabled(autoTradingConfig.enabled);
    }
  }, [autoTradingConfig, autoTradingLoading, autoTradingError]);

  // Sync portfolio funds with backend
  useEffect(() => {
    if (portfolioFundsData?.funds) {
      setPortfolioFunds(portfolioFundsData.funds);
    }
  }, [portfolioFundsData]);

  // Handle trading mode change
  const handleTradingModeChange = async (mode: 'paper' | 'real') => {
    const previousMode = tradingMode;
    setTradingMode(mode);
    
    try {
      await updateTradingModeMutation.mutateAsync({ 
        mode
      });
      await utils.settings.getTradingMode.invalidate();
      toast.success(`Switched to ${mode === 'paper' ? 'Paper' : 'Live'} Trading`);
    } catch (error: any) {
      toast.error('Failed to update trading mode', { description: error.message });
      setTradingMode(previousMode);
    }
  };

  // Handle auto trading toggle - persists to database so state survives logout/login
  const handleAutoTradingToggle = async (enabled: boolean) => {
    const previousValue = autoTradingEnabled;
    setAutoTradingEnabled(enabled);
    
    try {
      // Save auto trading state to database - this is the key fix for persistence
      await updateAutoTradingMutation.mutateAsync({ enabled });
      await utils.settings.getAutoTrading.invalidate();
      toast.success(`Auto trading ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error: any) {
      toast.error('Failed to update auto trading', { description: error.message });
      setAutoTradingEnabled(previousValue);
    }
  };

  // Handle adding funds to portfolio
  const handleAddFunds = async () => {
    const amount = parseFloat(addFundsAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const currentFunds = parseFloat(portfolioFunds);
    const newFunds = (currentFunds + amount).toFixed(2);

    setIsAddingFunds(true);
    try {
      await updatePortfolioFundsMutation.mutateAsync({ funds: newFunds });
      await utils.settings.getPortfolioFunds.invalidate();
      setPortfolioFunds(newFunds);
      setAddFundsAmount("");
      toast.success(`Added $${amount.toLocaleString()} to your paper trading balance`);
    } catch (error: any) {
      toast.error('Failed to add funds', { description: error.message });
    } finally {
      setIsAddingFunds(false);
    }
  };

  // Handle setting specific fund amount
  const handleSetFunds = async (amount: string) => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setIsAddingFunds(true);
    try {
      await updatePortfolioFundsMutation.mutateAsync({ funds: numAmount.toFixed(2) });
      await utils.settings.getPortfolioFunds.invalidate();
      setPortfolioFunds(numAmount.toFixed(2));
      toast.success(`Portfolio balance set to $${numAmount.toLocaleString()}`);
    } catch (error: any) {
      toast.error('Failed to update funds', { description: error.message });
    } finally {
      setIsAddingFunds(false);
    }
  };

  // Quick add amounts
  const quickAddAmounts = [1000, 5000, 10000, 50000, 100000];

  // Check if any query has an error - show content with defaults instead of infinite spinner
  const hasAnyError = tradingModeError || autoTradingError || portfolioFundsError;
  
  // Add a timeout to prevent infinite loading - show page with defaults after 5 seconds
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadingTimeout(true);
    }, 5000); // 5 second timeout
    return () => clearTimeout(timer);
  }, []);
  
  // Only show loading spinner if all queries are still loading, none have errored, and timeout hasn't passed
  // This prevents infinite loading when queries fail or take too long
  const isInitialLoading = (tradingModeLoading || autoTradingLoading || portfolioFundsLoading) && !hasAnyError && !loadingTimeout;

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-background pt-20">
        <div className="flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-20">
      <main className="container mx-auto px-3 sm:px-4 pt-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 lg:mb-8">
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="p-1.5 lg:p-2 rounded-lg bg-primary/10">
              <SettingsIcon className="w-5 h-5 lg:w-6 lg:h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-bold">Settings</h1>
              <p className="text-muted-foreground text-sm lg:text-base hidden sm:block">Configure your autonomous trading platform</p>
            </div>
          </div>
        </div>

        {/* Autonomous Operation Notice */}
        <Card className="p-4 mb-6 bg-blue-500/10 border-blue-500/30">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-500">Fully Autonomous AI Platform</p>
              <p className="text-sm text-muted-foreground mt-1">
                SEER operates 24/7/365 with AI agents making all trading decisions autonomously.
                Position sizing, stop loss, take profit, and risk management are handled by the AI.
                You only need to configure your trading mode and exchange connection.
              </p>
            </div>
          </div>
        </Card>

        {/* Settings Tabs - Simplified for autonomous operation */}
        <Tabs defaultValue="trading" className="space-y-4 lg:space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-card/50 border border-border h-auto">
            <TabsTrigger value="trading" className="data-[state=active]:bg-primary/10 text-xs sm:text-sm py-2 lg:py-2.5 flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden sm:inline">Trading Mode</span>
              <span className="sm:hidden">Trading</span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-primary/10 text-xs sm:text-sm py-2 lg:py-2.5 flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Notifications</span>
              <span className="sm:hidden">Alerts</span>
            </TabsTrigger>
            <TabsTrigger value="advanced" className="data-[state=active]:bg-primary/10 text-xs sm:text-sm py-2 lg:py-2.5 flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
              <Zap className="w-4 h-4" />
              <span>Exchange</span>
            </TabsTrigger>
          </TabsList>

          {/* Trading Mode Settings */}
          <TabsContent value="trading" className="space-y-6">
            {/* Trading Mode Selection */}
            <Card className="p-6 bg-card/50 border-border">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Trading Mode
              </h3>
              
              <div className="space-y-6">
                {/* Paper Trading / Live Trading Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
                  <button
                    onClick={() => handleTradingModeChange('paper')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      tradingMode === 'paper'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-3 h-3 rounded-full ${tradingMode === 'paper' ? 'bg-green-500' : 'bg-muted'}`} />
                      <span className="font-semibold">Paper Trading</span>
                    </div>
                    <p className="text-sm text-muted-foreground text-left">
                      Trade with simulated funds. No real money at risk. Perfect for testing strategies.
                    </p>
                  </button>
                  
                  <button
                    onClick={() => handleTradingModeChange('real')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      tradingMode === 'real'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-border hover:border-red-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-3 h-3 rounded-full ${tradingMode === 'real' ? 'bg-red-500' : 'bg-muted'}`} />
                      <span className="font-semibold">Live Trading</span>
                    </div>
                    <p className="text-sm text-muted-foreground text-left">
                      Execute real trades with real money on connected exchanges.
                    </p>
                  </button>
                </div>

                {/* Live Trading Warning */}
                {tradingMode === 'real' && (
                  <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-red-500">Live Trading Mode Active</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Real orders will be placed on your connected exchanges. The AI will manage risk autonomously, but only trade with funds you can afford to lose.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Paper Trading Balance - Only show when in paper trading mode */}
            {tradingMode === 'paper' && (
              <Card className="p-6 bg-card/50 border-border">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Wallet className="w-5 h-5" />
                  Paper Trading Balance
                </h3>
                
                <div className="space-y-6">
                  {/* Current Balance Display */}
                  <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Current Balance</p>
                        <p className="text-3xl font-bold text-green-500">
                          ${parseFloat(portfolioFunds).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="p-3 bg-green-500/20 rounded-full">
                        <DollarSign className="w-8 h-8 text-green-500" />
                      </div>
                    </div>
                  </div>

                  {/* Add Funds Section */}
                  <div className="space-y-4">
                    <Label className="text-base font-semibold">Add Funds</Label>
                    
                    {/* Quick Add Buttons */}
                    <div className="flex flex-wrap gap-2">
                      {quickAddAmounts.map((amount) => (
                        <Button
                          key={amount}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const currentFunds = parseFloat(portfolioFunds);
                            handleSetFunds((currentFunds + amount).toString());
                          }}
                          disabled={isAddingFunds}
                          className="hover:bg-green-500/10 hover:border-green-500/50"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          ${amount.toLocaleString()}
                        </Button>
                      ))}
                    </div>

                    {/* Custom Amount Input */}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="number"
                          placeholder="Enter custom amount"
                          value={addFundsAmount}
                          onChange={(e) => setAddFundsAmount(e.target.value)}
                          className="pl-9"
                          min="0"
                          step="100"
                        />
                      </div>
                      <Button 
                        onClick={handleAddFunds}
                        disabled={isAddingFunds || !addFundsAmount}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {isAddingFunds ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Funds
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Set Specific Balance */}
                    <div className="pt-4 border-t border-border">
                      <Label className="text-sm text-muted-foreground mb-2 block">Or set a specific balance:</Label>
                      <div className="flex flex-wrap gap-2">
                        {[10000, 25000, 50000, 100000, 500000, 1000000].map((amount) => (
                          <Button
                            key={amount}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetFunds(amount.toString())}
                            disabled={isAddingFunds}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            ${amount.toLocaleString()}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Info Note */}
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-blue-500">Note:</span> Paper trading balance is used for simulated trades only. 
                      The AI will use this balance for position sizing calculations in paper trading mode.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Auto Trading Toggle */}
            <Card className="p-6 bg-card/50 border-border">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Play className="w-5 h-5" />
                Auto Trading
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base">Enable Auto Trading</Label>
                    <p className="text-sm text-muted-foreground">
                      {autoTradingEnabled 
                        ? 'AI agents execute trades automatically based on their analysis' 
                        : 'AI agents generate signals but do not execute trades'}
                    </p>
                  </div>
                  <Switch 
                    checked={autoTradingEnabled}
                    onCheckedChange={handleAutoTradingToggle}
                  />
                </div>

                {autoTradingEnabled && (
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-green-500">Autonomous Trading Active</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          The AI agents will automatically execute trades 24/7/365. All position sizing, entry/exit timing, stop loss, and take profit decisions are made autonomously by the AI.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!autoTradingEnabled && (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-yellow-500">Signal-Only Mode</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          AI agents are analyzing the market and generating signals, but trades will not be executed automatically. Enable auto trading to allow the AI to trade autonomously.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* Notifications Settings */}
          <TabsContent value="notifications" className="space-y-6">
            <Card className="p-6 bg-card/50 border-border">
              <h3 className="text-xl font-semibold mb-4">Notification Preferences</h3>
              
              <div className="space-y-6">
                {/* Email Notifications */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base">Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive important updates via email
                    </p>
                  </div>
                  <Switch 
                    checked={notifications.emailNotifications}
                    onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, emailNotifications: checked }))}
                  />
                </div>

                {/* Trade Alerts */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base">Trade Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Get notified when trades are executed
                    </p>
                  </div>
                  <Switch 
                    checked={notifications.tradeAlerts}
                    onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, tradeAlerts: checked }))}
                  />
                </div>

                {/* Signal Alerts */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base">Signal Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Get notified when AI generates trading signals
                    </p>
                  </div>
                  <Switch 
                    checked={notifications.signalAlerts}
                    onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, signalAlerts: checked }))}
                  />
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Exchange Configuration */}
          <TabsContent value="advanced" className="space-y-6">
            <AdvancedSettingsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
