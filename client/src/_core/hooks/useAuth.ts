/**
 * Production-Grade Authentication Hook
 * 
 * Features:
 * - Fast initial render using localStorage cache
 * - Background verification with server
 * - Automatic retry on failure
 * - Timeout handling with fallback to cache
 * - Proper error states
 * - STABLE REFERENCES to prevent re-render loops
 */

import { useCallback, useEffect, useMemo, useState, useRef } from "react";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt?: string;
  updatedAt?: string;
  lastSignedIn?: string;
};

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

const STORAGE_KEY = 'seer-auth-user';
const AUTH_TIMEOUT = 15000; // 15 seconds
const MAX_RETRIES = 2;

// Helper to get cached user from localStorage
function getCachedUser(): User | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const user = JSON.parse(cached);
      if (user && user.id) {
        return user;
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

// Helper to save user to localStorage
function setCachedUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    // Ignore storage errors
  }
}

// Compare two user objects for equality (to prevent unnecessary state updates)
function usersEqual(a: User | null, b: User | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.openId === b.openId && a.name === b.name && a.email === b.email && a.role === b.role;
}

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } = options ?? {};
  
  // Initialize with cached user for instant render
  const [user, setUser] = useState<User | null>(() => getCachedUser());
  const [loading, setLoading] = useState(() => !getCachedUser()); // Only show loading if no cache
  const [error, setError] = useState<Error | null>(null);
  const [verified, setVerified] = useState(false);
  
  // Use refs to track state without causing re-renders
  const retryCount = useRef(0);
  const isMounted = useRef(true);
  const isFetching = useRef(false);
  const hasInitialized = useRef(false);
  const userRef = useRef<User | null>(user);
  
  // Keep userRef in sync
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Stable setUser that only updates if user actually changed
  const setUserStable = useCallback((newUser: User | null) => {
    if (!usersEqual(userRef.current, newUser)) {
      userRef.current = newUser;
      setUser(newUser);
    }
  }, []);

  // Fetch user from server - NO dependencies to keep it stable
  const fetchUser = useCallback(async (isRetry = false) => {
    // Prevent concurrent fetches
    if (isFetching.current) {
      console.log('[useAuth] Fetch already in progress, skipping');
      return;
    }
    
    if (!isMounted.current) return;
    
    isFetching.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT);
    
    try {
      if (!isRetry) {
        setLoading(true);
        setError(null);
      }
      
      console.log('[useAuth] Fetching user from server...');
      
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!isMounted.current) {
        isFetching.current = false;
        return;
      }
      
      // Handle non-OK responses gracefully
      if (!response.ok) {
        console.warn('[useAuth] Server returned non-OK status:', response.status);
        // For 401/403, clear user
        if (response.status === 401 || response.status === 403) {
          setUserStable(null);
          setCachedUser(null);
          setVerified(true);
          setLoading(false);
          isFetching.current = false;
          return;
        }
        throw new Error(`Server error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[useAuth] Server response:', data.user ? 'User found' : 'No user');
      
      if (data.user) {
        setUserStable(data.user);
        setCachedUser(data.user);
      } else {
        setUserStable(null);
        setCachedUser(null);
      }
      setVerified(true);
      setError(null);
      retryCount.current = 0;
      
    } catch (err: any) {
      clearTimeout(timeoutId);
      
      if (!isMounted.current) {
        isFetching.current = false;
        return;
      }
      
      if (err.name === 'AbortError') {
        console.warn('[useAuth] Request timed out');
        
        // On timeout, use cached user if available
        const cached = getCachedUser();
        if (cached) {
          console.log('[useAuth] Using cached user due to timeout');
          setUserStable(cached);
          setVerified(true);
        } else if (retryCount.current < MAX_RETRIES) {
          // Retry
          retryCount.current++;
          console.log(`[useAuth] Retrying (${retryCount.current}/${MAX_RETRIES})...`);
          isFetching.current = false;
          setTimeout(() => fetchUser(true), 1000);
          return;
        } else {
          setError(new Error('Authentication request timed out'));
          setUserStable(null);
          setVerified(true);
        }
      } else {
        console.error('[useAuth] Error:', err.message);
        
        // On error, use cached user if available
        const cached = getCachedUser();
        if (cached) {
          console.log('[useAuth] Using cached user due to error');
          setUserStable(cached);
          setVerified(true);
        } else if (retryCount.current < MAX_RETRIES) {
          // Retry
          retryCount.current++;
          console.log(`[useAuth] Retrying (${retryCount.current}/${MAX_RETRIES})...`);
          isFetching.current = false;
          setTimeout(() => fetchUser(true), 1000);
          return;
        } else {
          setError(err);
          setUserStable(null);
          setVerified(true);
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
        isFetching.current = false;
      }
    }
  }, [setUserStable]); // Only depends on stable setUserStable

  // Initial fetch on mount - runs only once
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    isMounted.current = true;
    
    const cachedUser = getCachedUser();
    
    // If we have a cached user, verify in background
    if (cachedUser) {
      console.log('[useAuth] Using cached user, verifying in background...');
      setLoading(false);
      // Verify in background after a short delay
      const timer = setTimeout(() => fetchUser(), 500);
      return () => {
        clearTimeout(timer);
      };
    } else {
      // No cache, fetch immediately
      fetchUser();
    }
    
    return () => {
      isMounted.current = false;
    };
  }, [fetchUser]);

  // Logout function - stable reference
  const logout = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch (err) {
      console.error('[useAuth] Logout error:', err);
    } finally {
      setUserStable(null);
      setCachedUser(null);
      setVerified(false);
      retryCount.current = 0;
      hasInitialized.current = false;
    }
  }, [setUserStable]);

  // Redirect if unauthenticated - with debounce to prevent rapid redirects
  const hasRedirected = useRef(false);
  
  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (loading) return;
    if (user) {
      hasRedirected.current = false;
      return;
    }
    if (!verified) return;
    if (typeof window === "undefined") return;
    if (hasRedirected.current) return;
    
    const currentPath = window.location.pathname;
    if (currentPath === redirectPath) return;
    if (currentPath === "/login") return;
    if (currentPath === "/register") return;

    console.log('[useAuth] Redirecting to login...');
    hasRedirected.current = true;
    window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, loading, user, verified]);

  // Memoize the return state to prevent unnecessary re-renders
  const state = useMemo(() => ({
    user,
    loading,
    error,
    isAuthenticated: Boolean(user),
    isFetching: loading,
    isRefetching: false,
    verified,
    status: loading ? 'pending' as const : user ? 'success' as const : 'error' as const,
  }), [user, loading, error, verified]);

  // Return stable references
  return useMemo(() => ({
    ...state,
    refresh: fetchUser,
    logout,
  }), [state, fetchUser, logout]);
}
