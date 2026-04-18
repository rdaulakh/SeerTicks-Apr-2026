import { Link } from "wouter";
import { 
  ArrowRight, 
  Target,
  Lightbulb,
  Shield,
  Zap,
  Users,
  Globe,
  Rocket,
  CheckCircle2,
  Brain,
  LineChart,
  Building2,
  TrendingUp,
  Coins,
  BarChart3,
  Sparkles,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs, GridOverlay } from "@/components/marketing/ParticleBackground";
import { WaitlistModal, useWaitlistModal } from "@/components/marketing/WaitlistModal";
import { cn } from "@/lib/utils";

const VALUES = [
  {
    icon: Target,
    title: "Precision",
    description: "Every decision is backed by data. We don't guess—we analyze, validate, and execute with surgical precision."
  },
  {
    icon: Shield,
    title: "Security First",
    description: "Your capital stays on your exchange. We never hold funds. API keys are encrypted with military-grade security."
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    description: "We push the boundaries of what's possible with AI in trading. Continuous improvement is in our DNA."
  },
  {
    icon: Users,
    title: "Transparency",
    description: "No black boxes. Every trade decision is explainable. You see exactly why each trade was made."
  }
];

const VISION_ROADMAP = [
  {
    icon: Coins,
    title: "Cryptocurrency Mastery",
    status: "live",
    description: "Where we are today",
    details: "Our 14 AI agents are already analyzing crypto markets 24/7, executing trades with institutional-grade precision. Bitcoin, Ethereum, and major altcoins are just the beginning.",
    highlight: "Currently Live"
  },
  {
    icon: TrendingUp,
    title: "Forex Markets",
    status: "next",
    description: "Coming Soon",
    details: "The $7.5 trillion daily forex market is next. Our AI agents will analyze currency pairs, central bank policies, and macroeconomic indicators to capture opportunities across EUR/USD, GBP/JPY, and more.",
    highlight: "Next Frontier"
  },
  {
    icon: BarChart3,
    title: "US Stock Markets",
    status: "future",
    description: "On the Horizon",
    details: "NASDAQ, NYSE, S&P 500—the world's largest equity markets. SEER will bring the same multi-agent intelligence to stocks, analyzing earnings, sentiment, and technical patterns.",
    highlight: "Expanding Soon"
  },
  {
    icon: Globe,
    title: "Global Markets",
    status: "future",
    description: "The Vision",
    details: "From Tokyo to London, Frankfurt to Hong Kong. Every major market, every asset class. One unified AI trading platform that never sleeps, analyzing opportunities worldwide.",
    highlight: "Global Domination"
  }
];

const UPCOMING_FEATURES = [
  {
    title: "Mobile Trading App",
    description: "Monitor your portfolio and receive real-time alerts from anywhere in the world."
  },
  {
    title: "Custom Agent Training",
    description: "Train AI agents on your specific trading strategies and risk preferences."
  },
  {
    title: "Social Trading",
    description: "Follow top-performing strategies and share insights with the SEER community."
  },
  {
    title: "Institutional API",
    description: "Enterprise-grade API access for funds, family offices, and trading desks."
  },
  {
    title: "Advanced Analytics",
    description: "Deep dive into your performance with institutional-level reporting and insights."
  },
  {
    title: "Multi-Exchange Arbitrage",
    description: "Capture price discrepancies across exchanges automatically."
  }
];

const STATS = [
  { value: "13", label: "AI Agents", suffix: "" },
  { value: "24", label: "Hours/Day", suffix: "/7" },
  { value: "100", label: "Signals/Day", suffix: "+" },
  { value: "2025", label: "Founded", suffix: "" }
];

export default function About() {
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
              <Building2 className="h-4 w-4 text-purple-400 mr-2" />
              <span className="text-sm text-purple-300">About SEER</span>
            </div>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6">
              <span className="text-white">Building the Future of</span>
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Autonomous Trading
              </span>
            </h1>
            
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              We're on a mission to democratize institutional-grade trading technology, 
              making AI-powered trading accessible to everyone.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative py-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a1e] to-[#0a0612]" />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-5xl sm:text-6xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                  {stat.value}{stat.suffix}
                </div>
                <div className="text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Story Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Our <span className="text-purple-400">Story</span>
              </h2>
              <div className="space-y-6 text-gray-400 text-lg leading-relaxed">
                <p>
                  SEER was born in early 2025 from a simple observation: the best traders don't rely on 
                  a single indicator or strategy. They synthesize information from multiple sources—technical 
                  analysis, sentiment, on-chain data, macro trends—to make informed decisions.
                </p>
                <p>
                  We asked ourselves: what if we could build an AI system that does the same thing, but 
                  faster, more consistently, and without the emotional biases that plague human traders?
                </p>
                <p>
                  The result is SEER—a multi-agent AI system where 14 specialized agents work together, 
                  each contributing their unique expertise to form a consensus before any trade is executed. 
                  It's like having a team of expert analysts working for you 24/7.
                </p>
              </div>
            </div>

            {/* Visual Element */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-3xl p-8">
                <div className="grid grid-cols-3 gap-4">
                  {[Brain, LineChart, Shield, Globe, Zap, Target].map((Icon, index) => (
                    <div 
                      key={index}
                      className="aspect-square bg-white/5 rounded-xl flex items-center justify-center border border-white/10"
                    >
                      <Icon className="h-8 w-8 text-purple-400" />
                    </div>
                  ))}
                </div>
                <div className="mt-6 p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl text-center">
                  <p className="text-purple-300 font-medium">Multi-Agent Consensus</p>
                  <p className="text-gray-400 text-sm">11 experts, 1 decision</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] via-[#0f0a1e] to-[#0a0612]" />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Our <span className="text-cyan-400">Values</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              The principles that guide everything we build
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {VALUES.map((value, index) => (
              <div 
                key={index}
                className="group bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl p-6 hover:border-purple-500/30 transition-all duration-500"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <value.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{value.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vision Roadmap Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 mb-6">
              <Rocket className="h-4 w-4 text-cyan-400 mr-2" />
              <span className="text-sm text-cyan-300">What's Next</span>
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              The <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">Future</span> of Trading
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Crypto is just the beginning. We're building the world's most intelligent trading platform—one that will eventually trade every market, every asset class, everywhere.
            </p>
          </div>

          {/* Vision Cards */}
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            {VISION_ROADMAP.map((item, index) => (
              <div 
                key={index}
                className={cn(
                  "relative group rounded-3xl p-8 transition-all duration-500",
                  item.status === "live" 
                    ? "bg-gradient-to-br from-green-500/20 to-green-500/5 border-2 border-green-500/50" 
                    : item.status === "next"
                    ? "bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-2 border-purple-500/50"
                    : "bg-gradient-to-br from-white/10 to-white/5 border border-white/10 hover:border-white/20"
                )}
              >
                {/* Status Badge */}
                <div className={cn(
                  "absolute -top-3 right-8 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                  item.status === "live" 
                    ? "bg-green-500 text-white" 
                    : item.status === "next"
                    ? "bg-purple-500 text-white"
                    : "bg-white/10 text-gray-400"
                )}>
                  {item.highlight}
                </div>

                <div className="flex items-start gap-6">
                  <div className={cn(
                    "flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center",
                    item.status === "live" 
                      ? "bg-green-500/20" 
                      : item.status === "next"
                      ? "bg-purple-500/20"
                      : "bg-white/10"
                  )}>
                    <item.icon className={cn(
                      "h-8 w-8",
                      item.status === "live" 
                        ? "text-green-400" 
                        : item.status === "next"
                        ? "text-purple-400"
                        : "text-gray-400"
                    )} />
                  </div>
                  
                  <div className="flex-1">
                    <p className={cn(
                      "text-sm font-medium mb-1",
                      item.status === "live" 
                        ? "text-green-400" 
                        : item.status === "next"
                        ? "text-purple-400"
                        : "text-gray-500"
                    )}>
                      {item.description}
                    </p>
                    <h3 className="text-2xl font-bold text-white mb-3">{item.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{item.details}</p>
                  </div>
                </div>

                {/* Animated glow for live/next */}
                {(item.status === "live" || item.status === "next") && (
                  <div className={cn(
                    "absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
                    item.status === "live" 
                      ? "bg-green-500/5" 
                      : "bg-purple-500/5"
                  )} />
                )}
              </div>
            ))}
          </div>

          {/* Upcoming Features */}
          <div className="bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-3xl p-8 md:p-12">
            <div className="flex items-center gap-3 mb-8">
              <Sparkles className="h-6 w-6 text-purple-400" />
              <h3 className="text-2xl font-bold text-white">More Coming Soon</h3>
            </div>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {UPCOMING_FEATURES.map((feature, index) => (
                <div 
                  key={index}
                  className="group flex items-start gap-4 p-4 rounded-xl hover:bg-white/5 transition-colors"
                >
                  <ChevronRight className="h-5 w-5 text-purple-400 mt-0.5 group-hover:translate-x-1 transition-transform" />
                  <div>
                    <h4 className="font-semibold text-white mb-1">{feature.title}</h4>
                    <p className="text-sm text-gray-500">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] to-[#0f0a1e]" />
        <ParticleBackground particleCount={60} speed={0.15} />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Be Part of the <span className="text-purple-400">Revolution</span>
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join thousands of traders who are already on the waitlist for the future of autonomous trading.
          </p>
          <Button 
            onClick={() => openWaitlist()}
            size="lg"
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-lg px-10 py-6 h-auto shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
          >
            Join the Waitlist
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>
    </MarketingLayout>
  );
}
