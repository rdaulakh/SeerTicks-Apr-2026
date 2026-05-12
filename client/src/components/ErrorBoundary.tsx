import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  // Phase 93.5 — auto-recover from chunk-load failures after a deploy.
  // See PageErrorBoundary for full rationale. Mirrored here so both
  // boundary variants behave consistently.
  componentDidCatch(error: Error): void {
    const msg = (error?.message || error?.toString() || '').toLowerCase();
    const isChunkLoadFailure =
      msg.includes('failed to fetch dynamically imported module') ||
      msg.includes('failed to fetch dynamically imported') ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk') ||
      msg.includes('importing a module script failed') ||
      /[a-z0-9_-]+-[a-z0-9_-]{8,}\.js/i.test(msg);
    if (isChunkLoadFailure) {
      const flag = 'seer:chunk_reload_attempted';
      if (!sessionStorage.getItem(flag)) {
        console.warn('[ErrorBoundary] chunk-load failure detected — reloading.');
        sessionStorage.setItem(flag, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
