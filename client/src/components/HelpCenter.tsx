import { useState } from "react";
import { X, BookOpen, Keyboard, HelpCircle, Video, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpCenter({ isOpen, onClose }: HelpCenterProps) {
  const [activeTab, setActiveTab] = useState("quickstart");

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-background border border-white/10 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden animate-slideDown"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Help Center</h2>
              <p className="text-sm text-muted-foreground">
                Learn how to use SEER Trading Platform
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="border-b border-white/10 px-6">
            <TabsList className="w-full justify-start bg-transparent">
              <TabsTrigger value="quickstart" className="gap-2">
                <BookOpen className="w-4 h-4" />
                Quick Start
              </TabsTrigger>
              <TabsTrigger value="keyboard" className="gap-2">
                <Keyboard className="w-4 h-4" />
                Keyboard Shortcuts
              </TabsTrigger>
              <TabsTrigger value="faq" className="gap-2">
                <HelpCircle className="w-4 h-4" />
                FAQ
              </TabsTrigger>
              <TabsTrigger value="docs" className="gap-2">
                <FileText className="w-4 h-4" />
                Documentation
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(80vh-200px)]">
            {/* Quick Start Tab */}
            <TabsContent value="quickstart" className="space-y-6 mt-0">
              <div>
                <h3 className="text-lg font-semibold mb-3">Welcome to SEER! 🚀</h3>
                <p className="text-muted-foreground mb-4">
                  SEER is an AI-powered multi-exchange trading platform with institutional-grade
                  agents and strategy orchestration. Follow these steps to get started:
                </p>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-blue-400 font-bold">1</span>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">Configure Exchanges</h4>
                      <p className="text-sm text-muted-foreground">
                        Go to Settings → Add your exchange API keys (Binance, Bybit, OKX, etc.)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-purple-400 font-bold">2</span>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">Select Trading Symbols</h4>
                      <p className="text-sm text-muted-foreground">
                        Choose which trading pairs to monitor (BTC/USDT, ETH/USDT, etc.)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-green-400 font-bold">3</span>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">Enable Auto-Trading</h4>
                      <p className="text-sm text-muted-foreground">
                        Toggle Auto-Trade in Settings to let AI execute trades automatically
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-yellow-400 font-bold">4</span>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">Monitor Performance</h4>
                      <p className="text-sm text-muted-foreground">
                        View real-time signals, positions, and P&L on the Dashboard
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Video className="w-4 h-4" />
                  Video Tutorials
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Watch our video guides to learn advanced features:
                </p>
                <div className="space-y-2">
                  <a
                    href="#"
                    className="block text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    → Getting Started with SEER (5 min)
                  </a>
                  <a
                    href="#"
                    className="block text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    → Understanding AI Agents (10 min)
                  </a>
                  <a
                    href="#"
                    className="block text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    → Strategy Orchestration Deep Dive (15 min)
                  </a>
                </div>
              </div>
            </TabsContent>

            {/* Keyboard Shortcuts Tab */}
            <TabsContent value="keyboard" className="space-y-4 mt-0">
              <div>
                <h3 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h3>
                <p className="text-muted-foreground mb-4">
                  Use these shortcuts to navigate faster:
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Open Global Search</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    Cmd + K
                  </kbd>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Navigate Search Results</span>
                  <div className="flex gap-2">
                    <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                      ↑
                    </kbd>
                    <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                      ↓
                    </kbd>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Select Search Result</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    Enter
                  </kbd>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Close Modal</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    Esc
                  </kbd>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Go to Dashboard</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    G + D
                  </kbd>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Go to Agents</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    G + A
                  </kbd>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <span className="text-sm">Go to Settings</span>
                  <kbd className="px-3 py-1.5 bg-white/10 rounded border border-white/20 text-sm font-mono">
                    G + S
                  </kbd>
                </div>
              </div>
            </TabsContent>

            {/* FAQ Tab */}
            <TabsContent value="faq" className="space-y-4 mt-0">
              <div>
                <h3 className="text-lg font-semibold mb-3">Frequently Asked Questions</h3>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">What is SEER?</h4>
                  <p className="text-sm text-muted-foreground">
                    SEER is an AI-powered multi-exchange trading platform that uses institutional-grade
                    agents to analyze markets and execute strategies across multiple exchanges simultaneously.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">How do AI agents work?</h4>
                  <p className="text-sm text-muted-foreground">
                    Each agent specializes in a specific analysis type (technical, sentiment, on-chain, etc.).
                    They work together to provide comprehensive market insights and trading signals.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">Is my API key safe?</h4>
                  <p className="text-sm text-muted-foreground">
                    Yes! API keys are encrypted and stored securely. We recommend using read-only or
                    trade-only permissions (no withdrawal permissions) for maximum security.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">Can I trade on multiple exchanges?</h4>
                  <p className="text-sm text-muted-foreground">
                    Absolutely! SEER supports multi-exchange trading. You can configure Binance, Bybit,
                    OKX, and other exchanges simultaneously.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">What's the difference between signals and positions?</h4>
                  <p className="text-sm text-muted-foreground">
                    Signals are AI-generated recommendations (BULLISH, BEARISH, NEUTRAL). Positions are
                    actual trades executed based on those signals and your strategy settings.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                  <h4 className="font-semibold mb-2">How do I stop auto-trading?</h4>
                  <p className="text-sm text-muted-foreground">
                    Go to Settings and toggle off "Auto-Trade". This will stop automatic trade execution
                    but keep your existing positions open. You can still manually execute trades.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* Documentation Tab */}
            <TabsContent value="docs" className="space-y-4 mt-0">
              <div>
                <h3 className="text-lg font-semibold mb-3">Documentation</h3>
                <p className="text-muted-foreground mb-4">
                  Comprehensive guides and API references:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-400" />
                    Platform Overview
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Learn about SEER's architecture and features
                  </p>
                </a>

                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-purple-400" />
                    AI Agents Guide
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Deep dive into each agent's capabilities
                  </p>
                </a>

                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-green-400" />
                    Strategy Builder
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Create custom trading strategies
                  </p>
                </a>

                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-yellow-400" />
                    API Reference
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Integrate SEER with external tools
                  </p>
                </a>

                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-red-400" />
                    Risk Management
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Best practices for safe trading
                  </p>
                </a>

                <a
                  href="#"
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Troubleshooting
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Common issues and solutions
                  </p>
                </a>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/5">
          <p className="text-sm text-muted-foreground">
            Need more help? Contact support at{" "}
            <a href="mailto:support@seer.trading" className="text-blue-400 hover:text-blue-300">
              support@seer.trading
            </a>
          </p>
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
