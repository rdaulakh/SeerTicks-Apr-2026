import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PositionProvider } from "./contexts/PositionContext";
import { PortfolioProvider } from "./contexts/PortfolioContext";

// Phase 90 — route-level code splitting. Pre-fix: every page (SystemHealth
// 1764 lines, Strategy 1601, AgentScorecard 1353, Backtesting 1231, etc) was
// in the main bundle = 3.17 MB JS / 599 KB gzipped before the user saw
// anything. Now each page becomes its own chunk, fetched only when its route
// renders. Landing pages (MarketingHome, Login) stay eager so first paint
// doesn't show a fallback spinner on the most-visited paths.
import MarketingHome from "./pages/marketing/MarketingHome";
import Login from "./pages/Login";
import Register from "./pages/Register";
import NotFound from "./pages/NotFound";

// Marketing pages (lazy)
const Features = lazy(() => import("./pages/marketing/Features"));
const Agents = lazy(() => import("./pages/marketing/Agents"));
const Pricing = lazy(() => import("./pages/marketing/Pricing"));
const About = lazy(() => import("./pages/marketing/About"));
const Privacy = lazy(() => import("./pages/marketing/Privacy"));
const Terms = lazy(() => import("./pages/marketing/Terms"));
const Disclaimer = lazy(() => import("./pages/marketing/Disclaimer"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

// App pages (lazy — only fetched when navigated to)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AgentActivity = lazy(() => import("./pages/AgentActivity"));
const AgentScorecard = lazy(() => import("./pages/AgentScorecard"));
const Positions = lazy(() => import("./pages/Positions"));
const Performance = lazy(() => import("./pages/Performance"));
const Wallet = lazy(() => import("./pages/Wallet"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const Settings = lazy(() => import("./pages/Settings"));
const OrderHistory = lazy(() => import("./pages/OrderHistory"));
const Patterns = lazy(() => import("./pages/Patterns"));
const Signals = lazy(() => import("./pages/Signals"));
const Strategy = lazy(() => import("./pages/Strategy"));
const WhaleAlerts = lazy(() => import("./pages/WhaleAlerts"));
const Backtesting = lazy(() => import("./pages/Backtesting"));
const MLDashboard = lazy(() => import("./pages/MLDashboard"));
const TradeJournal = lazy(() => import("./pages/TradeJournal"));
const RiskDashboard = lazy(() => import("./pages/RiskDashboard"));
const RegimeDashboard = lazy(() => import("./pages/RegimeDashboard"));

import { Navigation } from "./components/Navigation";
import { PersistentStatusBar } from "./components/PersistentStatusBar";
import { ToastContainer } from "./components/Toast";
import PageErrorBoundary from "./components/PageErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Lightweight loading fallback — small, no chart libs, ships in main chunk.
function RouteLoader() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm">Loading…</div>
      </div>
    </div>
  );
}

function Router() {
  return (
    <>
      <PageErrorBoundary>
        <Suspense fallback={<RouteLoader />}>
          <Switch>
            {/* Public routes - Marketing Website */}
            <Route path="/" component={MarketingHome} />
            <Route path="/features" component={Features} />
            <Route path="/ai-agents" component={Agents} />
            <Route path="/pricing" component={Pricing} />
            <Route path="/about" component={About} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/disclaimer" component={Disclaimer} />
            <Route path="/login" component={Login} />
            <Route path="/register" component={Register} />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />

            {/* All other routes are protected */}
            <Route>
              <ProtectedRoute>
                <Navigation />
                <div className="pb-7">
                  <Suspense fallback={<RouteLoader />}>
                    <Switch>
                      <Route path="/dashboard" component={Dashboard} />
                      <Route path="/agents" component={AgentActivity} />
                      <Route path="/agent-scorecard" component={AgentScorecard} />
                      <Route path="/patterns" component={Patterns} />
                      <Route path="/signals" component={Signals} />
                      <Route path="/strategy" component={Strategy} />
                      <Route path="/whale-alerts" component={WhaleAlerts} />
                      <Route path="/positions" component={Positions} />
                      <Route path="/order-history" component={OrderHistory} />
                      <Route path="/performance" component={Performance} />
                      <Route path="/wallet" component={Wallet} />
                      <Route path="/system" component={SystemHealth} />
                      <Route path="/risk-dashboard" component={RiskDashboard} />
                      <Route path="/regime-dashboard" component={RegimeDashboard} />
                      <Route path="/ml-dashboard" component={MLDashboard} />
                      <Route path="/backtesting" component={Backtesting} />
                      <Route path="/trade-journal" component={TradeJournal} />
                      <Route path="/settings" component={Settings} />
                      <Route path="/404" component={NotFound} />
                      <Route component={NotFound} />
                    </Switch>
                  </Suspense>
                </div>
                <PersistentStatusBar />
              </ProtectedRoute>
            </Route>
          </Switch>
        </Suspense>
      </PageErrorBoundary>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <PositionProvider>
            <PortfolioProvider>
              <Toaster />
              <ToastContainer />
              <Router />
            </PortfolioProvider>
          </PositionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
