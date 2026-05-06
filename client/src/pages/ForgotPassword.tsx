import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeerIcon } from "@/components/marketing/SeerLogo";
import { SeerLoader } from "@/components/SeerLoader";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not send reset email");
      }
      setSubmitted(true);
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
              {submitted ? "Check your inbox" : "Forgot your password?"}
            </CardTitle>
            <CardDescription className="text-slate-400">
              {submitted
                ? `If an account exists for ${email}, we've emailed a reset link. The link expires in 60 minutes.`
                : "Enter the email associated with your account and we'll send you a link to reset your password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 bg-white/5 border-purple-500/20 text-white placeholder:text-slate-500 focus:border-purple-500/50 focus:ring-purple-500/20"
                      disabled={submitting}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || !email}
                  className="w-full h-12 text-base bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 border-0 shadow-lg shadow-purple-500/25"
                >
                  {submitting ? (
                    <div className="flex items-center gap-3">
                      <SeerLoader size="sm" showText={false} />
                      <span>Sending…</span>
                    </div>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </form>
            ) : (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex gap-3 items-start">
                <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Email sent</p>
                  <p className="text-emerald-300/80 mt-1">
                    Don't see it? Check your spam folder, or wait a minute and request another link.
                  </p>
                </div>
              </div>
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
