import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/const";
import { SeerLogo } from "@/components/marketing/SeerLogo";
import { SeerLoader } from "@/components/SeerLoader";
import { trpc } from "@/lib/trpc";
import { Shield, Lock, Mail, KeyRound, User, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";

export default function Register() {
  const { user, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async () => {
      toast.success("Account created successfully!");
      await refresh();
      setLocation("/agents");
    },
    onError: (error) => {
      toast.error(error.message || "Registration failed");
      setIsSubmitting(false);
    },
  });

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (user && !loading) {
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
    
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    
    setIsSubmitting(true);
    registerMutation.mutate({ email, password, name: name || undefined });
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

      <Card className="w-full max-w-md mx-auto bg-[#0f0a1e]/80 backdrop-blur-xl border-purple-500/20 shadow-2xl shadow-purple-500/10 relative z-10">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3 mb-4 justify-center">
            <SeerLogo size="md" animated={true} />
          </div>
          <CardTitle className="text-2xl text-white text-center">Create Account</CardTitle>
          <CardDescription className="text-slate-400 text-center">
            Sign up to access the AI-powered trading platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-slate-300">Name (Optional)</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                  disabled={isSubmitting}
                />
              </div>
            </div>

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
                  required
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
                  placeholder="Create a password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                  disabled={isSubmitting}
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !email || !password || !confirmPassword}
              className="w-full h-12 text-base bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0 shadow-lg shadow-purple-500/25"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-3">
                  <SeerLoader size="sm" showText={false} />
                  <span>Creating account...</span>
                </div>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Create Account
                </>
              )}
            </Button>

            <div className="text-center pt-4 border-t border-purple-500/20">
              <p className="text-slate-400 text-sm">
                Already have an account?{" "}
                <Link href="/login" className="text-purple-400 hover:text-purple-300 underline">
                  Sign in
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
  );
}
