import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs } from "@/components/marketing/ParticleBackground";
import { AlertTriangle } from "lucide-react";

export default function Disclaimer() {
  return (
    <MarketingLayout>
      {/* Hero Section */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-[#0f0a1e]" />
        <ParticleBackground particleCount={40} speed={0.1} />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/30 mb-8">
              <AlertTriangle className="h-4 w-4 text-orange-400 mr-2" />
              <span className="text-sm text-orange-300">Risk Disclaimer</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Risk Disclaimer
            </h1>
            <p className="text-gray-400">Last updated: February 5, 2025</p>
          </div>

          <div className="prose prose-invert max-w-none">
            <div className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-8 mb-8">
              <p className="text-orange-300 font-medium text-lg leading-relaxed">
                Trading cryptocurrencies involves significant risk and may not be suitable for all 
                investors. You should carefully consider your investment objectives, level of experience, 
                and risk appetite before making any investment decisions.
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-white mb-4">Market Risk</h2>
                <p className="text-gray-400 leading-relaxed">
                  Cryptocurrency markets are highly volatile and can experience rapid price fluctuations. 
                  The value of your investments can go down as well as up, and you may lose some or all 
                  of your invested capital. Past performance is not a reliable indicator of future results.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">Algorithmic Trading Risk</h2>
                <p className="text-gray-400 leading-relaxed">
                  While SEER uses sophisticated AI algorithms to analyze markets and execute trades, 
                  no algorithm can guarantee profits or eliminate risk. Algorithmic trading systems 
                  may experience technical failures, connectivity issues, or make decisions that 
                  result in losses.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">Regulatory Risk</h2>
                <p className="text-gray-400 leading-relaxed">
                  The regulatory environment for cryptocurrencies is evolving and varies by jurisdiction. 
                  Changes in regulations may affect the value of cryptocurrencies or your ability to 
                  trade them. You are responsible for understanding and complying with applicable laws 
                  in your jurisdiction.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">No Financial Advice</h2>
                <p className="text-gray-400 leading-relaxed">
                  SEER does not provide financial, investment, legal, or tax advice. The information 
                  and services provided by SEER are for informational purposes only and should not 
                  be construed as advice. You should consult with qualified professionals before 
                  making any investment decisions.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">Capital at Risk</h2>
                <p className="text-gray-400 leading-relaxed">
                  Only invest money that you can afford to lose. Never invest borrowed money or 
                  funds that you need for essential expenses. Consider starting with paper trading 
                  to understand the platform before committing real capital.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">Your Responsibility</h2>
                <p className="text-gray-400 leading-relaxed">
                  You are solely responsible for your trading decisions and their outcomes. By using 
                  SEER, you acknowledge that you understand these risks and accept full responsibility 
                  for any losses that may occur.
                </p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
