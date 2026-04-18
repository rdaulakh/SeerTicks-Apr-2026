import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PositionProvider } from "./contexts/PositionContext";
import { PortfolioProvider } from "./contexts/PortfolioContext";

// Core Pages - Autonomous Architecture (7 main routes)
import Dashboard from "./pages/Dashboard";
import AgentActivity from "./pages/AgentActivity";
import Positions from "./pages/Positions";
import Performance from "./pages/Performance";
import SystemHealth from "./pages/SystemHealth";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import Register from "./pages/Register";

// Marketing Pages
import MarketingHome from "./pages/marketing/MarketingHome";
import Features from "./pages/marketing/Features";
import Agents from "./pages/marketing/Agents";
import Pricing from "./pages/marketing/Pricing";
import About from "./pages/marketing/About";
import Privacy from "./pages/marketing/Privacy";
import Terms from "./pages/marketing/Terms";
import Disclaimer from "./pages/marketing/Disclaimer";

// Supporting Pages
import OrderHistory from "./pages/OrderHistory";
import Patterns from "./pages/Patterns";
import Signals from "./pages/Signals";
import Strategy from "./pages/Strategy";
import WhaleAlerts from "./pages/WhaleAlerts";
import Backtesting from "./pages/Backtesting";
import MLDashboard from "./pages/MLDashboard";
import TradeJournal from "./pages/TradeJournal";
import RiskDashboard from "./pages/RiskDashboard";
import RegimeDashboard from "./pages/RegimeDashboard";

import { Navigation } from "./components/Navigation";
import { PersistentStatusBar } from "./components/PersistentStatusBar";
import { ToastContainer } from "./components/Toast";
import PageErrorBoundary from "./components/PageErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";

function Router() {
  return (
    <>
      <PageErrorBoundary>
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
          
          {/* All other routes are protected */}
          <Route>
            <ProtectedRoute>
              <Navigation />
              <div className="pb-7">
              <Switch>
                {/* Dashboard - Main Dashboard */}
                <Route path="/dashboard" component={Dashboard} />
                
                {/* Agent Intelligence */}
                <Route path="/agents" component={AgentActivity} />
                <Route path="/patterns" component={Patterns} />
                <Route path="/signals" component={Signals} />
                <Route path="/strategy" component={Strategy} />
                
                {/* Whale Alerts */}
                <Route path="/whale-alerts" component={WhaleAlerts} />
                
                {/* Positions (Read-Only Monitor) */}
                <Route path="/positions" component={Positions} />
                <Route path="/order-history" component={OrderHistory} />
                
                {/* Performance Analytics */}
                <Route path="/performance" component={Performance} />
                
                {/* System Health & Risk */}
                <Route path="/system" component={SystemHealth} />
                <Route path="/risk-dashboard" component={RiskDashboard} />
                
                {/* Regime Intelligence */}
                <Route path="/regime-dashboard" component={RegimeDashboard} />
                
                {/* AI/ML Intelligence */}
                <Route path="/ml-dashboard" component={MLDashboard} />
                
                {/* Consensus Threshold Backtesting */}
                <Route path="/backtesting" component={Backtesting} />

                {/* Trade Journal */}
                <Route path="/trade-journal" component={TradeJournal} />

                {/* Settings (Minimal) */}
                <Route path="/settings" component={Settings} />
                
                {/* Fallback */}
                <Route path="/404" component={NotFound} />
                <Route component={NotFound} />
              </Switch>
              </div>
              <PersistentStatusBar />
            </ProtectedRoute>
          </Route>
        </Switch>
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
