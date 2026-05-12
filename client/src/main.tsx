import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// Longer timeouts to handle slow proxy responses
const AUTH_TIMEOUT_MS = 120000; // 120 seconds for auth (proxy is slow)
const DEFAULT_TIMEOUT_MS = 120000; // 120 seconds for other requests

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on auth errors
        if (error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG) {
          return false;
        }
        // Retry on abort errors (timeout) - but only once
        if (error instanceof Error && error.name === 'AbortError') {
          return failureCount < 1;
        }
        // Retry up to 2 times for other errors
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

const isAbortError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Fetch is aborted' || error.message.includes('abort');
  }
  return false;
};

// Track last redirect time to prevent redirect loops
let lastRedirectTime = 0;
const REDIRECT_DEBOUNCE_MS = 2000;

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Don't redirect if already on login or register page
  const currentPath = window.location.pathname;
  if (currentPath === '/login' || currentPath === '/register') return;

  // Debounce redirects to prevent loops
  const now = Date.now();
  if (now - lastRedirectTime < REDIRECT_DEBOUNCE_MS) {
    console.log('[main.tsx] Redirect debounced, too soon since last redirect');
    return;
  }
  
  lastRedirectTime = now;
  console.log('[main.tsx] Redirecting to login due to unauthorized error');
  window.location.href = "/login";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    // Don't log abort errors (they're expected during navigation/timeout)
    if (isAbortError(error)) {
      return;
    }
    // Only log if this is the final error (no more retries)
    const failureCount = event.query.state.fetchFailureCount ?? 0;
    const maxRetries = 2;
    if (failureCount >= maxRetries) {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    // Don't log abort errors
    if (isAbortError(error)) {
      return;
    }
    // Mutations don't retry by default, so always log
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Phase 90 — CSRF defense: send 'x-trpc-source' on every request.
      // Server's createContext rejects mutations without it (custom headers
      // require CORS preflight, which our origin allowlist blocks for
      // attackers — classic browser-CSRF can't set this header).
      headers() {
        return { 'x-trpc-source': 'web' };
      },
      fetch(input, init) {
        // Determine timeout based on the request URL
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        const isAuthRequest = url.includes('auth.me') || url.includes('auth.logout') || url.includes('auth.login') || url.includes('auth.register');
        const timeoutMs = isAuthRequest ? AUTH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`[TRPC] Request timeout after ${timeoutMs / 1000}s:`, url);
          controller.abort();
        }, timeoutMs);

        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
