/**
 * SEER Navigation - Institutional Grade
 * 
 * Premium header design with real-time portfolio metrics.
 * Clean, sophisticated typography matching hedge fund platforms.
 * 
 * Uses centralized PositionContext for consistent position data across the app.
 */

import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Activity,
  Settings,
  TrendingUp,
  TrendingDown,
  Menu,
  X,
  Wallet,
  Search,
  Bell,
  HelpCircle,
  LogOut,
  Target,
  ChevronDown,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { SeerIcon } from "@/components/marketing/SeerLogo";
import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSocketIOMulti } from "@/hooks/useSocketIOMulti";
import { GlobalSearch } from "./GlobalSearch";
import { HelpCenter } from "./HelpCenter";
import { trpc } from "@/lib/trpc";
import { usePositions } from "@/contexts/PositionContext";
import { Badge } from "@/components/ui/badge";

import { HeartPulse, Brain, BookOpen, MoreHorizontal, Shield, Crosshair, Fish, ClipboardList, FlaskConical, Zap, Gauge, Heart, Trophy, Receipt } from "lucide-react";

// Primary navigation items - always visible in header
const primaryNavItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/agents", label: "Agents", icon: Activity },
  { path: "/agent-scorecard", label: "Scorecard", icon: Trophy },
  { path: "/strategy", label: "Strategy", icon: Target },
  { path: "/positions", label: "Positions", icon: Wallet },
  { path: "/performance", label: "Performance", icon: TrendingUp },
  { path: "/wallet", label: "Wallet", icon: Receipt },
];

// Phase 74: Trimmed "More" dropdown — only operational/decision-making pages.
// Removed info-dump duplicates (Signals/Patterns/Whale-Alerts duplicate the
// Agents/Dashboard panels), backtest/journal/ML tools (admin-only, accessed
// via deep links when needed), and Regime Intelligence (info already on
// Dashboard ribbon). Routes still exist — only the nav clutter is removed.
const moreNavItems = [
  { path: "/order-history", label: "Order History", icon: ClipboardList },
  { path: "/risk-dashboard", label: "Risk Management", icon: Shield },
  { path: "/system", label: "System Health", icon: Heart },
];

// Combined for mobile menu
const navItems = [...primaryNavItems, ...moreNavItems];

export function Navigation() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Get real-time data from WebSocket for connection status only
  const { tradingStats, connected, connect, priceUpdates } = useSocketIOMulti(user?.id);
  
  // ARCHITECTURE: The SEER engine runs 24/7/365 on the server, independent of user sessions
  // The frontend is JUST a display layer - it shows what's already running on the server
  // We should show "Live" immediately based on SERVER engine status, not frontend WebSocket
  
  // Get server engine status - this is the SOURCE OF TRUTH for system status
  // The server's WebSocket to exchanges is always connected, regardless of frontend
  const { data: engineStatus, isLoading: engineStatusLoading } = trpc.seerMulti.getStatus.useQuery(undefined, {
    enabled: !!user,
    staleTime: 2000, // Cache for 2 seconds
    refetchInterval: 5000, // Refresh every 5 seconds
  });
  
  // CRITICAL: Show "Live" based on SERVER engine status, not frontend WebSocket
  // The server is always running and connected to exchanges - frontend WebSocket is just for UI updates
  // Default to true while loading to prevent "Connecting..." flash (server is always running)
  const isEffectivelyConnected = engineStatusLoading ? true : (engineStatus?.isRunning ?? true);

  // Use centralized position context - SINGLE SOURCE OF TRUTH
  const { positions, totalPnL, openPositionCount, isLoading: positionsLoading } = usePositions();

  // Fetch trading mode configuration
  const { data: tradingModeConfig } = trpc.settings.getTradingMode.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 25000,
    enabled: !!user,
  });

  // Phase 74: Derive isPaper from the user's actual tradingModeConfig.
  // Previously this was hardcoded `isPaper: true`, which caused the header
  // win-rate/stats to always come from the (stale) paper wallet even when
  // the user was actively trading live — producing the mismatch between
  // header stats and the live positions on the same page.
  const isPaperMode = tradingModeConfig?.mode !== 'real';

  // Fetch order history analytics for accurate win rate from closed trades
  const { data: orderAnalytics } = trpc.orderHistory.getAnalytics.useQuery(
    { isPaper: isPaperMode },
    {
      refetchInterval: 10000, // Refresh every 10 seconds
      staleTime: 8000,
      enabled: !!user && tradingModeConfig !== undefined,
    }
  );

  // Calculate portfolio metrics using centralized position data
  const portfolioMetrics = {
    totalPnL: totalPnL,
    totalPnLPercent: 0,
    openPositions: openPositionCount,
    winRate: orderAnalytics?.winRate ?? tradingStats?.winRate ?? 0,
    totalTrades: orderAnalytics?.totalTrades ?? 0,
  };

  // Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isPathActive = (path: string) => location === path;

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (absValue >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 bg-white/95 dark:bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-slate-200 dark:border-gray-800/50">
        <div className="w-full px-6 py-2.5">
          <div className="flex items-center justify-between">
            
            {/* Left: Logo + Nav Links */}
            <div className="flex items-center gap-8">
              {/* Logo */}
              <Link href="/agents" className="flex items-center gap-3 group">
                <SeerIcon size={36} />
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">SEER</span>
                  <span className="text-[10px] text-slate-500 dark:text-gray-500 -mt-0.5 tracking-wider">AUTONOMOUS TRADING</span>
                </div>
              </Link>

              {/* Nav Links */}
              <div className="flex items-center gap-1">
                {primaryNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isPathActive(item.path);
                  
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-slate-200 text-slate-900 dark:bg-white/10 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                {/* More Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        moreNavItems.some(item => isPathActive(item.path))
                          ? "bg-slate-200 text-slate-900 dark:bg-white/10 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                      )}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                      <span>More</span>
                      <ChevronDown className="w-3 h-3 ml-0.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 bg-white border-slate-200 dark:bg-gray-900 dark:border-gray-800">
                    {moreNavItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = isPathActive(item.path);
                      return (
                        <DropdownMenuItem key={item.path} asChild>
                          <Link
                            href={item.path}
                            className={cn(
                              "flex items-center gap-3 cursor-pointer",
                              isActive ? "text-slate-900 bg-slate-200 dark:text-white dark:bg-white/10" : "text-slate-700 dark:text-gray-300"
                            )}
                          >
                            <Icon className={cn("w-4 h-4", isActive ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-gray-500")} />
                            <span>{item.label}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Right: Metrics + Actions + Profile */}
            <div className="flex items-center gap-4">
              
              {/* Portfolio Metrics - Compact Display */}
              <div className="flex items-center gap-3 px-4 py-1.5 rounded-xl bg-slate-100 border border-slate-200 dark:bg-gray-900/50 dark:border-gray-800/50">
                {/* P&L */}
                <div className="flex items-center gap-2">
                  {portfolioMetrics.totalPnL >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-400" />
                  )}
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-sm font-bold font-mono",
                      portfolioMetrics.totalPnL >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {portfolioMetrics.totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolioMetrics.totalPnL)}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-gray-500">Unrealized P&L</span>
                  </div>
                </div>

                <div className="w-px h-8 bg-slate-300 dark:bg-gray-700/50" />

                {/* Open Positions - from centralized context */}
                <div className="flex flex-col items-center">
                  <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                    {positionsLoading ? '...' : portfolioMetrics.openPositions}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-gray-500">Positions</span>
                </div>

                <div className="w-px h-8 bg-slate-300 dark:bg-gray-700/50" />

                {/* Win Rate */}
                <div className="flex flex-col items-center">
                  <span className={cn(
                    "text-sm font-bold font-mono",
                    portfolioMetrics.winRate >= 50 ? "text-green-500 dark:text-green-400" : "text-yellow-500 dark:text-yellow-400"
                  )}>
                    {portfolioMetrics.winRate}%
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-gray-500">Win Rate</span>
                </div>
              </div>

              {/* Trade Mode & Auto-Trade Indicator */}
              <Link href="/settings">
                <div className="flex items-center gap-2 cursor-pointer transition-all hover:scale-105">
                  {/* Show only active trading mode - simplified header */}
                  {/* Trading Mode Badge */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    {tradingModeConfig?.mode === 'real' ? 'LIVE TRADING' : 'PAPER TRADING'}
                  </div>
                  {/* Paper/Live Mode indicator - only show when in Live mode for warning */}
                  {tradingModeConfig?.mode === 'real' && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/40 shadow-lg shadow-red-500/10">
                      <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                      LIVE
                    </div>
                  )}
                </div>
              </Link>

              {/* Engine Status - CRITICAL FIX: Use isEffectivelyConnected for better reliability */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium",
                isEffectivelyConnected 
                  ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                  : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
              )}>
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isEffectivelyConnected ? "bg-green-400 animate-pulse" : "bg-yellow-400"
                )} />
                {isEffectivelyConnected ? 'Live' : 'Connecting'}
              </div>

              {/* Search */}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                onClick={() => setSearchOpen(true)}
                title="Search (Cmd+K)"
              >
                <Search className="w-4 h-4" />
              </Button>

              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5 relative"
                  >
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 bg-gray-900 border-gray-800">
                  <DropdownMenuLabel className="text-slate-600 dark:text-gray-400">Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-200 dark:bg-gray-800" />
                  <div className="p-4 text-sm text-slate-500 dark:text-gray-500 text-center">
                    No new notifications
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Theme toggle */}
              {toggleTheme && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                  onClick={toggleTheme}
                  title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              )}

              {/* Help */}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle className="w-4 h-4" />
              </Button>

              {/* Profile */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
                  >
                    <Avatar className="h-8 w-8 border border-slate-300 dark:border-gray-700">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm">
                        {user?.name?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <ChevronDown className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white border-slate-200 dark:bg-gray-900 dark:border-gray-800">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.name || 'User'}</p>
                      <p className="text-xs text-slate-500 dark:text-gray-400">{user?.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-200 dark:bg-gray-800" />
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-200 dark:bg-gray-800" />
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-red-500 dark:text-red-400 focus:text-red-500 dark:focus:text-red-400"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white/95 dark:bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-slate-200 dark:border-gray-800/50">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/agents" className="flex items-center gap-2">
              <SeerIcon size={32} />
              <span className="text-lg font-bold text-slate-900 dark:text-white">SEER</span>
            </Link>

            {/* Trade Mode Badge - Mobile - Show only active mode */}
            <Link href="/settings" className="flex items-center gap-1">
              {/* Trading Mode Badge - Mobile */}
              <div className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/40">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {tradingModeConfig?.mode === 'real' ? 'LIVE' : 'PAPER'}
              </div>
              {tradingModeConfig?.mode === 'real' && (
                <div className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/40">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  LIVE
                </div>
              )}
            </Link>

            <div className="flex items-center gap-1">
              {/* Theme toggle (mobile) */}
              {toggleTheme && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </Button>
              )}

              {/* Mobile Menu Toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="mt-4 pb-4 space-y-2">
              {/* Portfolio Summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-100 border border-slate-200 dark:bg-gray-900/50 dark:border-gray-800/50 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-gray-400">P&L</span>
                  <span className={cn(
                    "text-sm font-bold font-mono",
                    portfolioMetrics.totalPnL >= 0 ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400"
                  )}>
                    {portfolioMetrics.totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolioMetrics.totalPnL)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-gray-400">Open</span>
                  <span className="font-bold text-slate-900 dark:text-white">{portfolioMetrics.openPositions}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 dark:text-gray-400">Win</span>
                  <span className={cn(
                    "font-bold",
                    portfolioMetrics.winRate >= 50 ? "text-green-500 dark:text-green-400" : "text-yellow-500 dark:text-yellow-400"
                  )}>
                    {portfolioMetrics.winRate}%
                  </span>
                </div>
              </div>

              {/* Nav Links */}
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isPathActive(item.path);
                
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[40px]",
                      isActive
                        ? "bg-slate-200 text-slate-900 dark:bg-white/10 dark:text-white"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              <div className="border-t border-slate-200 dark:border-gray-800 pt-4 mt-4">
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/5 min-h-[40px]"
                >
                  <Settings className="w-5 h-5" />
                  <span>Settings</span>
                </Link>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-500/10 min-h-[40px]"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Spacer for fixed nav */}
      <div className="h-16" />

      {/* Global Search Modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Help Center Modal */}
      <HelpCenter isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
