import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs } from "@/components/marketing/ParticleBackground";
import { FileText } from "lucide-react";

export default function Terms() {
  return (
    <MarketingLayout>
      {/* Hero Section */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-[#0f0a1e]" />
        <ParticleBackground particleCount={40} speed={0.1} />
        <GlowingOrbs />
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/30 mb-8">
              <FileText className="h-4 w-4 text-purple-400 mr-2" />
              <span className="text-sm text-purple-300">Terms of Service</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Terms of Service
            </h1>
            <p className="text-gray-400">Last updated: February 5, 2025</p>
          </div>

          <div className="prose prose-invert max-w-none">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
                <p className="text-gray-400 leading-relaxed">
                  By accessing or using SEER's services, you agree to be bound by these Terms of Service. 
                  If you do not agree to these terms, please do not use our services.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">2. Description of Service</h2>
                <p className="text-gray-400 leading-relaxed">
                  SEER provides an AI-powered cryptocurrency trading platform that analyzes market data 
                  and executes trades based on algorithmic strategies. The service includes paper trading 
                  and live trading modes.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">3. User Responsibilities</h2>
                <p className="text-gray-400 leading-relaxed">
                  You are responsible for maintaining the confidentiality of your account credentials 
                  and for all activities that occur under your account. You agree to use the service 
                  only for lawful purposes and in accordance with these terms.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">4. Risk Disclosure</h2>
                <p className="text-gray-400 leading-relaxed">
                  Cryptocurrency trading involves substantial risk of loss and is not suitable for all 
                  investors. Past performance is not indicative of future results. You should carefully 
                  consider whether trading is appropriate for you in light of your financial condition.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">5. Limitation of Liability</h2>
                <p className="text-gray-400 leading-relaxed">
                  SEER shall not be liable for any indirect, incidental, special, consequential, or 
                  punitive damages resulting from your use of or inability to use the service. Our 
                  total liability shall not exceed the amount paid by you for the service.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">6. Modifications</h2>
                <p className="text-gray-400 leading-relaxed">
                  We reserve the right to modify these terms at any time. We will notify you of any 
                  material changes by posting the new terms on our website. Your continued use of the 
                  service after such modifications constitutes acceptance of the updated terms.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">7. Contact</h2>
                <p className="text-gray-400 leading-relaxed">
                  For questions about these Terms of Service, please contact us at legal@seerticks.com.
                </p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
