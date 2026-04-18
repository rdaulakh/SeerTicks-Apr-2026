/**
 * Protected Route Component
 * 
 * Wraps pages that require authentication.
 * Uses localStorage cache for instant rendering while verifying with server.
 * 
 * CRITICAL: This component must NOT cause redirect loops.
 * - Uses refs to track redirect state across renders
 * - Debounces redirects to prevent rapid navigation
 * - Only redirects after verification is complete
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { SeerLoader } from "@/components/SeerLoader";
import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const STORAGE_KEY = 'seer-auth-user';
const REDIRECT_DEBOUNCE_MS = 1000; // Prevent redirects within 1 second of each other

// Helper to check if we have a cached user
function hasCachedUser(): boolean {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const user = JSON.parse(cached);
      return user && user.id;
    }
  } catch (e) {
    // Ignore
  }
  return false;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, error, verified, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [showRetryButton, setShowRetryButton] = useState(false);
  
  // Use refs to prevent redirect loops
  const hasRedirected = useRef(false);
  const lastRedirectTime = useRef(0);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Show retry button after 10 seconds if still loading
  useEffect(() => {
    if (!loading) {
      setShowRetryButton(false);
      return;
    }
    
    const timer = setTimeout(() => {
      if (loading) {
        setShowRetryButton(true);
      }
    }, 10000);

    return () => clearTimeout(timer);
  }, [loading]);

  // Handle redirect to login when not authenticated
  // This effect is carefully designed to prevent loops
  useEffect(() => {
    // Clear any pending redirect timeout on cleanup
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Don't redirect if we're still loading
    if (loading) {
      return;
    }
    
    // Don't redirect if user exists - reset redirect flag
    if (user) {
      hasRedirected.current = false;
      return;
    }
    
    // Don't redirect if we have cached user and haven't verified yet
    // This prevents premature redirects
    if (hasCachedUser() && !verified) {
      return;
    }
    
    // Don't redirect if we already redirected
    if (hasRedirected.current) {
      return;
    }
    
    // Debounce redirects - prevent rapid redirects
    const now = Date.now();
    if (now - lastRedirectTime.current < REDIRECT_DEBOUNCE_MS) {
      console.log('[ProtectedRoute] Redirect debounced, too soon since last redirect');
      return;
    }

    // No user after verification = redirect to login
    console.log('[ProtectedRoute] No authenticated user, scheduling redirect to login');
    hasRedirected.current = true;
    lastRedirectTime.current = now;
    
    // Use a small delay to prevent race conditions
    redirectTimeoutRef.current = setTimeout(() => {
      // Double-check we still need to redirect
      if (!user && verified) {
        console.log('[ProtectedRoute] Executing redirect to login');
        setLocation("/login");
      }
    }, 100);
    
  }, [user, loading, verified, setLocation]);

  // Manual retry handler
  const handleRetry = useCallback(() => {
    setShowRetryButton(false);
    hasRedirected.current = false; // Allow retry to potentially succeed
    refresh();
  }, [refresh]);

  // If we have a user (from cache or API), render immediately
  if (user) {
    return <>{children}</>;
  }

  // If we have cached user but haven't verified, render children (optimistic)
  // This provides instant rendering while verification happens in background
  if (hasCachedUser() && !verified) {
    return <>{children}</>;
  }

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0612]">
        <div className="text-center space-y-6">
          <SeerLoader size="lg" text="Verifying authentication..." />
          {showRetryButton && (
            <div className="space-y-2">
              <p className="text-slate-500 text-sm">Taking longer than expected...</p>
              <button
                onClick={handleRetry}
                className="px-4 py-2 text-sm bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-md transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show error state with retry option
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0612]">
        <div className="text-center space-y-4">
          <p className="text-red-400">Authentication error</p>
          <p className="text-slate-500 text-sm">{error.message}</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={handleRetry}
              className="px-4 py-2 text-sm bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-md transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => {
                hasRedirected.current = true;
                setLocation("/login");
              }}
              className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-md transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If not loading and no user, show loading briefly while redirect happens
  // This prevents a flash of empty content
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0612]">
      <div className="text-center space-y-6">
        <SeerLoader size="lg" text="Redirecting to login..." />
      </div>
    </div>
  );
}
