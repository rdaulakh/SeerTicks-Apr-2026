import { useState, useRef, useEffect, useCallback } from "react";
import { X, Sparkles, CheckCircle2, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPlan?: string;
}

const USER_TYPES = [
  { value: "retail_trader", label: "Retail Trader" },
  { value: "institutional", label: "Institutional Investor" },
  { value: "fund_manager", label: "Fund Manager / Hedge Fund" },
  { value: "other", label: "Other" },
];

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany", 
  "France", "Singapore", "Japan", "South Korea", "India", "Brazil",
  "Netherlands", "Switzerland", "United Arab Emirates", "Hong Kong",
  "China", "Spain", "Italy", "Mexico", "Indonesia", "Thailand",
  "Vietnam", "Philippines", "Malaysia", "New Zealand", "Ireland",
  "Sweden", "Norway", "Denmark", "Finland", "Belgium", "Austria",
  "Poland", "Czech Republic", "Portugal", "Greece", "Turkey",
  "Saudi Arabia", "Israel", "South Africa", "Nigeria", "Kenya",
  "Egypt", "Argentina", "Chile", "Colombia", "Peru", "Other"
];

// reCAPTCHA site key from environment
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export function WaitlistModal({ isOpen, onClose, selectedPlan }: WaitlistModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    country: "",
    userType: "",
    selectedPlan: selectedPlan || "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);
  
  // Honeypot field for bot detection (hidden from users)
  const [honeypot, setHoneypot] = useState("");
  const formStartTime = useRef(Date.now());

  // Load reCAPTCHA script
  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return;
    if (window.grecaptcha) { setRecaptchaLoaded(true); return; }
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => window.grecaptcha.ready(() => setRecaptchaLoaded(true));
    document.head.appendChild(script);
  }, []);

  const getRecaptchaToken = useCallback(async (): Promise<string | null> => {
    if (!RECAPTCHA_SITE_KEY || !recaptchaLoaded || !window.grecaptcha) return null;
    try {
      return await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'waitlist_submit' });
    } catch (error) {
      console.error('[Waitlist] Failed to get reCAPTCHA token:', error);
      return null;
    }
  }, [recaptchaLoaded]);

  // tRPC mutation for waitlist submission
  const submitMutation = trpc.waitlist.submit.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      if (data.position) {
        setWaitlistPosition(data.position);
      }
      toast.success(data.message);
    },
    onError: (error) => {
      toast.error(error.message || "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Bot detection: Check honeypot field
    if (honeypot) {
      // Bot detected - silently fail
      console.log("[Waitlist] Bot detected via honeypot");
      setSubmitted(true);
      return;
    }

    // Bot detection: Check if form was filled too quickly (less than 3 seconds)
    const timeElapsed = Date.now() - formStartTime.current;
    if (timeElapsed < 3000) {
      console.log("[Waitlist] Bot detected via timing");
      setSubmitted(true);
      return;
    }

    // Validate required fields
    if (!formData.name || !formData.email || !formData.country || !formData.userType) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    // Get reCAPTCHA token
    const recaptchaToken = await getRecaptchaToken();

    // Submit to backend
    submitMutation.mutate({
      name: formData.name,
      email: formData.email,
      phone: formData.phone || undefined,
      country: formData.country,
      userType: formData.userType as "retail_trader" | "institutional" | "fund_manager" | "other",
      selectedPlan: formData.selectedPlan ? formData.selectedPlan as "starter" | "professional" | "enterprise" : undefined,
      source: window.location.pathname,
      recaptchaToken: recaptchaToken || undefined,
    });
  };

  const handleClose = () => {
    setSubmitted(false);
    setWaitlistPosition(null);
    setFormData({
      name: "",
      email: "",
      phone: "",
      country: "",
      userType: "",
      selectedPlan: "",
    });
    setHoneypot("");
    formStartTime.current = Date.now();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[#0f0a1e] border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/20 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Gradient border effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-blue-500/10 pointer-events-none" />
        
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        {!submitted ? (
          <div className="relative p-6 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6 sm:mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 mb-4">
                <Sparkles className="h-7 w-7 sm:h-8 sm:w-8 text-purple-400" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                Join the Waitlist
              </h2>
              <p className="text-gray-400 text-sm">
                SEER is currently in invite-only beta. Join our waitlist and be among the first to experience the future of autonomous crypto trading.
              </p>
              {selectedPlan && (
                <div className="mt-3 inline-flex items-center px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
                  <span className="text-purple-300 text-sm">
                    Interested in: <span className="font-semibold capitalize">{selectedPlan}</span>
                  </span>
                </div>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              {/* Honeypot field - hidden from users, visible to bots */}
              <div className="absolute -left-[9999px] opacity-0 pointer-events-none" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </div>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-300 text-sm">
                  Full Name <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                  required
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-300 text-sm">
                  Email Address <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                  required
                />
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-gray-300 text-sm">
                  Phone Number <span className="text-gray-500">(Optional)</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                />
              </div>

              {/* Country */}
              <div className="space-y-2">
                <Label htmlFor="country" className="text-gray-300 text-sm">
                  Country <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={formData.country}
                  onValueChange={(value) => setFormData({ ...formData, country: value })}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-purple-500/50 focus:ring-purple-500/20">
                    <SelectValue placeholder="Select your country" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1025] border-purple-500/30 max-h-60">
                    {COUNTRIES.map((country) => (
                      <SelectItem 
                        key={country} 
                        value={country}
                        className="text-gray-300 focus:bg-purple-500/20 focus:text-white"
                      >
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* User Type */}
              <div className="space-y-2">
                <Label htmlFor="userType" className="text-gray-300 text-sm">
                  I am a <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={formData.userType}
                  onValueChange={(value) => setFormData({ ...formData, userType: value })}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-purple-500/50 focus:ring-purple-500/20">
                    <SelectValue placeholder="Select your profile" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1025] border-purple-500/30">
                    {USER_TYPES.map((type) => (
                      <SelectItem 
                        key={type.value} 
                        value={type.value}
                        className="text-gray-300 focus:bg-purple-500/20 focus:text-white"
                      >
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Security indicator */}
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Shield className="h-3 w-3" />
                <span>Your information is encrypted and secure</span>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={submitMutation.isPending}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold py-5 sm:py-6 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Joining Waitlist...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Join the Waitlist
                  </>
                )}
              </Button>

              {/* Privacy note */}
              <p className="text-center text-gray-500 text-xs">
                By joining, you agree to our{" "}
                <a href="/privacy" className="text-purple-400 hover:underline">Privacy Policy</a>
                {" "}and{" "}
                <a href="/terms" className="text-purple-400 hover:underline">Terms of Service</a>.
              </p>
            </form>
          </div>
        ) : (
          /* Success State */
          <div className="relative p-6 sm:p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 mb-6">
              <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-green-400" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">
              You're on the List!
            </h2>
            <p className="text-gray-400 mb-6">
              Thank you for your interest in SEER. We'll review your application and send you an invite as soon as a spot opens up.
            </p>
            
            {waitlistPosition && (
              <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-400">
                  Your waitlist position
                </p>
                <p className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  #{waitlistPosition}
                </p>
              </div>
            )}
            
            <div className="bg-white/5 rounded-xl p-4 mb-6">
              <p className="text-sm text-gray-400">
                <span className="text-purple-400 font-semibold">What's next?</span>
                <br />
                Keep an eye on your inbox. Early waitlist members get priority access and exclusive benefits.
              </p>
            </div>
            <Button
              onClick={handleClose}
              variant="outline"
              className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook for managing waitlist modal state
export function useWaitlistModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | undefined>();

  const openWaitlist = (plan?: string) => {
    setSelectedPlan(plan);
    setIsOpen(true);
  };

  const closeWaitlist = () => {
    setIsOpen(false);
    setSelectedPlan(undefined);
  };

  return {
    isOpen,
    selectedPlan,
    openWaitlist,
    closeWaitlist,
  };
}

export default WaitlistModal;
