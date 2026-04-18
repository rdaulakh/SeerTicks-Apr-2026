import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  ArrowRight, 
  Brain, 
  Shield, 
  Zap, 
  TrendingUp, 
  Clock, 
  Eye,
  Activity,
  Lock,
  Cpu,
  ChevronRight,
  Play,
  Bot,
  LineChart,
  Target,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs, DataStreams, GridOverlay } from "@/components/marketing/ParticleBackground";
import { SeerIcon } from "@/components/marketing/SeerLogo";
import { WaitlistModal, useWaitlistModal } from "@/components/marketing/WaitlistModal";
import { cn } from "@/lib/utils";

// Animated counter component
function AnimatedCounter({ end, duration = 2000, suffix = "" }: { end: number; duration?: number; suffix?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);

  return <span>{count.toLocaleString()}{suffix}</span>;
}

// Floating card component
function FloatingCard({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div 
      className={cn("animate-float", className)}
      style={{ animationDelay: `${delay}s`, animationDuration: "6s" }}
    >
      {children}
    </div>
  );
}

export default function MarketingHome() {
  const { isOpen, selectedPlan, openWaitlist, closeWaitlist } = useWaitlistModal();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <MarketingLayout>
      <WaitlistModal isOpen={isOpen} onClose={closeWaitlist} selectedPlan={selectedPlan} />
      
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-[#0f0a1e]" />
        <ParticleBackground particleCount={100} speed={0.2} />
        <GlowingOrbs />
        <GridOverlay />
        <DataStreams count={8} />
        
        {/* Radial gradient overlay */}
        <div className="absolute inset-0 bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
        
        {/* Content */}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            {/* Badge */}
            <div 
              className={cn(
                "inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8 transition-all duration-1000",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-sm text-purple-300">Now accepting early access applications</span>
            </div>

            {/* Main Headline */}
            <h1 
              className={cn(
                "text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 transition-all duration-1000 delay-200",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              <span className="text-white">The Future of</span>
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Autonomous Trading
              </span>
            </h1>

            {/* Subheadline */}
            <p 
              className={cn(
                "text-xl sm:text-2xl text-gray-400 max-w-3xl mx-auto mb-10 leading-relaxed transition-all duration-1000 delay-400",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              14 AI agents working in perfect harmony, 24/7. Institutional-grade analysis, 
              risk management, and execution — all on autopilot.
            </p>

            {/* CTA Buttons */}
            <div 
              className={cn(
                "flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 transition-all duration-1000 delay-600",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              <Button 
                size="lg"
                onClick={() => openWaitlist()}
                className="group bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-8 py-6 text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all duration-300"
              >
                Join the Waitlist
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Link href="/features">
                <Button 
                  size="lg"
                  variant="outline"
                  className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 px-8 py-6 text-lg"
                >
                  <Play className="mr-2 h-5 w-5" />
                  See How It Works
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div 
              className={cn(
                "grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto transition-all duration-1000 delay-800",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              {[
                { value: 12847, suffix: "+", label: "Trades Executed" },
                { value: 99.9, suffix: "%", label: "System Uptime" },
                { value: 14, suffix: "", label: "AI Agents" },
                { value: 24, suffix: "/7", label: "Monitoring" },
              ].map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl sm:text-4xl font-bold text-white mb-1">
                    <AnimatedCounter end={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="text-sm text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-purple-500/30 flex items-start justify-center p-2">
            <div className="w-1 h-2 bg-purple-400 rounded-full animate-scroll" />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a1e] via-[#0a0612] to-[#0f0a1e]" />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              How <span className="text-purple-400">SEER</span> Works
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              A symphony of artificial intelligence, working together to navigate the crypto markets
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                icon: Eye,
                title: "Analyze",
                description: "14 specialized AI agents continuously monitor market data, sentiment, whale movements, and on-chain metrics in real-time.",
                gradient: "from-purple-500 to-purple-600"
              },
              {
                step: "02",
                icon: Brain,
                title: "Decide",
                description: "Multi-agent consensus system weighs each signal. Only when 70%+ agreement is reached does the system act.",
                gradient: "from-blue-500 to-blue-600"
              },
              {
                step: "03",
                icon: Zap,
                title: "Execute",
                description: "Institutional-grade execution with Kelly Criterion position sizing, circuit breakers, and layered profit targets.",
                gradient: "from-cyan-500 to-cyan-600"
              }
            ].map((item, index) => (
              <div 
                key={index}
                className="group relative bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl p-8 hover:border-purple-500/30 transition-all duration-500"
              >
                <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-[#0f0a1e] border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-400 font-bold">{item.step}</span>
                </div>
                
                <div className={cn(
                  "w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300",
                  item.gradient
                )}>
                  <item.icon className="h-8 w-8 text-white" />
                </div>
                
                <h3 className="text-2xl font-bold text-white mb-4">{item.title}</h3>
                <p className="text-gray-400 leading-relaxed">{item.description}</p>
                
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/0 to-blue-500/0 group-hover:from-purple-500/5 group-hover:to-blue-500/5 transition-all duration-500 pointer-events-none" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Built for <span className="text-cyan-400">Serious Traders</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Every feature designed with institutional-grade precision
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Brain, title: "Multi-Agent Consensus", description: "14 specialized AI agents must reach 70% agreement before any trade is executed.", color: "purple" },
              { icon: Shield, title: "Risk Management", description: "Kelly Criterion sizing, circuit breakers, and correlation limits protect your capital.", color: "blue" },
              { icon: Activity, title: "Real-Time Analysis", description: "Process market data, sentiment, and on-chain metrics in milliseconds.", color: "cyan" },
              { icon: TrendingUp, title: "Layered Profit Targets", description: "Automated profit-taking at +1%, +1.5%, and +2% with trailing stops.", color: "green" },
              { icon: Clock, title: "24/7 Operation", description: "Never miss an opportunity. SEER monitors markets around the clock.", color: "orange" },
              { icon: Lock, title: "Paper Trading Mode", description: "Test strategies risk-free before deploying real capital.", color: "pink" }
            ].map((feature, index) => (
              <div 
                key={index}
                className="group relative bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/10 hover:border-purple-500/30 transition-all duration-300"
              >
                <div className={cn(
                  "w-12 h-12 rounded-lg flex items-center justify-center mb-4",
                  feature.color === "purple" && "bg-purple-500/20 text-purple-400",
                  feature.color === "blue" && "bg-blue-500/20 text-blue-400",
                  feature.color === "cyan" && "bg-cyan-500/20 text-cyan-400",
                  feature.color === "green" && "bg-green-500/20 text-green-400",
                  feature.color === "orange" && "bg-orange-500/20 text-orange-400",
                  feature.color === "pink" && "bg-pink-500/20 text-pink-400"
                )}>
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link href="/features">
              <Button variant="outline" className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10">
                Explore All Features
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* AI Agents Preview Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] via-[#0f0a1e] to-[#0a0612]" />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
                Meet Your <span className="text-purple-400">AI Trading Team</span>
              </h2>
              <p className="text-xl text-gray-400 mb-8 leading-relaxed">
                Each agent is a specialist. Together, they form an unstoppable force that analyzes every angle of the market before making a move.
              </p>
              
              <div className="space-y-4 mb-8">
                {[
                  "Technical Analyst — Pattern recognition & indicators",
                  "Sentiment Analyst — Social media & news sentiment",
                  "Whale Tracker — Large transaction monitoring",
                  "Macro Analyst — VIX, DXY & market regime detection",
                  "...and 7 more specialized agents"
                ].map((agent, index) => (
                  <div key={index} className="flex items-center text-gray-300">
                    <div className="w-2 h-2 rounded-full bg-purple-500 mr-3" />
                    {agent}
                  </div>
                ))}
              </div>

              <Link href="/ai-agents">
                <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500">
                  Meet All 14 Agents
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>

            {/* Agent visualization */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-3xl blur-3xl" />
              <div className="relative bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-3xl p-8">
                <div className="grid grid-cols-3 gap-4">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <FloatingCard key={i} delay={i * 0.2}>
                      <div className="aspect-square bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-xl border border-purple-500/20 flex items-center justify-center">
                        <Cpu className="h-8 w-8 text-purple-400" />
                      </div>
                    </FloatingCard>
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-2xl shadow-purple-500/50">
                    <SeerIcon size={48} />
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
        <ParticleBackground particleCount={50} speed={0.1} />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8">
            <Sparkles className="h-4 w-4 text-purple-400 mr-2" />
            <span className="text-sm text-purple-300">Invite-Only Beta • Limited Spots</span>
          </div>
          
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Ready to Trade <span className="text-cyan-400">Smarter</span>?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the waitlist today and be among the first to experience the future of autonomous crypto trading.
          </p>
          
          <Button 
            size="lg"
            onClick={() => openWaitlist()}
            className="group bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white px-12 py-7 text-xl shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all duration-300"
          >
            Join the Waitlist
            <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-1 transition-transform" />
          </Button>

          <p className="mt-6 text-gray-500 text-sm">
            We'll review your application and send an invite when a spot opens up.
          </p>
        </div>
      </section>

      {/* Custom animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        @keyframes scroll {
          0%, 100% { transform: translateY(0); opacity: 1; }
          50% { transform: translateY(4px); opacity: 0.5; }
        }
        .animate-scroll {
          animation: scroll 1.5s ease-in-out infinite;
        }
        .bg-gradient-radial {
          background: radial-gradient(ellipse at center, var(--tw-gradient-from) 0%, var(--tw-gradient-to) 70%);
        }
      `}</style>
    </MarketingLayout>
  );
}
