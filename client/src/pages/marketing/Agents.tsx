import { Link } from "wouter";
import { 
  Brain, 
  TrendingUp, 
  Activity, 
  Globe, 
  Newspaper, 
  BarChart3, 
  Waves,
  Eye,
  Cpu,
  LineChart,
  ArrowRight,
  Sparkles,
  Zap,
  Target,
  Network,
  GitBranch,
  Shield,
  DollarSign,
  Flame
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs, GridOverlay } from "@/components/marketing/ParticleBackground";
import { WaitlistModal, useWaitlistModal } from "@/components/marketing/WaitlistModal";
import { cn } from "@/lib/utils";

const AI_AGENTS = [
  {
    id: 1,
    name: "Sentiment Analyst",
    icon: Brain,
    description: "Analyzes social media, news sentiment, and market psychology using advanced NLP and Z-score models to detect shifts in market mood.",
    capabilities: ["Social media analysis", "News sentiment scoring", "Fear/Greed detection", "Z-score normalization"],
    gradient: "from-purple-500 to-purple-600",
    weight: "15%"
  },
  {
    id: 2,
    name: "Technical Analyst",
    icon: LineChart,
    description: "Multi-timeframe technical analysis with dynamic threshold calibration. Identifies patterns, support/resistance, and momentum signals.",
    capabilities: ["Multi-timeframe analysis", "Pattern recognition", "Support/Resistance", "Momentum indicators"],
    gradient: "from-blue-500 to-blue-600",
    weight: "20%"
  },
  {
    id: 3,
    name: "Macro Analyst",
    icon: Globe,
    description: "Monitors global macro factors including VIX, DXY, interest rates, and market regime detection for broader context.",
    capabilities: ["VIX correlation", "DXY tracking", "Regime detection", "Risk-on/Risk-off"],
    gradient: "from-cyan-500 to-cyan-600",
    weight: "10%"
  },
  {
    id: 4,
    name: "News Sentinel",
    icon: Newspaper,
    description: "Real-time news monitoring with balanced NLP scoring. Detects market-moving events and filters noise from signal.",
    capabilities: ["Breaking news alerts", "Event classification", "Impact scoring", "Source credibility"],
    gradient: "from-green-500 to-green-600",
    weight: "10%"
  },
  {
    id: 5,
    name: "Funding Rate Analyst",
    icon: DollarSign,
    description: "Multi-exchange funding rate analysis with fallback mechanisms. Identifies crowded trades and potential squeeze setups.",
    capabilities: ["Multi-exchange data", "Crowded trade detection", "Squeeze probability", "Historical comparison"],
    gradient: "from-yellow-500 to-yellow-600",
    weight: "8%"
  },
  {
    id: 6,
    name: "Liquidation Heatmap",
    icon: Flame,
    description: "Tracks liquidation levels across exchanges to identify price magnets and potential cascade zones.",
    capabilities: ["Liquidation clusters", "Price magnets", "Cascade prediction", "Volume analysis"],
    gradient: "from-orange-500 to-orange-600",
    weight: "8%"
  },
  {
    id: 7,
    name: "Whale Tracker",
    icon: Eye,
    description: "Monitors large transactions and detects iceberg orders. Tracks smart money accumulation and distribution patterns.",
    capabilities: ["Large tx monitoring", "Iceberg detection", "Accumulation/Distribution", "Smart money flow"],
    gradient: "from-red-500 to-red-600",
    weight: "12%"
  },
  {
    id: 8,
    name: "On-Chain Flow Analyst",
    icon: GitBranch,
    description: "Analyzes blockchain data including exchange flows, whale wallets, and on-chain metrics for fundamental signals.",
    capabilities: ["Exchange inflow/outflow", "Whale wallet tracking", "MVRV ratio", "Network activity"],
    gradient: "from-pink-500 to-pink-600",
    weight: "7%"
  },
  {
    id: 9,
    name: "ML Prediction Agent",
    icon: Cpu,
    description: "LSTM neural network model trained on historical data to predict short-term price movements and volatility.",
    capabilities: ["LSTM predictions", "Volatility forecast", "Trend probability", "Confidence scoring"],
    gradient: "from-indigo-500 to-indigo-600",
    weight: "5%"
  },
  {
    id: 10,
    name: "Order Flow Analyst",
    icon: TrendingUp,
    description: "Real-time order book analysis detecting large orders, spoofing attempts, and market maker positioning.",
    capabilities: ["Order book depth", "Large order detection", "Spoofing alerts", "Market maker tracking"],
    gradient: "from-teal-500 to-teal-600",
    weight: "3%"
  },
  {
    id: 11,
    name: "Risk Manager",
    icon: Shield,
    description: "Implements Kelly Criterion position sizing with circuit breakers and correlation limits for capital protection.",
    capabilities: ["Kelly Criterion sizing", "Circuit breakers", "Drawdown limits", "Correlation limits"],
    gradient: "from-violet-500 to-violet-600",
    weight: "2%"
  },
  {
    id: 12,
    name: "Volume Profile Analyzer",
    icon: BarChart3,
    description: "Analyzes volume distribution across price levels to identify high-volume nodes, value areas, and point of control for optimal entries.",
    capabilities: ["Volume at price", "Value area detection", "Point of control", "Volume imbalance"],
    gradient: "from-emerald-500 to-emerald-600",
    weight: "3%"
  },
  {
    id: 13,
    name: "On-Chain Flow Analyst",
    icon: Network,
    description: "Tracks real-time exchange inflows/outflows, stablecoin movements, and smart contract interactions to detect institutional positioning.",
    capabilities: ["Exchange flow tracking", "Stablecoin monitoring", "Smart contract analysis", "Institutional flow"],
    gradient: "from-rose-500 to-rose-600",
    weight: "2%"
  },
  {
    id: 14,
    name: "Forex Correlation Agent",
    icon: TrendingUp,
    description: "Monitors DXY, EUR/USD, and major forex pairs to detect cross-market correlations that historically precede crypto price movements.",
    capabilities: ["DXY correlation tracking", "Forex pair analysis", "Cross-market signals", "Currency strength index"],
    gradient: "from-sky-500 to-sky-600",
    weight: "2%"
  }
];

export default function Agents() {
  const { isOpen, selectedPlan, openWaitlist, closeWaitlist } = useWaitlistModal();

  return (
    <MarketingLayout>
      <WaitlistModal isOpen={isOpen} onClose={closeWaitlist} selectedPlan={selectedPlan} />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-[#0f0a1e]" />
        <ParticleBackground particleCount={80} speed={0.2} />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8">
              <Brain className="h-4 w-4 text-purple-400 mr-2" />
              <span className="text-sm text-purple-300">14 Specialized AI Agents</span>
            </div>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6">
              <span className="text-white">Meet Your</span>
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                AI Trading Team
              </span>
            </h1>
            
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
              Each agent specializes in a unique aspect of market analysis. Together, they form a 
              comprehensive intelligence network that never sleeps.
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

      {/* Consensus System Explanation */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a1e] to-[#0a0612]" />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Multi-Agent <span className="text-purple-400">Consensus</span>
              </h2>
              <p className="text-xl text-gray-400 mb-8 leading-relaxed">
                Unlike single-strategy systems, SEER requires agreement from multiple specialized agents 
                before executing any trade. This dramatically reduces false signals and improves accuracy.
              </p>
              
              <div className="space-y-6">
                {[
                  { icon: Target, title: "70% Weighted Consensus", description: "Trades only execute when weighted agent agreement exceeds 70%" },
                  { icon: Network, title: "3+ Agent Confirmation", description: "Minimum 3 agents must agree on direction before entry" },
                  { icon: Activity, title: "Cross-Validation", description: "Agents validate each other's signals to eliminate bias" }
                ].map((item, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <item.icon className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Diagram */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-3xl p-8">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 mb-4">
                    <Brain className="h-10 w-10 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Consensus Engine</h3>
                  <p className="text-gray-400 text-sm">Aggregates all agent signals</p>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  {AI_AGENTS.slice(0, 6).map((agent, index) => (
                    <div key={index} className="text-center p-3 bg-white/5 rounded-xl">
                      <div className={cn(
                        "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center mx-auto mb-2",
                        agent.gradient
                      )}>
                        <agent.icon className="h-5 w-5 text-white" />
                      </div>
                      <p className="text-xs text-gray-400 truncate">{agent.name.split(' ')[0]}</p>
                      <p className="text-xs text-purple-400 font-mono">{agent.weight}</p>
                    </div>
                  ))}
                </div>
                
                <div className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
                  <p className="text-green-400 font-semibold">Signal: LONG BTC</p>
                  <p className="text-gray-400 text-sm">Consensus: 78.5% | 11/14 agents agree</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* All Agents Grid */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              The <span className="text-cyan-400">Agent Network</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Each agent brings unique expertise to the trading decision process
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {AI_AGENTS.map((agent) => (
              <div 
                key={agent.id}
                className="group relative bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl p-6 hover:border-purple-500/30 transition-all duration-500"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    "w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center group-hover:scale-110 transition-transform duration-300",
                    agent.gradient
                  )}>
                    <agent.icon className="h-7 w-7 text-white" />
                  </div>
                  <span className="px-3 py-1 text-sm bg-white/5 border border-white/10 rounded-full text-purple-400 font-mono">
                    {agent.weight}
                  </span>
                </div>
                
                <h3 className="text-xl font-bold text-white mb-2">{agent.name}</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">{agent.description}</p>
                
                {/* Capabilities */}
                <div className="flex flex-wrap gap-2">
                  {agent.capabilities.slice(0, 3).map((cap, i) => (
                    <span 
                      key={i}
                      className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-300"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
                
                {/* Hover glow */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/0 to-blue-500/0 group-hover:from-purple-500/5 group-hover:to-blue-500/5 transition-all duration-500 pointer-events-none" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How Agents Work Together */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] via-[#0f0a1e] to-[#0a0612]" />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              How Agents <span className="text-purple-400">Collaborate</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              A seamless workflow from market analysis to trade execution
            </p>
          </div>

          <div className="space-y-8">
            {[
              { step: 1, title: "Data Collection", description: "Each agent continuously monitors its specialized data sources - social media, order books, blockchain, news feeds, and more.", icon: Activity },
              { step: 2, title: "Independent Analysis", description: "Agents analyze data independently using their specialized algorithms, generating confidence scores and directional signals.", icon: Brain },
              { step: 3, title: "Signal Aggregation", description: "The consensus engine collects all agent signals, applying weighted voting based on each agent's historical accuracy.", icon: Network },
              { step: 4, title: "Consensus Check", description: "If weighted consensus exceeds 70% and 3+ agents agree, the signal passes to the entry validation system.", icon: Target },
              { step: 5, title: "Trade Execution", description: "Validated signals trigger automated trade execution with institutional-grade risk management and position sizing.", icon: Zap }
            ].map((item, index) => (
              <div key={index} className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                    {item.step}
                  </div>
                </div>
                <div className="flex-1 bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <item.icon className="h-5 w-5 text-purple-400" />
                    <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                  </div>
                  <p className="text-gray-400">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-[#0f0a1e] to-blue-900/30" />
        <ParticleBackground particleCount={40} speed={0.1} />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Ready to Trade with <span className="text-cyan-400">AI Power</span>?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the waitlist and let 14 specialized AI agents work for you around the clock.
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
            <Link href="/pricing">
              <Button 
                size="lg"
                variant="outline"
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 px-8 py-6 text-lg"
              >
                View Pricing
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
