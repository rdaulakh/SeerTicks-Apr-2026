import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeerIcon } from "@/components/marketing/SeerLogo";
import { SeerLoader } from "@/components/SeerLoader";
import { KeyRound, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

function readTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(readTokenFromUrl());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Missing reset token. Open the link from your email again.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Reset failed");
      }
      setDone(true);
      setTimeout(() => setLocation("/login"), 2000);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Link href="/" className="flex items-center gap-3">
            <SeerIcon size={40} />
            <span className="text-2xl font-bold text-white">SEER</span>
          </Link>
        </div>

        <Card className="border-purple-500/20 bg-slate-950/80 backdrop-blur">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl text-white">
              {done ? "Password updated" : "Choose a new password"}
            </CardTitle>
            <CardDescription className="text-slate-400">
              {done
                ? "Redirecting you to sign in…"
                : "Enter a new password for your SEER account. The reset link expires 60 minutes after it was sent."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {done ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex gap-3 items-start">
                <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Your password has been reset.</p>
                  <p className="text-emerald-300/80 mt-1">You can now sign in with your new password.</p>
                </div>
              </div>
            ) : !token ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex gap-3 items-start">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Reset link is missing the token.</p>
                  <p className="text-red-300/80 mt-1">
                    Open the most recent email from us and click the link directly, or request a new one.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">New password</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                      disabled={submitting}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-slate-300">Confirm new password</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="confirm"
                      type="password"
                      placeholder="Re-enter new password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                      disabled={submitting}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 flex gap-2 items-start">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || !password || !confirm}
                  className="w-full h-12 text-base bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0 shadow-lg shadow-purple-500/25"
                >
                  {submitting ? (
                    <div className="flex items-center gap-3">
                      <SeerLoader size="sm" showText={false} />
                      <span>Updating…</span>
                    </div>
                  ) : (
                    "Update password"
                  )}
                </Button>
              </form>
            )}

            <div className="pt-2 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-purple-300"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
