import { Link } from "wouter";
import { 
  Brain, 
  Shield, 
  Zap, 
  TrendingUp, 
  Clock, 
  Eye,
  Activity,
  Lock,
  BarChart3,
  Target,
  Layers,
  RefreshCw,
  AlertTriangle,
  Cpu,
  LineChart,
  ArrowRight,
  Check,
  Sparkles,
  Users,
  Globe,
  PieChart,
  Gauge,
  Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs, GridOverlay } from "@/components/marketing/ParticleBackground";
import { WaitlistModal, useWaitlistModal } from "@/components/marketing/WaitlistModal";
import { cn } from "@/lib/utils";

const CORE_FEATURES = [
  {
    icon: Brain,
    title: "Multi-Agent Consensus System",
    description: "14 specialized AI agents analyze markets from different perspectives. Trades only execute when 70%+ weighted consensus is achieved, dramatically reducing false signals.",
    highlights: ["Weighted voting system", "Confidence scoring", "Signal validation"],
    gradient: "from-purple-500 to-purple-600"
  },
  {
    icon: Eye,
    title: "Real-Time Market Analysis",
    description: "Process thousands of data points per second including price action, order flow, sentiment, and on-chain metrics. Sub-50ms response time ensures you never miss an opportunity.",
    highlights: ["<50ms latency", "Multi-source data", "Pattern recognition"],
    gradient: "from-blue-500 to-blue-600"
  },
  {
    icon: Shield,
    title: "Institutional Risk Management",
    description: "Kelly Criterion position sizing, circuit breakers for consecutive losses, daily drawdown limits, and correlation-based position limits protect your capital.",
    highlights: ["Kelly Criterion sizing", "Circuit breakers", "Drawdown limits"],
    gradient: "from-cyan-500 to-cyan-600"
  },
  {
    icon: TrendingUp,
    title: "Layered Profit Targets",
    description: "Automated profit-taking strategy: 33% at +1%, 33% at +1.5%, and 34% runner with trailing stop. Breakeven stop activates after first target hit.",
    highlights: ["+1%, +1.5%, +2% targets", "Trailing stops", "Breakeven protection"],
    gradient: "from-green-500 to-green-600"
  },
  {
    icon: Activity,
    title: "Whale & Iceberg Detection",
    description: "Track large transactions and detect hidden institutional orders (iceberg orders) that move markets. Get alerts when whales accumulate or distribute.",
    highlights: ["Large tx monitoring", "Iceberg detection", "Smart money tracking"],
    gradient: "from-orange-500 to-orange-600"
  },
  {
    icon: BarChart3,
    title: "Performance Analytics",
    description: "Comprehensive trade journal with P&L attribution, Sharpe ratio, Sortino ratio, max drawdown analysis, and win/loss streak tracking.",
    highlights: ["Sharpe ratio", "Drawdown analysis", "Trade journal"],
    gradient: "from-pink-500 to-pink-600"
  },
  {
    icon: Clock,
    title: "24/7 Autonomous Operation",
    description: "SEER never sleeps. Our AI agents continuously monitor markets around the clock, executing trades and managing positions while you focus on what matters.",
    highlights: ["Non-stop monitoring", "Auto execution", "Position management"],
    gradient: "from-indigo-500 to-indigo-600"
  },
  {
    icon: Layers,
    title: "Paper & Live Trading Modes",
    description: "Test strategies risk-free in paper trading mode with simulated capital. When ready, seamlessly switch to live trading with your connected exchange.",
    highlights: ["Risk-free testing", "Strategy validation", "Seamless transition"],
    gradient: "from-teal-500 to-teal-600"
  }
];

const COMPARISON_DATA = [
  { feature: "24/7 Market Monitoring", paper: true, live: true },
  { feature: "Multi-Agent Analysis", paper: true, live: true },
  { feature: "Real-Time Signals", paper: true, live: true },
  { feature: "Risk Management", paper: true, live: true },
  { feature: "Performance Analytics", paper: true, live: true },
  { feature: "Simulated Execution", paper: true, live: false },
  { feature: "Real Capital Trading", paper: false, live: true },
  { feature: "Exchange Integration", paper: false, live: true },
  { feature: "Profit/Loss Realization", paper: false, live: true }
];

const COMPARISON_FEATURES = [
  { feature: "24/7 Trading", seer: true, manual: false, bots: "Limited" },
  { feature: "Multi-Agent Analysis", seer: true, manual: false, bots: false },
  { feature: "Institutional Risk Controls", seer: true, manual: "Manual", bots: "Basic" },
  { feature: "Whale Detection", seer: true, manual: false, bots: false },
  { feature: "Sentiment Analysis", seer: true, manual: "Limited", bots: false },
  { feature: "Paper Trading", seer: true, manual: true, bots: "Some" },
  { feature: "Performance Analytics", seer: true, manual: "Manual", bots: "Basic" },
  { feature: "Emotion-Free Trading", seer: true, manual: false, bots: true }
];

export default function Features() {
  const { isOpen, selectedPlan, openWaitlist, closeWaitlist } = useWaitlistModal();

  return (
    <MarketingLayout>
      <WaitlistModal isOpen={isOpen} onClose={closeWaitlist} selectedPlan={selectedPlan} />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-[#0f0a1e]" />
        <ParticleBackground particleCount={60} speed={0.15} />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8">
              <Sparkles className="h-4 w-4 text-purple-400 mr-2" />
              <span className="text-sm text-purple-300">Institutional-Grade Technology</span>
            </div>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6">
              <span className="text-white">Features Built for</span>
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Professional Traders
              </span>
            </h1>
            
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
              Every feature designed with the precision and reliability expected by institutional traders. 
              No compromises, no shortcuts.
            </p>

            <Button 
              size="lg"
              onClick={() => openWaitlist()}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-8 py-6 text-lg shadow-2xl shadow-purple-500/30"
            >
              Join the Waitlist
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a1e] via-[#0a0612] to-[#0f0a1e]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Core <span className="text-purple-400">Capabilities</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              A comprehensive suite of tools designed to give you an edge in the markets
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {CORE_FEATURES.map((feature, index) => (
              <div 
                key={index}
                className="group relative bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl p-8 hover:border-purple-500/30 transition-all duration-500"
              >
                <div className={cn(
                  "w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300",
                  feature.gradient
                )}>
                  <feature.icon className="h-8 w-8 text-white" />
                </div>
                
                <h3 className="text-2xl font-bold text-white mb-4">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed mb-6">{feature.description}</p>
                
                <div className="flex flex-wrap gap-2">
                  {feature.highlights.map((highlight, i) => (
                    <span 
                      key={i}
                      className="px-3 py-1 text-sm bg-white/5 border border-white/10 rounded-full text-gray-300"
                    >
                      {highlight}
                    </span>
                  ))}
                </div>
                
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/0 to-blue-500/0 group-hover:from-purple-500/5 group-hover:to-blue-500/5 transition-all duration-500 pointer-events-none" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Paper vs Live Comparison */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Paper vs <span className="text-cyan-400">Live Trading</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Start risk-free, transition seamlessly to live trading when you're ready
            </p>
          </div>

          <div className="bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-3 bg-white/5 p-4 border-b border-white/10">
              <div className="text-gray-400 font-medium">Feature</div>
              <div className="text-center text-purple-400 font-medium">Paper Trading</div>
              <div className="text-center text-cyan-400 font-medium">Live Trading</div>
            </div>
            
            {COMPARISON_DATA.map((row, index) => (
              <div 
                key={index}
                className={cn(
                  "grid grid-cols-3 p-4",
                  index !== COMPARISON_DATA.length - 1 && "border-b border-white/5"
                )}
              >
                <div className="text-gray-300">{row.feature}</div>
                <div className="text-center">
                  {row.paper ? (
                    <Check className="h-5 w-5 text-green-400 mx-auto" />
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
                <div className="text-center">
                  {row.live ? (
                    <Check className="h-5 w-5 text-green-400 mx-auto" />
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose SEER Comparison */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] via-[#0f0a1e] to-[#0a0612]" />
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Why Choose <span className="text-purple-400">SEER</span>?
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              See how we compare to manual trading and traditional trading bots
            </p>
          </div>

          <div className="bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 bg-white/5 p-4 border-b border-white/10">
              <div className="text-gray-400 font-medium">Feature</div>
              <div className="text-center text-purple-400 font-medium">SEER</div>
              <div className="text-center text-gray-400 font-medium">Manual</div>
              <div className="text-center text-gray-400 font-medium">Bots</div>
            </div>
            
            {COMPARISON_FEATURES.map((row, index) => (
              <div 
                key={index}
                className={cn(
                  "grid grid-cols-4 p-4",
                  index !== COMPARISON_FEATURES.length - 1 && "border-b border-white/5"
                )}
              >
                <div className="text-gray-300">{row.feature}</div>
                <div className="text-center">
                  {row.seer === true ? (
                    <Check className="h-5 w-5 text-green-400 mx-auto" />
                  ) : (
                    <span className="text-gray-400">{row.seer}</span>
                  )}
                </div>
                <div className="text-center">
                  {row.manual === true ? (
                    <Check className="h-5 w-5 text-green-400 mx-auto" />
                  ) : row.manual === false ? (
                    <span className="text-gray-600">—</span>
                  ) : (
                    <span className="text-gray-400 text-sm">{row.manual}</span>
                  )}
                </div>
                <div className="text-center">
                  {row.bots === true ? (
                    <Check className="h-5 w-5 text-green-400 mx-auto" />
                  ) : row.bots === false ? (
                    <span className="text-gray-600">—</span>
                  ) : (
                    <span className="text-gray-400 text-sm">{row.bots}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Risk Management Deep Dive */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Risk Management <span className="text-red-400">That Protects</span>
              </h2>
              <p className="text-xl text-gray-400 mb-8 leading-relaxed">
                Capital preservation is our top priority. Multiple layers of protection ensure your portfolio survives market volatility.
              </p>
              
              <div className="space-y-6">
                {[
                  { icon: Target, title: "Kelly Criterion Sizing", description: "Optimal position sizing based on win rate and payoff ratio" },
                  { icon: AlertTriangle, title: "Circuit Breakers", description: "Auto-pause after 3 consecutive losses per symbol or 5 global" },
                  { icon: RefreshCw, title: "Daily Drawdown Limit", description: "Trading halts at -10% daily loss, resets at midnight" },
                  { icon: Layers, title: "Position Limits", description: "Maximum 3 concurrent positions to prevent over-exposure" }
                ].map((item, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                      <item.icon className="h-6 w-6 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 to-orange-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-3xl p-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <span className="text-gray-400">Daily Drawdown</span>
                    <span className="text-green-400 font-mono">-2.3%</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <span className="text-gray-400">Open Positions</span>
                    <span className="text-white font-mono">2 / 3</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <span className="text-gray-400">Circuit Breaker</span>
                    <span className="text-green-400 font-mono">INACTIVE</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                    <span className="text-gray-400">Kelly Fraction</span>
                    <span className="text-purple-400 font-mono">0.25x</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-[#0f0a1e] to-blue-900/30" />
        <ParticleBackground particleCount={40} speed={0.1} />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Experience the <span className="text-cyan-400">Difference</span>
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the waitlist and be among the first to trade with institutional-grade AI technology.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg"
              onClick={() => openWaitlist()}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-8 py-6 text-lg shadow-2xl shadow-purple-500/30"
            >
              Join the Waitlist
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Link href="/ai-agents">
              <Button 
                size="lg"
                variant="outline"
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 px-8 py-6 text-lg"
              >
                Meet the AI Agents
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
