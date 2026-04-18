import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/const";
import { SeerLogo, SeerIcon } from "@/components/marketing/SeerLogo";
import { SeerLoader } from "@/components/SeerLoader";
import { Shield, TrendingUp, Lock, BarChart3, Brain, Mail, KeyRound, AlertCircle, ArrowLeft } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";

const LOGIN_TIMEOUT = 30000; // 30 seconds

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Direct REST login with timeout
  const handleLogin = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT);
    
    try {
      setLoginError(null);
      console.log('[Login] Attempting login...');
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      const data = await response.json();
      console.log('[Login] Response:', response.status, data.success ? 'success' : 'failed');

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      // Store user in localStorage immediately for faster subsequent loads
      if (data.user) {
        localStorage.setItem('seer-auth-user', JSON.stringify(data.user));
      }

      toast.success("Login successful!");
      
      // Redirect immediately - don't wait for refresh
      // The ProtectedRoute will use the cached user from localStorage
      console.log('[Login] Redirecting to dashboard...');
      
      // Use window.location for more reliable redirect
      // Redirect to /agents (dashboard) since / is now the marketing page
      window.location.href = '/agents';
      
      // Also call refresh in background
      refresh().catch(console.error);
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      let errorMessage = "Login failed";
      
      if (error.name === 'AbortError') {
        errorMessage = "Login request timed out. Please try again.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      console.error('[Login] Error:', errorMessage);
      setLoginError(errorMessage);
      toast.error(errorMessage);
      setIsSubmitting(false);
    }
  }, [email, password, refresh, setLocation]);

  // Redirect to dashboard if already authenticated
  // Use ref to prevent multiple redirects
  const hasRedirectedRef = useRef(false);
  
  useEffect(() => {
    if (user && !loading && !hasRedirectedRef.current) {
      console.log('[Login] User already authenticated, redirecting...');
      hasRedirectedRef.current = true;
      // Use setLocation for smoother navigation (no full page reload)
      // Redirect to /agents (dashboard) since / is now the marketing page
      setLocation("/agents");
    }
  }, [user, loading, setLocation]);

  // If already logged in, show redirect message with animated loader
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0612]">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" />
          <p className="text-slate-400">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }
    setIsSubmitting(true);
    setLoginError(null);
    await handleLogin();
  };

  return (
    <div className="min-h-screen bg-[#0a0612] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
        
        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      {/* Back to Website Button */}
      <Link href="/">
        <Button
          variant="ghost"
          className="absolute top-4 left-4 text-slate-400 hover:text-white hover:bg-white/10 z-10"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Website
        </Button>
      </Link>

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center relative z-10">
        {/* Left side - Branding and features */}
        <div className="text-white space-y-8 hidden lg:block">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <SeerLogo size="lg" animated={true} />
            </div>
            <p className="text-xl text-slate-300 mt-4">
              Institutional-grade AI-powered trading platform
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-purple-500/20 hover:border-purple-500/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1 text-white">AI-Powered Analysis</h3>
                <p className="text-sm text-slate-400">
                  Advanced machine learning algorithms analyze market patterns and sentiment in real-time
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-purple-500/20 hover:border-purple-500/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-cyan-500/30 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1 text-white">Multi-Strategy Trading</h3>
                <p className="text-sm text-slate-400">
                  Execute multiple trading strategies simultaneously across different markets
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-purple-500/20 hover:border-purple-500/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/30 to-green-500/30 flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1 text-white">Real-Time Analytics</h3>
                <p className="text-sm text-slate-400">
                  Live market data, position tracking, and comprehensive P&L reporting
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 backdrop-blur-sm border border-purple-500/20 hover:border-purple-500/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500/30 to-orange-500/30 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1 text-white">Risk Management</h3>
                <p className="text-sm text-slate-400">
                  Automated stop-loss, position sizing, and drawdown protection
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - Login card */}
        <Card className="w-full max-w-md mx-auto bg-[#0f0a1e]/80 backdrop-blur-xl border-purple-500/20 shadow-2xl shadow-purple-500/10">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-3 lg:hidden mb-4 justify-center">
              <SeerLogo size="md" animated={true} />
            </div>
            <CardTitle className="text-2xl text-white hidden lg:block">Welcome Back</CardTitle>
            <CardDescription className="text-slate-400">
              Sign in with your email and password to access the trading platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {loginError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                    disabled={isSubmitting}
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">Password</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                    disabled={isSubmitting}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !email || !password}
                className="w-full h-12 text-base bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0 shadow-lg shadow-purple-500/25"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-3">
                    <SeerLoader size="sm" showText={false} />
                    <span>Signing in...</span>
                  </div>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Sign In
                  </>
                )}
              </Button>

              <div className="text-center pt-4 border-t border-purple-500/20">
                <p className="text-slate-400 text-sm">
                  Don't have an account?{" "}
                  <Link href="/pricing" className="text-purple-400 hover:text-purple-300 underline">
                    Join the Waitlist
                  </Link>
                </p>
              </div>

              <div className="space-y-3 pt-4">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Shield className="w-4 h-4 text-green-400" />
                  <span>Secure authentication</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Lock className="w-4 h-4 text-purple-400" />
                  <span>Your data is encrypted and protected</span>
                </div>
              </div>

              <p className="text-xs text-slate-500 text-center pt-4">
                By continuing, you agree to our Terms of Service and Privacy Policy
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
