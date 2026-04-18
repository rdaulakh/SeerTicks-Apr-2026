import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { ParticleBackground, GlowingOrbs } from "@/components/marketing/ParticleBackground";
import { Shield } from "lucide-react";

export default function Privacy() {
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
              <Shield className="h-4 w-4 text-purple-400 mr-2" />
              <span className="text-sm text-purple-300">Privacy Policy</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
              Privacy Policy
            </h1>
            <p className="text-gray-400">Last updated: February 5, 2025</p>
          </div>

          <div className="prose prose-invert max-w-none">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-white mb-4">1. Information We Collect</h2>
                <p className="text-gray-400 leading-relaxed">
                  We collect information you provide directly to us, such as when you create an account, 
                  join our waitlist, or contact us for support. This may include your name, email address, 
                  phone number, and country of residence.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">2. How We Use Your Information</h2>
                <p className="text-gray-400 leading-relaxed">
                  We use the information we collect to provide, maintain, and improve our services, 
                  to communicate with you about products, services, and events, and to monitor and 
                  analyze trends, usage, and activities in connection with our services.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">3. Data Security</h2>
                <p className="text-gray-400 leading-relaxed">
                  We implement appropriate technical and organizational measures to protect your personal 
                  data against unauthorized or unlawful processing, accidental loss, destruction, or damage. 
                  API keys are encrypted using industry-standard encryption protocols.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">4. Data Retention</h2>
                <p className="text-gray-400 leading-relaxed">
                  We retain your personal data only for as long as necessary to fulfill the purposes 
                  for which it was collected, including to satisfy any legal, accounting, or reporting requirements.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">5. Your Rights</h2>
                <p className="text-gray-400 leading-relaxed">
                  You have the right to access, correct, or delete your personal data. You may also 
                  have the right to restrict or object to certain processing of your data. To exercise 
                  these rights, please contact us at privacy@seerticks.com.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-bold text-white mb-4">6. Contact Us</h2>
                <p className="text-gray-400 leading-relaxed">
                  If you have any questions about this Privacy Policy, please contact us at 
                  privacy@seerticks.com.
                </p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
