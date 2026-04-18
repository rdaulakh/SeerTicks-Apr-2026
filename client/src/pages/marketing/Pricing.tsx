import { useState } from "react";
import { Link } from "wouter";
import { 
  Check, 
  X, 
  ArrowRight, 
  Sparkles,
  Zap,
  Crown,
  Building2,
  HelpCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs, GridOverlay } from "@/components/marketing/ParticleBackground";
import { WaitlistModal, useWaitlistModal } from "@/components/marketing/WaitlistModal";
import { cn } from "@/lib/utils";

const PRICING_TIERS = [
  {
    name: "Starter",
    icon: Zap,
    description: "Perfect for individual traders getting started with AI-powered trading",
    monthlyPrice: 49,
    annualPrice: 39,
    features: [
      { name: "Paper trading mode", included: true },
      { name: "3 AI agents active", included: true },
      { name: "Basic risk management", included: true },
      { name: "Daily performance reports", included: true },
      { name: "Email support", included: true },
      { name: "Live trading", included: false },
      { name: "All 14 AI agents", included: false },
      { name: "Advanced analytics", included: false },
      { name: "API access", included: false },
      { name: "Priority support", included: false }
    ],
    gradient: "from-blue-500 to-cyan-500",
    popular: false
  },
  {
    name: "Professional",
    icon: Crown,
    description: "For serious traders who want the full power of SEER's AI capabilities",
    monthlyPrice: 149,
    annualPrice: 119,
    features: [
      { name: "Paper trading mode", included: true },
      { name: "All 14 AI agents", included: true },
      { name: "Live trading enabled", included: true },
      { name: "Advanced risk management", included: true },
      { name: "Real-time analytics", included: true },
      { name: "Whale & iceberg alerts", included: true },
      { name: "Priority email support", included: true },
      { name: "API access", included: false },
      { name: "Custom agent weights", included: false },
      { name: "Dedicated account manager", included: false }
    ],
    gradient: "from-purple-500 to-pink-500",
    popular: true
  },
  {
    name: "Enterprise",
    icon: Building2,
    description: "Custom solutions for institutions and professional trading firms",
    monthlyPrice: null,
    annualPrice: null,
    features: [
      { name: "Everything in Professional", included: true },
      { name: "Custom agent configuration", included: true },
      { name: "Multi-account management", included: true },
      { name: "White-label options", included: true },
      { name: "Full API access", included: true },
      { name: "Custom integrations", included: true },
      { name: "Dedicated account manager", included: true },
      { name: "24/7 phone support", included: true },
      { name: "On-premise deployment", included: true },
      { name: "Custom SLA", included: true }
    ],
    gradient: "from-orange-500 to-red-500",
    popular: false
  }
];

const FAQ_ITEMS = [
  {
    question: "How does the waitlist work?",
    answer: "We're currently in invite-only beta. Join the waitlist and we'll notify you when a spot becomes available. Early waitlist members get priority access and special founding member pricing."
  },
  {
    question: "Can I try SEER before committing?",
    answer: "Yes! All plans include paper trading mode where you can test the platform with simulated capital. This lets you experience the full power of our AI agents without risking real money."
  },
  {
    question: "What exchanges do you support?",
    answer: "SEER supports major cryptocurrency exchanges including Coinbase, Binance, Kraken, and more. We're continuously adding new exchange integrations based on user demand."
  },
  {
    question: "How is my capital protected?",
    answer: "SEER never has direct access to your funds. We use read-only API keys for analysis and trade-only keys for execution. Your capital stays on your exchange at all times."
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes, you can cancel your subscription at any time. If you cancel, you'll retain access until the end of your billing period. No long-term contracts required."
  },
  {
    question: "What kind of returns can I expect?",
    answer: "Past performance doesn't guarantee future results. SEER is a tool that enhances your trading with AI analysis, but cryptocurrency trading always carries risk. We recommend starting with paper trading."
  }
];

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
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
              <span className="text-sm text-purple-300">Invite-Only Beta</span>
            </div>
            
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6">
              <span className="text-white">Simple, Transparent</span>
              <br />
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Pricing
              </span>
            </h1>
            
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
              Choose the plan that fits your trading style. All plans include paper trading mode 
              to test risk-free before going live.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center p-1 bg-white/5 border border-white/10 rounded-full mb-12">
              <button
                onClick={() => setIsAnnual(false)}
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-medium transition-all",
                  !isAnnual ? "bg-purple-500 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                  isAnnual ? "bg-purple-500 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                Annual
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                  Save 20%
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="relative py-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a1e] to-[#0a0612]" />
        <GridOverlay />
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8">
            {PRICING_TIERS.map((tier, index) => (
              <div 
                key={index}
                className={cn(
                  "relative bg-gradient-to-br from-white/5 to-white/0 border rounded-2xl p-8 transition-all duration-500",
                  tier.popular 
                    ? "border-purple-500/50 scale-105 shadow-2xl shadow-purple-500/20" 
                    : "border-white/10 hover:border-white/20"
                )}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full text-white text-sm font-medium">
                    Most Popular
                  </div>
                )}
                
                {/* Header */}
                <div className="mb-6">
                  <div className={cn(
                    "w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center mb-4",
                    tier.gradient
                  )}>
                    <tier.icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">{tier.name}</h3>
                  <p className="text-gray-400 text-sm">{tier.description}</p>
                </div>
                
                {/* Price */}
                <div className="mb-8">
                  {tier.monthlyPrice ? (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-bold text-white">
                          ${isAnnual ? tier.annualPrice : tier.monthlyPrice}
                        </span>
                        <span className="text-gray-400">/month</span>
                      </div>
                      {isAnnual && (
                        <p className="text-sm text-green-400 mt-1">
                          Billed annually (${tier.annualPrice! * 12}/year)
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-3xl font-bold text-white">Custom Pricing</div>
                  )}
                </div>
                
                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3">
                      {feature.included ? (
                        <Check className="h-5 w-5 text-green-400 flex-shrink-0" />
                      ) : (
                        <X className="h-5 w-5 text-gray-600 flex-shrink-0" />
                      )}
                      <span className={feature.included ? "text-gray-300" : "text-gray-500"}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>
                
                {/* CTA */}
                <Button 
                  size="lg"
                  onClick={() => openWaitlist(tier.name)}
                  className={cn(
                    "w-full",
                    tier.popular 
                      ? "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white" 
                      : "bg-white/10 hover:bg-white/20 text-white"
                  )}
                >
                  {tier.monthlyPrice ? "Join Waitlist" : "Contact Sales"}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#0a0612]" />
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Compare <span className="text-purple-400">Plans</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Find the perfect plan for your trading needs
            </p>
          </div>

          <div className="bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 bg-white/5 p-4 border-b border-white/10">
              <div className="text-gray-400 font-medium">Feature</div>
              <div className="text-center text-blue-400 font-medium">Starter</div>
              <div className="text-center text-purple-400 font-medium">Professional</div>
              <div className="text-center text-orange-400 font-medium">Enterprise</div>
            </div>
            
            {[
              { feature: "AI Agents", starter: "3", pro: "11", enterprise: "11+" },
              { feature: "Paper Trading", starter: true, pro: true, enterprise: true },
              { feature: "Live Trading", starter: false, pro: true, enterprise: true },
              { feature: "Risk Management", starter: "Basic", pro: "Advanced", enterprise: "Custom" },
              { feature: "Analytics", starter: "Daily", pro: "Real-time", enterprise: "Custom" },
              { feature: "API Access", starter: false, pro: false, enterprise: true },
              { feature: "Support", starter: "Email", pro: "Priority", enterprise: "24/7" },
              { feature: "Custom Integrations", starter: false, pro: false, enterprise: true }
            ].map((row, index) => (
              <div 
                key={index}
                className={cn(
                  "grid grid-cols-4 p-4",
                  index !== 7 && "border-b border-white/5"
                )}
              >
                <div className="text-gray-300">{row.feature}</div>
                <div className="text-center">
                  {typeof row.starter === "boolean" ? (
                    row.starter ? (
                      <Check className="h-5 w-5 text-green-400 mx-auto" />
                    ) : (
                      <X className="h-5 w-5 text-gray-600 mx-auto" />
                    )
                  ) : (
                    <span className="text-gray-400">{row.starter}</span>
                  )}
                </div>
                <div className="text-center">
                  {typeof row.pro === "boolean" ? (
                    row.pro ? (
                      <Check className="h-5 w-5 text-green-400 mx-auto" />
                    ) : (
                      <X className="h-5 w-5 text-gray-600 mx-auto" />
                    )
                  ) : (
                    <span className="text-purple-400">{row.pro}</span>
                  )}
                </div>
                <div className="text-center">
                  {typeof row.enterprise === "boolean" ? (
                    row.enterprise ? (
                      <Check className="h-5 w-5 text-green-400 mx-auto" />
                    ) : (
                      <X className="h-5 w-5 text-gray-600 mx-auto" />
                    )
                  ) : (
                    <span className="text-orange-400">{row.enterprise}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0612] via-[#0f0a1e] to-[#0a0612]" />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Frequently Asked <span className="text-cyan-400">Questions</span>
            </h2>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item, index) => (
              <div 
                key={index}
                className="bg-gradient-to-br from-white/5 to-white/0 border border-white/10 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <div className="flex items-center gap-3">
                    <HelpCircle className="h-5 w-5 text-purple-400 flex-shrink-0" />
                    <span className="text-white font-medium">{item.question}</span>
                  </div>
                  {expandedFaq === index ? (
                    <ChevronUp className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  )}
                </button>
                {expandedFaq === index && (
                  <div className="px-6 pb-6 pt-0">
                    <p className="text-gray-400 pl-8">{item.answer}</p>
                  </div>
                )}
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
            Ready to <span className="text-cyan-400">Get Started</span>?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join the waitlist today and be among the first to experience the future of autonomous trading.
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
            <Link href="/features">
              <Button 
                size="lg"
                variant="outline"
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 px-8 py-6 text-lg"
              >
                Explore Features
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
