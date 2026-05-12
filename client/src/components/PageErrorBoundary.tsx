import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Page-level Error Boundary
 * 
 * Catches errors in child components and displays user-friendly error message
 * instead of crashing the entire application.
 * 
 * Usage:
 * <PageErrorBoundary>
 *   <YourComponent />
 * </PageErrorBoundary>
 */
export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console for debugging
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);

    // Phase 93.5 — auto-recover from chunk-load failures.
    //
    // A vite-built SPA with lazy routes ships hashed chunks (e.g.
    // AgentScorecard-DtIFrU5-.js). Deploys produce NEW hashes. If a user has
    // an old index.html cached and clicks a lazy route, the browser asks for
    // the OLD chunk hash which now 404s. The error reads:
    //   "Failed to fetch dynamically imported module: .../Foo-OLDHASH.js"
    // The user sees the generic ErrorBoundary screen — bad UX for what is
    // simply "the deploy moved the chunk."
    //
    // Detection: the error message contains "dynamically imported module" OR
    // "Loading chunk" OR matches a hashed chunk URL pattern.
    //
    // Recovery: reload once with a session-storage flag to prevent reload
    // loops if the issue is actually a real bug.
    const msg = (error?.message || error?.toString() || '').toLowerCase();
    const isChunkLoadFailure =
      msg.includes('failed to fetch dynamically imported module') ||
      msg.includes('failed to fetch dynamically imported') ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk') ||
      msg.includes('importing a module script failed') ||
      /[a-z0-9_-]+-[a-z0-9_-]{8,}\.js/i.test(msg);

    if (isChunkLoadFailure) {
      const reloadFlagKey = 'seer:chunk_reload_attempted';
      const alreadyReloaded = sessionStorage.getItem(reloadFlagKey);
      if (!alreadyReloaded) {
        console.warn('[ErrorBoundary] Detected chunk-load failure (probably stale build after deploy) — reloading once.');
        sessionStorage.setItem(reloadFlagKey, String(Date.now()));
        // Use replace() so the broken state isn't in history.
        window.location.reload();
        return; // don't render the error UI; the reload will replace it
      } else {
        console.error('[ErrorBoundary] Chunk-load failure after reload attempt — showing fallback UI.');
        // Fall through to showing the standard error screen. Clear the flag
        // after 5 min so future genuine deploys can self-heal again.
        const flagAge = Date.now() - Number(alreadyReloaded);
        if (flagAge > 5 * 60_000) sessionStorage.removeItem(reloadFlagKey);
      }
    }

    // Update state with error details
    this.setState({
      error,
      errorInfo,
    });

    // TODO: Send error to logging service (e.g., Sentry, LogRocket)
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
          <Card className="glass-card max-w-2xl w-full p-8 border-slate-800/50">
            <div className="flex flex-col items-center text-center space-y-6">
              {/* Error Icon */}
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-500" />
              </div>

              {/* Error Title */}
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">
                  Oops! Something went wrong
                </h1>
                <p className="text-slate-400">
                  We encountered an unexpected error. Don't worry, your data is safe.
                </p>
              </div>

              {/* Error Details (Development Only) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <div className="w-full bg-slate-900/50 rounded-lg p-4 text-left">
                  <p className="text-sm font-mono text-red-400 mb-2">
                    {this.state.error.toString()}
                  </p>
                  {this.state.errorInfo && (
                    <details className="text-xs font-mono text-slate-500">
                      <summary className="cursor-pointer hover:text-slate-400">
                        Stack Trace
                      </summary>
                      <pre className="mt-2 overflow-auto max-h-64">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 justify-center">
                <Button
                  onClick={this.handleReset}
                  variant="default"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>

                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>

                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Button>
              </div>

              {/* Help Text */}
              <p className="text-sm text-slate-500">
                If this problem persists, please contact support or try refreshing the page.
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;
