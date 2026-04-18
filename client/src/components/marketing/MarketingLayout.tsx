import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ArrowRight, ExternalLink } from "lucide-react";
import { SeerLogo, SeerIcon } from "./SeerLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WaitlistModal, useWaitlistModal } from "./WaitlistModal";

interface MarketingLayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { label: "Features", href: "/features" },
  { label: "AI Agents", href: "/ai-agents" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export function MarketingLayout({ children }: MarketingLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  const { isOpen, openWaitlist, closeWaitlist, selectedPlan } = useWaitlistModal();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  return (
    <div className="min-h-screen bg-[#0f0a1e] text-white font-body overflow-x-hidden">
      <WaitlistModal isOpen={isOpen} onClose={closeWaitlist} selectedPlan={selectedPlan} />
      {/* Navigation */}
      <nav 
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
          scrolled 
            ? "bg-[#0f0a1e]/95 backdrop-blur-xl border-b border-purple-500/20 shadow-lg shadow-purple-500/5" 
            : "bg-transparent"
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <Link href="/">
              <a className="flex items-center group">
                <div className="hidden sm:block">
                  <SeerLogo size="md" />
                </div>
                <div className="sm:hidden">
                  <SeerIcon size={40} />
                </div>
              </a>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-1">
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href}>
                  <a 
                    className={cn(
                      "relative px-4 py-2 text-sm font-medium transition-all duration-300 group",
                      location === item.href 
                        ? "text-white" 
                        : "text-gray-400 hover:text-white"
                    )}
                  >
                    {item.label}
                    <span 
                      className={cn(
                        "absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300",
                        location === item.href ? "w-full" : "w-0 group-hover:w-full"
                      )}
                    />
                  </a>
                </Link>
              ))}
            </div>

            {/* Desktop CTAs */}
            <div className="hidden md:flex items-center space-x-4">
              <a 
                href="/login"
                className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                Sign In
              </a>
              <Button 
                onClick={() => openWaitlist()}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
              >
                Join Waitlist
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <div 
          className={cn(
            "md:hidden absolute top-full left-0 right-0 bg-[#0f0a1e]/98 backdrop-blur-xl border-b border-purple-500/20 transition-all duration-300 overflow-hidden",
            mobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="px-4 py-6 space-y-4">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href}>
                <a 
                  className={cn(
                    "block px-4 py-3 rounded-lg text-base font-medium transition-colors",
                    location === item.href 
                      ? "bg-purple-500/10 text-white" 
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  {item.label}
                </a>
              </Link>
            ))}
            <div className="pt-4 border-t border-white/10 space-y-3">
              <a 
                href="/login"
                className="block w-full px-4 py-3 text-center rounded-lg border border-purple-500/50 text-white hover:bg-purple-500/10 transition-all font-medium"
              >
                Sign In
              </a>
              <Button 
                onClick={() => {
                  setMobileMenuOpen(false);
                  openWaitlist();
                }}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500"
              >
                Join Waitlist
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="relative bg-[#0a0612] border-t border-purple-500/10">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-purple-900/5 to-transparent pointer-events-none" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
            {/* Brand */}
            <div className="lg:col-span-1">
              <SeerLogo size="md" />
              <p className="mt-6 text-gray-500 text-sm leading-relaxed">
                The future of autonomous crypto trading. 14 AI agents working 24/7 to maximize your returns.
              </p>

            </div>

            {/* Product */}
            <div>
              <h4 className="text-white font-semibold mb-6 text-sm uppercase tracking-wider">Product</h4>
              <ul className="space-y-4">
                <li><Link href="/features"><a className="text-gray-500 hover:text-white transition-colors text-sm">Features</a></Link></li>
                <li><Link href="/ai-agents"><a className="text-gray-500 hover:text-white transition-colors text-sm">AI Agents</a></Link></li>
                <li><Link href="/pricing"><a className="text-gray-500 hover:text-white transition-colors text-sm">Pricing</a></Link></li>
                <li><Link href="/about"><a className="text-gray-500 hover:text-white transition-colors text-sm">Roadmap</a></Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-white font-semibold mb-6 text-sm uppercase tracking-wider">Company</h4>
              <ul className="space-y-4">
                <li><Link href="/about"><a className="text-gray-500 hover:text-white transition-colors text-sm">About Us</a></Link></li>
                <li><a href="mailto:contact@seerticks.com" className="text-gray-500 hover:text-white transition-colors text-sm">Contact</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold mb-6 text-sm uppercase tracking-wider">Legal</h4>
              <ul className="space-y-4">
                <li><Link href="/privacy"><a className="text-gray-500 hover:text-white transition-colors text-sm">Privacy Policy</a></Link></li>
                <li><Link href="/terms"><a className="text-gray-500 hover:text-white transition-colors text-sm">Terms of Service</a></Link></li>
                <li><Link href="/disclaimer"><a className="text-gray-500 hover:text-white transition-colors text-sm">Risk Disclaimer</a></Link></li>
              </ul>
            </div>
          </div>

          {/* Bottom */}
          <div className="mt-16 pt-8 border-t border-white/5">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <p className="text-gray-600 text-sm">
                © 2025 SEER. All rights reserved.
              </p>
              <p className="text-gray-600 text-xs">
                Trading cryptocurrencies involves significant risk. Past performance is not indicative of future results.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default MarketingLayout;
