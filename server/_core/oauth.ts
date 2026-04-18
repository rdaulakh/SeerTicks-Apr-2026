import { COOKIE_NAME, SESSION_DURATION_SHORT, SESSION_DURATION_LONG } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

// Parse state parameter to extract remember_me preference
function parseStateParam(state: string): { redirectUri: string; rememberMe: boolean } {
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    // Check if state is JSON (new format with remember_me)
    if (decoded.startsWith('{')) {
      const parsed = JSON.parse(decoded);
      return {
        redirectUri: parsed.redirectUri || '/',
        rememberMe: parsed.rememberMe === true,
      };
    }
    // Legacy format: state is just the redirect URI
    return {
      redirectUri: decoded,
      rememberMe: false,
    };
  } catch {
    // If parsing fails, return defaults
    return {
      redirectUri: '/',
      rememberMe: false,
    };
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      console.error('[OAuth] Missing code or state');
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    const startTime = Date.now();
    console.log('[OAuth] Starting OAuth callback...');

    try {
      // Step 1: Exchange code for token (with built-in retry in SDK)
      console.log('[OAuth] Step 1: Exchanging code for token...');
      const tokenStart = Date.now();
      let tokenResponse;
      try {
        tokenResponse = await sdk.exchangeCodeForToken(code, state);
        console.log(`[OAuth] Token exchange successful (${Date.now() - tokenStart}ms)`);
      } catch (error) {
        const elapsed = Date.now() - tokenStart;
        console.error(`[OAuth] Token exchange failed after ${elapsed}ms:`, error);
        
        // Log detailed error information
        if (error instanceof Error) {
          console.error('[OAuth] Error name:', error.name);
          console.error('[OAuth] Error message:', error.message);
          console.error('[OAuth] Error stack:', error.stack);
        }
        
        // Check for axios-specific error details
        const axiosError = error as any;
        if (axiosError?.response) {
          console.error('[OAuth] Response status:', axiosError.response.status);
          console.error('[OAuth] Response data:', JSON.stringify(axiosError.response.data));
        }
        if (axiosError?.code) {
          console.error('[OAuth] Error code:', axiosError.code);
        }
        
        // Provide user-friendly error
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Authentication failed",
            details: "Unable to complete login. Please try again.",
            code: "TOKEN_EXCHANGE_FAILED"
          });
        }
        return;
      }
      
      // Step 2: Get user info (with built-in retry in SDK)
      console.log('[OAuth] Step 2: Fetching user info...');
      const userInfoStart = Date.now();
      let userInfo;
      try {
        userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
        console.log(`[OAuth] User info received (${Date.now() - userInfoStart}ms):`, { 
          openId: userInfo.openId, 
          name: userInfo.name 
        });
      } catch (error) {
        const elapsed = Date.now() - userInfoStart;
        console.error(`[OAuth] User info fetch failed after ${elapsed}ms:`, error);
        
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Authentication failed",
            details: "Unable to retrieve user information. Please try again.",
            code: "USER_INFO_FAILED"
          });
        }
        return;
      }

      if (!userInfo.openId) {
        console.error('[OAuth] openId missing from user info');
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Authentication failed",
            details: "Invalid user data received.",
            code: "INVALID_USER_DATA"
          });
        }
        return;
      }

      // Step 3: Upsert user to database
      console.log('[OAuth] Step 3: Upserting user to database...');
      const dbStart = Date.now();
      try {
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || undefined,
          email: userInfo.email || '',
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? undefined,
          lastSignedIn: new Date(),
        });
        console.log(`[OAuth] User upserted successfully (${Date.now() - dbStart}ms)`);
      } catch (error) {
        const elapsed = Date.now() - dbStart;
        console.error(`[OAuth] Database upsert failed after ${elapsed}ms:`, error);
        
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Authentication failed",
            details: "Unable to save user data. Please try again.",
            code: "DATABASE_ERROR"
          });
        }
        return;
      }

      // Parse state to get remember_me preference
      const stateData = parseStateParam(state);
      console.log('[OAuth] Remember Me preference:', stateData.rememberMe);
      
      // Determine session duration based on remember_me
      const sessionDuration = stateData.rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION_SHORT;
      console.log('[OAuth] Session duration:', sessionDuration, 'ms (', Math.round(sessionDuration / (1000 * 60 * 60 * 24)), 'days)');

      // Step 4: Create session token
      console.log('[OAuth] Step 4: Creating session token...');
      const sessionStart = Date.now();
      let sessionToken;
      try {
        sessionToken = await sdk.createSessionToken(userInfo.openId, {
          name: userInfo.name || "",
          expiresInMs: sessionDuration,
        });
        console.log(`[OAuth] Session token created (${Date.now() - sessionStart}ms)`);
      } catch (error) {
        const elapsed = Date.now() - sessionStart;
        console.error(`[OAuth] Session token creation failed after ${elapsed}ms:`, error);
        
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Authentication failed",
            details: "Unable to create session. Please try again.",
            code: "SESSION_ERROR"
          });
        }
        return;
      }

      // Step 5: Set cookie and redirect
      const cookieOptions = getSessionCookieOptions(req);
      const finalCookieOptions = { ...cookieOptions, maxAge: sessionDuration };
      
      console.log('[OAuth] Step 5: Setting session cookie with options:', {
        cookieName: COOKIE_NAME,
        options: finalCookieOptions,
        protocol: req.protocol,
        host: req.get('host'),
        'x-forwarded-proto': req.get('x-forwarded-proto'),
        'x-forwarded-host': req.get('x-forwarded-host'),
      });
      
      res.cookie(COOKIE_NAME, sessionToken, finalCookieOptions);
      console.log('[OAuth] Cookie set successfully, headers sent:', res.headersSent);

      const totalTime = Date.now() - startTime;
      console.log(`[OAuth] Complete OAuth flow (${totalTime}ms total) - Redirecting to home page`);
      
      if (!res.headersSent) {
        res.redirect(302, "/");
      }
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[OAuth] Unexpected error after ${totalTime}ms:`, error);
      console.error('[OAuth] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        code: code?.substring(0, 10) + '...',
      });
      
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Authentication failed",
          details: "An unexpected error occurred. Please try again.",
          code: "UNEXPECTED_ERROR"
        });
      }
    }
  });
}
